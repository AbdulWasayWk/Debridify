import { cached } from "../lib/cache.js";
import { getJson } from "../lib/http.js";

const CINEMETA = "https://v3-cinemeta.strem.io";
const DAY = 86_400_000;

export interface CinemetaMeta {
	name: string;
	year?: number;
	released?: string;
	country?: string;
	genres: string[];
	/** Trimmed episode list: [season, episode, released]. */
	videos: Array<[number, number, string | undefined]>;
}

interface RawMeta {
	meta?: {
		name?: string;
		year?: string;
		releaseInfo?: string;
		released?: string;
		country?: string;
		genres?: string[];
		videos?: Array<{ season?: number; episode?: number; number?: number; released?: string; firstAired?: string }>;
	};
}

export const getCinemeta = (type: "movie" | "series", imdbId: string): Promise<CinemetaMeta | null> =>
	cached(
		`cinemeta:${type}:${imdbId}`,
		{ ttlMs: 2 * DAY, maxAgeMs: 30 * DAY, shouldCache: (v) => v !== null },
		async () => {
			const res = await getJson<RawMeta>(`${CINEMETA}/meta/${type}/${imdbId}.json`, { timeoutMs: 6000 });
			const m = res.meta;
			if (!m?.name) return null;
			const year = Number.parseInt((m.year || m.releaseInfo || "").slice(0, 4), 10);
			return {
				name: m.name,
				year: Number.isFinite(year) ? year : undefined,
				released: m.released,
				country: m.country,
				genres: m.genres ?? [],
				videos: (m.videos ?? [])
					.filter((v) => typeof v.season === "number")
					.map(
						(v) =>
							[v.season!, v.episode ?? v.number ?? 0, v.released ?? v.firstAired] as [
								number,
								number,
								string | undefined,
							],
					),
			};
		},
	);

/** Absolute episode number = all regular (season > 0) episodes before this season + episode. */
export const absoluteEpisode = (meta: CinemetaMeta, season: number, episode: number): number => {
	let before = 0;
	for (const [s] of meta.videos) if (s > 0 && s < season) before++;
	return before + episode;
};

export const episodeReleased = (meta: CinemetaMeta, season: number, episode: number) =>
	meta.videos.find(([s, e]) => s === season && e === episode)?.[2];
