import { env } from "../config.js";
import logger from "../lib/logger.js";
import type { RawTorrent, SearchContext } from "../types.js";
import { jackett, prowlarr, torboxSearch } from "./optional.js";
import { apibay, eztv, knaben, nyaa, subsplease, torrentsCsv, yts } from "./sources.js";
import type { Provider } from "./types.js";

const STATIC: Provider[] = [yts, eztv, nyaa, subsplease, knaben, apibay, torrentsCsv, jackett, prowlarr];

export const providerIds = () => [...STATIC.map((p) => p.id), "torboxsearch"];

// ── Circuit breaker: after repeated failures a provider is skipped for a while instead of eating the timeout.
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60_000;
const health = new Map<string, { fails: number; openUntil: number; lastError?: string; lastMs?: number; ok: number }>();

const state = (id: string) => {
	let h = health.get(id);
	if (!h) health.set(id, (h = { fails: 0, openUntil: 0, ok: 0 }));
	return h;
};

export const providerHealth = () => Object.fromEntries(health);

export interface ProviderRun {
	torrents: RawTorrent[];
	report: Record<string, { count: number; ms: number; error?: string; skipped?: string }>;
}

export const runProviders = async (ctx: SearchContext, torboxKey?: string): Promise<ProviderRun> => {
	const providers = [...STATIC, ...(torboxKey ? [torboxSearch(torboxKey)] : [])];
	const report: ProviderRun["report"] = {};
	const now = Date.now();

	const jobs = providers.map(async (p): Promise<RawTorrent[]> => {
		if (env.disabledProviders.has(p.id)) return [];
		if (!p.supports(ctx)) return [];
		const h = state(p.id);
		if (h.openUntil > now) {
			report[p.id] = { count: 0, ms: 0, skipped: "circuit open" };
			return [];
		}
		const started = Date.now();
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(new Error("provider timeout")), env.providerTimeoutMs);
		try {
			const res = await Promise.race([
				p.search(ctx, ctrl.signal),
				new Promise<never>((_, reject) =>
					ctrl.signal.addEventListener("abort", () =>
						reject(new Error(`timeout after ${env.providerTimeoutMs}ms`)),
					),
				),
			]);
			h.fails = 0;
			h.ok++;
			h.lastMs = Date.now() - started;
			report[p.id] = { count: res.length, ms: h.lastMs };
			return res;
		} catch (err) {
			const msg =
				err instanceof Error
					? err.cause instanceof Error
						? `${err.message}: ${err.cause.message}`
						: err.message
					: String(err);
			h.fails++;
			h.lastError = msg;
			if (h.fails >= FAIL_THRESHOLD) {
				h.openUntil = Date.now() + COOLDOWN_MS;
				logger.warn({ provider: p.id, err: msg }, "provider failing repeatedly; pausing it for 5 min");
			}
			report[p.id] = { count: 0, ms: Date.now() - started, error: msg };
			return [];
		} finally {
			clearTimeout(timer);
		}
	});

	const torrents = (await Promise.all(jobs)).flat();
	return { torrents, report };
};
