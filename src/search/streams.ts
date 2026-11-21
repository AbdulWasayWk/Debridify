import { torboxKeyFor, type UserConfig } from "../config.js";
import { checkCached, cachedFiles } from "../debrid/torbox.js";
import { cached } from "../lib/cache.js";
import logger from "../lib/logger.js";
import { buildContext } from "../meta/context.js";
import { runProviders, type ProviderRun } from "../providers/index.js";
import { queryTtl } from "../providers/types.js";
import type { Candidate, SearchContext, Stream } from "../types.js";
import { selectFile } from "./files.js";
import { toP2PStream, toTorboxStream } from "./format.js";
import { toCandidates } from "./matcher.js";
import { rankCandidates } from "./ranker.js";

export interface SearchOutcome {
	ctx: SearchContext | null;
	candidates: Candidate[];
	ranked: Candidate[];
	streams: Stream[];
	report?: ProviderRun["report"];
	timings: Record<string, number>;
}

/**
 * Matched candidates for a context. Cached with stale-while-revalidate, so re-opening a title is instant while a
 * background refresh picks up new releases.
 */
const findCandidates = (ctx: SearchContext, torboxKey: string, onReport?: (r: ProviderRun["report"]) => void) =>
	cached(`cands:v2:${ctx.type}:${ctx.id}`, { ...queryTtl(ctx), shouldCache: (c) => c.length > 0 }, async () => {
		const started = Date.now();
		const run = await runProviders(ctx, torboxKey || undefined);
		onReport?.(run.report);
		const cands = toCandidates(ctx, run.torrents);
		logger.info(
			{
				id: ctx.id,
				raw: run.torrents.length,
				matched: cands.length,
				ms: Date.now() - started,
				providers: Object.fromEntries(
					Object.entries(run.report).map(([k, v]) => [
						k,
						v.error ? `error: ${v.error}` : (v.skipped ?? `${v.count} in ${v.ms}ms`),
					]),
				),
			},
			"search finished",
		);
		return cands;
	});

export const search = async (type: string, id: string, cfg: UserConfig, cfgSegment = "-"): Promise<SearchOutcome> => {
	const timings: Record<string, number> = {};
	let t = Date.now();
	const lap = (k: string) => {
		timings[k] = Date.now() - t;
		t = Date.now();
	};

	const ctx = await buildContext(type, id);
	lap("meta");
	if (!ctx) return { ctx, candidates: [], ranked: [], streams: [], timings };

	const key = torboxKeyFor(cfg);
	let report: ProviderRun["report"] | undefined;
	// Copy so per-request debrid fields don't leak into the shared cache entry.
	const candidates = (await findCandidates(ctx, key, (r) => (report = r))).map((c) => ({ ...c }));
	lap("search");

	let usable = candidates;
	if (key && candidates.length) {
		const avail = await checkCached(
			key,
			candidates.map((c) => c.infoHash),
		);
		usable = [];
		for (const c of candidates) {
			const item = avail.get(c.infoHash);
			c.cached = !!item;
			const files = cachedFiles(item);
			if (files.length) {
				const file = selectFile(ctx, files, c.kind);
				// A cached pack whose file list doesn't contain the episode is the wrong pack.
				if (!file && c.kind === "pack") continue;
				c.file = file ?? undefined;
			}
			usable.push(c);
		}
		lap("debrid");
	}

	const ranked = rankCandidates(usable, cfg, !!key);
	const streams: Stream[] = key ? ranked.map((c) => toTorboxStream(ctx, c, cfgSegment)) : ranked.map(toP2PStream);
	if (key && cfg.includeP2P) streams.push(...ranked.map(toP2PStream));
	lap("format");
	return { ctx, candidates, ranked, streams, report, timings };
};
