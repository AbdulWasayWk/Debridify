import { cached } from "../lib/cache.js";
import { getJson } from "../lib/http.js";

/** The Anime Kitsu Stremio addon: aliases + per-episode IMDb mapping (imdbSeason/imdbEpisode/absoluteEpisode). */
const KITSU_ADDON = "https://anime-kitsu.strem.fun";
const DAY = 86_400_000;

export interface KitsuVideo {
	/** Episode number inside this entry. */
	e: number;
	is?: number;
	ie?: number;
	a?: number;
	r?: string;
}

export interface KitsuMeta {
	kitsuId: number;
	name: string;
	aliases: string[];
	imdbId?: string;
	type: "movie" | "series";
	animeType?: string;
	year?: number;
	videos: KitsuVideo[];
}

interface RawKitsu {
	meta?: {
		name?: string;
		aliases?: string[];
		imdb_id?: string;
		type?: string;
		animeType?: string;
		year?: string;
		releaseInfo?: string;
		videos?: Array<{
			episode?: number;
			imdbSeason?: number;
			imdbEpisode?: number;
			absoluteEpisode?: number;
			released?: string;
		}>;
	};
}

export const getKitsuMeta = (kitsuId: number): Promise<KitsuMeta | null> =>
	cached(`kitsu:${kitsuId}`, { ttlMs: DAY, maxAgeMs: 30 * DAY, shouldCache: (v) => v !== null }, async () => {
		// The addon serves the same meta under either type; "series" works for movies too.
		const res = await getJson<RawKitsu>(`${KITSU_ADDON}/meta/series/kitsu:${kitsuId}.json`, { timeoutMs: 6000 });
		const m = res.meta;
		if (!m?.name) return null;
		const year = Number.parseInt((m.year || m.releaseInfo || "").slice(0, 4), 10);
		const videos = (m.videos ?? []).map((v) => ({
			e: v.episode ?? 0,
			is: v.imdbSeason,
			ie: v.imdbEpisode,
			a: v.absoluteEpisode,
			r: v.released,
		}));
		const isMovie = m.type === "movie" || m.animeType === "movie";
		return {
			kitsuId,
			name: m.name,
			aliases: [...new Set([m.name, ...(m.aliases ?? [])])],
			imdbId: m.imdb_id || undefined,
			type: isMovie ? "movie" : "series",
			animeType: m.animeType,
			year: Number.isFinite(year) ? year : undefined,
			videos,
		};
	});
