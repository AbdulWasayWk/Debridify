import { XMLParser } from "fast-xml-parser";
import { cached } from "../lib/cache.js";
import { getJson, getText } from "../lib/http.js";
import { normalizeHash, parseMagnet } from "../lib/magnet.js";
import { parseSize } from "../lib/parse.js";
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
const toNum = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
};

/** Run several queries for one provider in parallel; a failing query doesn't sink the others. */
const multi = async (queries: string[], fn: (q: string) => Promise<RawTorrent[]>) => {
	const settled = await Promise.allSettled(queries.map(fn));
	const ok = settled.filter((r): r is PromiseFulfilledResult<RawTorrent[]> => r.status === "fulfilled");
	if (!ok.length && settled.length) throw (settled[0] as PromiseRejectedResult).reason;
	return ok.flatMap((r) => r.value);
};

// ───────────────────────────── YTS (movies, by IMDb id) ─────────────────────────────

const YTS_HOSTS = ["https://movies-api.accel.li", "https://yts.lt"];

interface YtsResponse {
	data?: {
		movies?: Array<{
			imdb_code: string;
			title_long?: string;
			title: string;
			year: number;
			torrents?: Array<{
				hash: string;
				quality: string;
				type: string;
				video_codec?: string;
				bit_depth?: string;
				audio_channels?: string;
				seeds: number;
				size_bytes: number;
			}>;
		}>;
	};
}

export const yts: Provider = {
	id: "yts",
	name: "YTS",
	supports: (ctx) => ctx.type === "movie" && !!ctx.imdbId,
	search: (ctx, signal) =>
		cached(`p:yts:${ctx.imdbId}`, queryTtl(ctx), async () => {
			let lastErr: unknown;
			for (const host of YTS_HOSTS) {
				try {
					const res = await getJson<YtsResponse>(`${host}/api/v2/list_movies.json`, {
						query: { query_term: ctx.imdbId },
						signal,
						timeoutMs: 6000,
					});
					return (res.data?.movies ?? [])
						.filter((m) => m.imdb_code === ctx.imdbId)
						.flatMap((m) =>
							(m.torrents ?? []).map((t) => ({
								infoHash: normalizeHash(t.hash) ?? "",
								title: `${m.title} (${m.year}) ${t.quality} ${t.type === "web" ? "WEBRip" : t.type === "bluray" ? "BluRay" : t.type} ${t.video_codec ?? ""} ${t.bit_depth === "10" ? "10bit" : ""} ${t.audio_channels ?? ""} [YTS]`.replace(
									/\s+/g,
									" ",
								),
								size: t.size_bytes,
								seeders: t.seeds,
								source: "YTS",
								provider: "yts",
								imdbVerified: true,
							})),
						)
						.filter((t) => t.infoHash);
				} catch (err) {
					lastErr = err;
				}
			}
			throw lastErr;
		}),
};

// ───────────────────────────── EZTV (series, by IMDb id) ─────────────────────────────

interface EztvResponse {
	torrents_count?: number;
	torrents?: Array<{
		hash: string;
		filename?: string;
		title: string;
		season?: string;
		episode?: string;
		seeds?: number;
		size_bytes?: string | number;
	}>;
}

const EZTV = "https://eztvx.to/api/get-torrents";

export const eztv: Provider = {
	id: "eztv",
	name: "EZTV",
	supports: (ctx) => ctx.type === "series" && !!ctx.imdbId && ctx.season !== undefined,
	// EZTV returns every episode for a show, so the whole list is cached per show and reused across episodes.
	search: (ctx, signal) =>
		cached(`p:eztv:${ctx.imdbId}`, queryTtl(ctx), async () => {
			const imdb = ctx.imdbId!.replace(/^tt/, "");
			const page = (n: number) =>
				getJson<EztvResponse>(EZTV, { query: { imdb_id: imdb, limit: 100, page: n }, signal, timeoutMs: 6000 });
			const first = await page(1);
			const pages = Math.min(Math.ceil((first.torrents_count ?? 0) / 100), 8);
			const rest = await Promise.allSettled(
				Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => page(i + 2)),
			);
			const all = [first, ...rest.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
			return all
				.flatMap((r) => r.torrents ?? [])
				.map((t) => ({
					infoHash: normalizeHash(t.hash) ?? "",
					title: (t.filename || t.title).replace(/\[eztv[^\]]*\]|\.mkv$|\.mp4$/gi, "").trim(),
					size: toNum(t.size_bytes),
					seeders: t.seeds,
					source: "EZTV",
					provider: "eztv",
					imdbVerified: true,
					season: toNum(t.season),
					episode: toNum(t.episode),
				}))
				.filter((t) => t.infoHash);
		}),
};

