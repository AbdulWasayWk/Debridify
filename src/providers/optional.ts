import { XMLParser } from "fast-xml-parser";
import { env } from "../config.js";
import { cached } from "../lib/cache.js";
import { getJson, getText } from "../lib/http.js";
import { normalizeHash, parseMagnet } from "../lib/magnet.js";
import { animeQueries, generalQueries } from "../search/queries.js";
import type { RawTorrent, SearchContext } from "../types.js";
import { queryTtl, type Provider } from "./types.js";

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	parseTagValue: false,
	htmlEntities: true,
});
const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

const allQueries = (ctx: SearchContext) => [...new Set([...generalQueries(ctx), ...animeQueries(ctx)])].slice(0, 5);

const settle = async (jobs: Array<Promise<RawTorrent[]>>) => {
	const r = await Promise.allSettled(jobs);
	const ok = r.filter((x): x is PromiseFulfilledResult<RawTorrent[]> => x.status === "fulfilled");
	if (!ok.length && r.length) throw (r[0] as PromiseRejectedResult).reason;
	return ok.flatMap((x) => x.value);
};

// ───────────────────────────── Jackett (Torznab XML) ─────────────────────────────

interface TorznabItem {
	title: string;
	size?: string;
	jackettindexer?: string | { "#text": string };
	"torznab:attr"?: Array<{ "@_name": string; "@_value": string }> | { "@_name": string; "@_value": string };
}

const torznab = async (params: Record<string, string | number | undefined>, signal: AbortSignal) => {
	const text = await getText(`${env.jackett.url}/indexers/all/results/torznab/api`, {
		query: { apikey: env.jackett.apiKey, limit: 100, ...params },
		signal,
		timeoutMs: env.providerTimeoutMs,
	});
	const doc = xml.parse(text) as { rss?: { channel?: { item?: TorznabItem | TorznabItem[] } } };
	return asArray(doc.rss?.channel?.item).flatMap((i): RawTorrent[] => {
		const attrs = new Map(asArray(i["torznab:attr"]).map((a) => [a["@_name"], a["@_value"]]));
		const infoHash = normalizeHash(attrs.get("infohash")) ?? parseMagnet(attrs.get("magneturl"))?.infoHash;
		if (!infoHash) return [];
		const indexer = typeof i.jackettindexer === "object" ? i.jackettindexer["#text"] : i.jackettindexer;
		return [
			{
				infoHash,
				title: String(i.title),
				size: Number(i.size) || undefined,
				seeders: Number(attrs.get("seeders")) || 0,
				source: indexer || "Jackett",
				provider: "jackett",
			},
		];
	});
};

export const jackett: Provider = {
	id: "jackett",
	name: "Jackett",
	supports: () => !!env.jackett.url && !!env.jackett.apiKey,
	search: (ctx, signal) => {
		const jobs: Array<Promise<RawTorrent[]>> = [];
		const ttl = queryTtl(ctx);
		if (ctx.imdbId && ctx.type === "movie") {
			jobs.push(
				cached(`p:jackett:movie:${ctx.imdbId}`, ttl, () => torznab({ t: "movie", imdbid: ctx.imdbId }, signal)),
			);
		}
		if (ctx.imdbId && ctx.type === "series" && ctx.season !== undefined) {
			const key = `p:jackett:tv:${ctx.imdbId}:${ctx.season}:${ctx.episode}`;
			jobs.push(
				cached(key, ttl, () =>
					torznab({ t: "tvsearch", imdbid: ctx.imdbId, season: ctx.season, ep: ctx.episode }, signal),
				),
			);
		}
		for (const q of allQueries(ctx))
			jobs.push(cached(`p:jackett:q:${q}`, ttl, () => torznab({ t: "search", q }, signal)));
		return settle(jobs);
	},
};

// ───────────────────────────── Prowlarr (JSON search API) ─────────────────────────────

interface ProwlarrItem {
	title: string;
	size?: number;
	seeders?: number;
	infoHash?: string;
	magnetUrl?: string;
	guid?: string;
	indexer?: string;
}

export const prowlarr: Provider = {
	id: "prowlarr",
	name: "Prowlarr",
	supports: () => !!env.prowlarr.url && !!env.prowlarr.apiKey,
	search: (ctx, signal) =>
		settle(
			allQueries(ctx).map((q) =>
				cached(`p:prowlarr:${q}`, queryTtl(ctx), async () => {
					const items = await getJson<ProwlarrItem[]>(`${env.prowlarr.url}/api/v1/search`, {
						query: { query: q, type: "search", limit: 100 },
						headers: { "X-Api-Key": env.prowlarr.apiKey },
						signal,
						timeoutMs: env.providerTimeoutMs,
					});
					return items.flatMap((i): RawTorrent[] => {
						const infoHash =
							normalizeHash(i.infoHash) ??
							parseMagnet(i.magnetUrl)?.infoHash ??
							parseMagnet(i.guid)?.infoHash;
						if (!infoHash) return [];
						return [
							{
								infoHash,
								title: i.title,
								size: i.size,
								seeders: i.seeders,
								source: i.indexer || "Prowlarr",
								provider: "prowlarr",
							},
						];
					});
				}),
			),
		),
};

// ───────────────────────────── TorBox Search API ─────────────────────────────
// As of Nov 2026 search-api.torbox.app has no DNS record. Kept so it works again automatically if it returns;
// the circuit breaker in providers/index.ts stops it costing anything while it's down.

interface TorboxSearchResponse {
	data?: {
		torrents?: Array<{
			hash: string;
			raw_title?: string;
			title?: string;
			size?: number;
			last_known_seeders?: number;
		}>;
	};
}

export const torboxSearch = (apiKey: string): Provider => ({
	id: "torboxsearch",
	name: "TorBox Search",
	supports: (ctx) => !!apiKey && !!ctx.imdbId,
	search: (ctx, signal) => {
		const series = ctx.type === "series" && ctx.season !== undefined;
		const key = `p:tbsearch:${ctx.imdbId}:${series ? `${ctx.season}:${ctx.episode}` : ""}`;
		return cached(key, queryTtl(ctx), async () => {
			const res = await getJson<TorboxSearchResponse>(
				`https://search-api.torbox.app/torrents/imdb:${ctx.imdbId}`,
				{
					query: {
						metadata: "false",
						check_cache: "false",
						...(series ? { season: ctx.season, episode: ctx.episode } : {}),
					},
					headers: { authorization: `Bearer ${apiKey}` },
					signal,
					timeoutMs: 6000,
				},
			);
			return (res.data?.torrents ?? []).flatMap((t): RawTorrent[] => {
				const infoHash = normalizeHash(t.hash);
				if (!infoHash) return [];
				return [
					{
						infoHash,
						title: t.raw_title || t.title || "",
						size: t.size,
						seeders: t.last_known_seeders,
						source: "TorBox",
						provider: "torboxsearch",
					},
				];
			});
		});
	},
});
