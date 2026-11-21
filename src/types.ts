import type { QualityGroup, Resolution } from "./config.js";
import type { ParsedTitle } from "./lib/parse.js";

export type ContentType = "movie" | "series";

export interface AnimeInfo {
	kitsuId?: number;
	/** Episode number inside the specific anime entry (what SubsPlease etc. use, e.g. "S2 - 05"). */
	relEpisode?: number;
	/** Absolute episode number across all seasons (e.g. One Piece 1100). */
	absEpisode?: number;
	/** Season number release groups would use for this entry (e.g. 2 for "Frieren S2"). */
	entrySeason?: number;
	/** True when the requested entry is the first season/part, so un-numbered titles default to it. */
	isFirstEntry: boolean;
	/** Normalised aliases of the specific entry (e.g. "sousou no frieren 2nd season"). */
	entryTitles: string[];
	/** Normalised aliases of the franchise / first season (e.g. "sousou no frieren"). */
	baseTitles: string[];
	/** Display-case titles used for search queries, most useful first. */
	queryTitles: string[];
	baseQueryTitle?: string;
	/** Anime movie / OVA with no episodes. */
	isMovie: boolean;
}

/** Everything the search needs to know about a Stremio item. Built once per id and cached. */
export interface SearchContext {
	id: string;
	type: ContentType;
	imdbId?: string;
	/** Primary display title. */
	name: string;
	/** Display-case titles for search queries (first = best). */
	queryTitles: string[];
	/** All normalised names used for relevance filtering. */
	matchTitles: string[];
	year?: number;
	season?: number;
	episode?: number;
	/** ISO date the movie/episode was released (drives cache freshness). */
	released?: string;
	isAnime: boolean;
	anime?: AnimeInfo;
}

/** A search hit as returned by a provider, before matching/ranking. */
export interface RawTorrent {
	infoHash: string;
	title: string;
	size?: number;
	seeders?: number;
	/** Display name of the site it came from ("Nyaa", "YTS", "1337x"...). */
	source: string;
	/** Provider id that produced it. */
	provider: string;
	/** Provider guarantees this torrent belongs to the requested IMDb id (skip title checks). */
	imdbVerified?: boolean;
	/** Provider-supplied season/episode (EZTV). 0 = pack. */
	season?: number;
	episode?: number;
	trackers?: string[];
}

export interface FileInfo {
	/** Index in the debrid/torrent file list. */
	index: number;
	name: string;
	size: number;
}

export interface Candidate extends RawTorrent {
	sources: string[];
	parsed: ParsedTitle;
	resolution: Resolution;
	qualityGroup: QualityGroup;
	/** single = one episode/movie; pack = season/batch/complete that needs a file picked inside. */
	kind: "single" | "pack";
	languages: string[];
	/** Set after the debrid availability check. */
	cached?: boolean;
	/** Chosen file inside the torrent, when known. */
	file?: FileInfo;
}

export interface Stream {
	name: string;
	title?: string;
	description?: string;
	url?: string;
	infoHash?: string;
	fileIdx?: number;
	sources?: string[];
	behaviorHints?: {
		bingeGroup?: string;
		filename?: string;
		videoSize?: number;
		notWebReady?: boolean;
	};
}