// ───────────────────────────── The Pirate Bay (apibay JSON) ─────────────────────────────

interface ApibayItem {
	name: string;
	info_hash: string;
	seeders: string;
	size: string;
	category: string;
	imdb?: string;
}

const apibayQuery = (q: string, ctx: SearchContext, signal: AbortSignal) =>
	cached(`p:apibay:${q}`, queryTtl(ctx), async () => {
		const items = await getJson<ApibayItem[]>("https://apibay.org/q.php", {
			query: { q, cat: "200" },
			signal,
			timeoutMs: 6000,
		});
		return items
			.filter((i) => i.info_hash && !/^0+$/.test(i.info_hash) && i.category?.startsWith("2"))
			.map((i) => ({
				infoHash: normalizeHash(i.info_hash) ?? "",
				title: i.name,
				size: toNum(i.size),
				seeders: toNum(i.seeders),
				source: "TPB",
				provider: "apibay",
				imdbVerified: !!ctx.imdbId && i.imdb === ctx.imdbId && ctx.type === "movie",
			}))
			.filter((t) => t.infoHash);
	});

export const apibay: Provider = {
	id: "apibay",
	name: "The Pirate Bay",
	supports: (ctx) => !!ctx.imdbId || ctx.queryTitles.length > 0,
	search: (ctx, signal) => {
		const queries = [...(ctx.imdbId ? [ctx.imdbId] : []), ...generalQueries(ctx).slice(0, 3)];
		return multi(queries, (q) => apibayQuery(q, ctx, signal));
	},
};

// ───────────────────────────── Knaben (meta-search: TPB, 1337x, Nyaa, RuTracker, …) ─────────────────────────────

interface KnabenResponse {
	hits?: Array<{
		hash?: string;
		magnetUrl?: string;
		title: string;
		bytes?: number;
		seeders?: number;
		cachedOrigin?: string;
	}>;
}

const SOURCE_ALIASES: Record<string, string> = {
	"the pirate bay": "TPB",
	"nyaa.si": "Nyaa",
	"rutracker.org": "RuTracker",
};
const knabenSource = (origin: string | undefined) => {
	const clean = (origin ?? "").replace(/\s*\(.*?\)|\s+python scraper/gi, "").trim();
	return SOURCE_ALIASES[clean.toLowerCase()] ?? (clean || "Knaben");
};

const knabenQuery = (q: string, ctx: SearchContext, signal: AbortSignal) =>
	cached(`p:knaben:${q}`, queryTtl(ctx), async () => {
		const res = await getJson<KnabenResponse>("https://api.knaben.org/v1", {
			json: {
				search_type: "100%",
				search_field: "title",
				query: q,
				order_by: "seeders",
				order_direction: "desc",
				size: 150,
				hide_unsafe: true,
				hide_xxx: true,
			},
			signal,
			timeoutMs: 7000,
		});
		return (res.hits ?? [])
			.map((h) => ({
				infoHash: normalizeHash(h.hash) ?? parseMagnet(h.magnetUrl)?.infoHash ?? "",
				title: h.title,
				size: h.bytes,
				seeders: h.seeders,
				source: knabenSource(h.cachedOrigin),
				provider: "knaben",
			}))
			.filter((t) => t.infoHash);
	});

export const knaben: Provider = {
	id: "knaben",
	name: "Knaben",
	supports: (ctx) => ctx.queryTitles.length > 0,
	search: (ctx, signal) => multi(generalQueries(ctx).slice(0, 4), (q) => knabenQuery(q, ctx, signal)),
};

// ───────────────────────────── Nyaa (anime) ─────────────────────────────

interface NyaaItem {
	title: string;
	"nyaa:infoHash"?: string;
	"nyaa:seeders"?: string;
	"nyaa:size"?: string;
	"nyaa:categoryId"?: string;
	"nyaa:remake"?: string;
}

