import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config.js";
import { request } from "../lib/http.js";
import logger from "../lib/logger.js";

/**
 * Fribb/anime-lists: maps IMDb ↔ Kitsu ↔ AniList ↔ MAL ↔ AniDB, with TVDB season numbers.
 * Downloaded once into DATA_DIR and refreshed weekly in the background. Doubles as the anime detector.
 */
const URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const FILE = () => path.join(env.dataDir, "anime-list-full.json");
const REFRESH_MS = 7 * 86_400_000;

export interface AnimeEntry {
	type?: string;
	kitsu?: number;
	anilist?: number;
	mal?: number;
	anidb?: number;
	imdb: string[];
	tvdbSeason?: number;
	tvdbOffset?: number;
}

interface RawEntry {
	type?: string;
	kitsu_id?: number;
	anilist_id?: number;
	mal_id?: number;
	anidb_id?: number;
	imdb_id?: string[] | string;
	season?: { tvdb?: number };
	episode_offset?: { tvdb?: number };
}

const byImdb = new Map<string, AnimeEntry[]>();
const byKitsu = new Map<number, AnimeEntry>();
const byMal = new Map<number, AnimeEntry>();
const byAnilist = new Map<number, AnimeEntry>();
const byAnidb = new Map<number, AnimeEntry>();

let ready: Promise<void> | null = null;

const index = (raw: RawEntry[]) => {
	byImdb.clear();
	byKitsu.clear();
	byMal.clear();
	byAnilist.clear();
	byAnidb.clear();
	for (const r of raw) {
		const imdb = (Array.isArray(r.imdb_id) ? r.imdb_id : r.imdb_id ? [r.imdb_id] : []).filter((x) =>
			/^tt\d+$/.test(x),
		);
		const e: AnimeEntry = {
			type: r.type,
			kitsu: r.kitsu_id,
			anilist: r.anilist_id,
			mal: r.mal_id,
			anidb: r.anidb_id,
			imdb,
			tvdbSeason: r.season?.tvdb,
			tvdbOffset: r.episode_offset?.tvdb,
		};
		for (const id of imdb) {
			const list = byImdb.get(id);
			if (list) list.push(e);
			else byImdb.set(id, [e]);
		}
		if (e.kitsu) byKitsu.set(e.kitsu, e);
		if (e.mal) byMal.set(e.mal, e);
		if (e.anilist) byAnilist.set(e.anilist, e);
		if (e.anidb) byAnidb.set(e.anidb, e);
	}
};

const download = async () => {
	const res = await request(URL, { timeoutMs: 60_000 });
	const text = await res.text();
	const raw = JSON.parse(text) as RawEntry[];
	await fs.mkdir(env.dataDir, { recursive: true });
	await fs.writeFile(FILE() + ".tmp", text);
	await fs.rename(FILE() + ".tmp", FILE());
	return raw;
};

const load = async () => {
	let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
	try {
		stat = await fs.stat(FILE());
	} catch {
		/* not downloaded yet */
	}
	if (stat) {
		index(JSON.parse(await fs.readFile(FILE(), "utf8")) as RawEntry[]);
		logger.info({ entries: byKitsu.size, imdb: byImdb.size }, "anime map loaded");
		void refreshIfStale();
		return;
	}
	logger.info("downloading anime ID map (first run, ~7 MB)…");
	index(await download());
	logger.info({ entries: byKitsu.size, imdb: byImdb.size }, "anime map downloaded");
};

let refreshing = false;

/**
 * Re-download the map in the background when the saved copy is older than a week. Runs at startup and then daily,
 * so a long-running container stays current. On failure the old copy keeps serving and the next check retries.
 */
const refreshIfStale = async () => {
	if (refreshing) return;
	refreshing = true;
	try {
		const stat = await fs.stat(FILE()).catch(() => null);
		if (stat && Date.now() - stat.mtimeMs <= REFRESH_MS) return;
		const raw = await download();
		index(raw);
		logger.info({ entries: byKitsu.size, imdb: byImdb.size }, "anime map refreshed");
	} catch (err) {
		logger.warn({ err: String(err) }, "anime map refresh failed (using old copy, will retry)");
	} finally {
		refreshing = false;
	}
};

const CHECK_EVERY_MS = 24 * 3_600_000;
let timer: NodeJS.Timeout | null = null;

export const initAnimeMap = () => {
	ready ??= load().catch((err) => {
		logger.error({ err: String(err) }, "anime map unavailable; anime detection will use heuristics");
		ready = null;
	});
	timer ??= setInterval(() => void refreshIfStale(), CHECK_EVERY_MS).unref();
	return ready;
};

/** Wait for the map (bounded, so a slow first download never stalls a stream request for long). */
const whenReady = async (maxWaitMs = 15_000) => {
	const p = initAnimeMap();
	await Promise.race([p, new Promise((r) => setTimeout(r, maxWaitMs))]);
};

export const animeByImdb = async (imdbId: string) => {
	await whenReady();
	return byImdb.get(imdbId) ?? [];
};

export const animeByKitsu = async (kitsuId: number) => {
	await whenReady();
	return byKitsu.get(kitsuId);
};

export const kitsuFromForeignId = async (prefix: string, id: number): Promise<number | undefined> => {
	await whenReady();
	const map = { mal: byMal, anilist: byAnilist, anidb: byAnidb }[prefix];
	return map?.get(id)?.kitsu;
};