const nyaaQuery = (q: string, ctx: SearchContext, signal: AbortSignal) =>
	cached(`p:nyaa:${q}`, queryTtl(ctx), async () => {
		const text = await getText("https://nyaa.si/", {
			query: { page: "rss", q, c: "1_0", f: "0", s: "seeders", o: "desc" },
			signal,
			timeoutMs: 7000,
		});
		const doc = xml.parse(text) as { rss?: { channel?: { item?: NyaaItem | NyaaItem[] } } };
		return asArray(doc.rss?.channel?.item)
			.filter((i) => {
				const cat = i["nyaa:categoryId"] ?? "";
				// 1_1 = AMVs, 1_3 = non-English translations
				return cat !== "1_1" && cat !== "1_3" && i["nyaa:remake"] !== "Yes";
			})
			.map((i) => ({
				infoHash: normalizeHash(i["nyaa:infoHash"]) ?? "",
				title: String(i.title),
				size: parseSize(i["nyaa:size"]),
				seeders: toNum(i["nyaa:seeders"]),
				source: "Nyaa",
				provider: "nyaa",
			}))
			.filter((t) => t.infoHash);
	});

export const nyaa: Provider = {
	id: "nyaa",
	name: "Nyaa",
	supports: (ctx) => ctx.isAnime,
	search: (ctx, signal) => multi(animeQueries(ctx), (q) => nyaaQuery(q, ctx, signal)),
};

// ───────────────────────────── SubsPlease (airing anime) ─────────────────────────────

type SubsPleaseResponse = Record<
	string,
	{ show: string; episode: string; downloads?: Array<{ res: string; magnet: string }> }
>;

export const subsplease: Provider = {
	id: "subsplease",
	name: "SubsPlease",
	supports: (ctx) => ctx.isAnime && !!(ctx.anime?.baseQueryTitle || ctx.anime?.queryTitles.length),
	search: (ctx, signal) => {
		// The franchise name finds every season ("Sousou no Frieren" also returns "Sousou no Frieren S2").
		const q = ctx.anime!.baseQueryTitle ?? ctx.anime!.queryTitles[0]!;
		return cached(`p:subsplease:${q}`, queryTtl(ctx), async () => {
			const res = await getJson<SubsPleaseResponse | []>("https://subsplease.org/api/", {
				query: { f: "search", tz: "UTC", s: q },
				signal,
				timeoutMs: 6000,
			});
			if (Array.isArray(res)) return [];
			return Object.values(res).flatMap((rel) =>
				(rel.downloads ?? []).flatMap((d) => {
					const m = parseMagnet(d.magnet);
					if (!m) return [];
					const batch = rel.episode.includes("-");
					const title = batch
						? `[SubsPlease] ${rel.show} (${rel.episode}) (${d.res}p) [Batch]`
						: `[SubsPlease] ${rel.show} - ${rel.episode} (${d.res}p)`;
					return [
						{
							infoHash: m.infoHash,
							title,
							size: m.size,
							source: "SubsPlease",
							provider: "subsplease",
							trackers: m.trackers,
						},
					];
				}),
			);
		});
	},
};

// ───────────────────────────── Torrents-CSV ─────────────────────────────

interface TorrentsCsvResponse {
	torrents?: Array<{ infohash: string; name: string; size_bytes: number; seeders: number }>;
}

export const torrentsCsv: Provider = {
	id: "torrentscsv",
	name: "Torrents-CSV",
	supports: (ctx) => ctx.queryTitles.length > 0,
	search: (ctx, signal) =>
		multi(generalQueries(ctx).slice(0, 2), (q) =>
			cached(`p:tcsv:${q}`, queryTtl(ctx), async () => {
				const res = await getJson<TorrentsCsvResponse>("https://torrents-csv.com/service/search", {
					query: { q, size: 100 },
					signal,
					timeoutMs: 6000,
				});
				return (res.torrents ?? [])
					.map((t) => ({
						infoHash: normalizeHash(t.infohash) ?? "",
						title: t.name.trim(),
						size: t.size_bytes,
						seeders: t.seeders,
						source: "Torrents-CSV",
						provider: "torrentscsv",
					}))
					.filter((t) => t.infoHash);
			}),
		),
};
