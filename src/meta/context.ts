import { cached } from "../lib/cache.js";
import logger from "../lib/logger.js";
import { normalizeTitle } from "../lib/parse.js";
import type { AnimeInfo, ContentType, SearchContext } from "../types.js";
import { animeByImdb, animeByKitsu, kitsuFromForeignId, type AnimeEntry } from "./animeMap.js";
import { absoluteEpisode, episodeReleased, getCinemeta, type CinemetaMeta } from "./cinemeta.js";
import { getKitsuMeta, type KitsuMeta } from "./kitsu.js";

export type ParsedId =
	| { kind: "imdb"; imdbId: string; season?: number; episode?: number }
	| { kind: "kitsu"; kitsuId: number; episode?: number };

const num = (s: string | undefined) => {
	if (s === undefined || s === "") return undefined;
	const n = Number.parseInt(s, 10);
	return Number.isFinite(n) ? n : undefined;
};

export const parseStremioId = async (rawId: string): Promise<ParsedId | null> => {
	const parts = decodeURIComponent(rawId).split(":");
	const head = parts[0] ?? "";
	if (/^tt\d+$/.test(head)) return { kind: "imdb", imdbId: head, season: num(parts[1]), episode: num(parts[2]) };
	if (head === "kitsu") {
		const kitsuId = num(parts[1]);
		return kitsuId ? { kind: "kitsu", kitsuId, episode: num(parts[2]) } : null;
	}
	if (["mal", "anilist", "anidb"].includes(head)) {
		const foreign = num(parts[1]);
		const kitsuId = foreign ? await kitsuFromForeignId(head, foreign) : undefined;
		return kitsuId ? { kind: "kitsu", kitsuId, episode: num(parts[2]) } : null;
	}
	return null;
};

/** Search queries work best with Latin-script names; drop Japanese/Chinese/Korean-only aliases. */
const isLatin = (s: string) => {
	const letters = s.replace(/[^\p{L}]/gu, "");
	if (!letters) return false;
	const latin = letters.replace(/[^\p{Script=Latin}]/gu, "");
	return latin.length / letters.length > 0.8;
};

const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))];

/** Normalised names plus, for anime, the part before ":" / " - " ("Frieren: Beyond Journey's End" → "frieren"). */
const matchNames = (names: string[], derive: boolean) => {
	const out = new Set<string>();
	for (const n of names) {
		out.add(normalizeTitle(n));
		if (derive) {
			const head = n.split(/:| - /)[0];
			if (head && head.length >= 4 && head !== n) out.add(normalizeTitle(head));
		}
	}
	return [...out].filter((x) => x.length >= 2);
};

const preferTv = (a: AnimeEntry, b: AnimeEntry) => {
	const rank = (e: AnimeEntry) => (e.type === "TV" ? 0 : e.type === "ONA" ? 1 : e.type === "TV_SHORT" ? 1 : 2);
	return rank(a) - rank(b);
};

const safeKitsu = (id: number | undefined) => (id ? getKitsuMeta(id).catch(() => null) : Promise.resolve(null));

/** The first-season entry of a franchise (by TVDB season 1), used for base titles like "Sousou no Frieren". */
const baseEntryOf = (siblings: AnimeEntry[]) =>
	siblings.filter((e) => e.kitsu && e.tvdbSeason === 1).sort(preferTv)[0] ??
	siblings.filter((e) => e.kitsu).sort(preferTv)[0];

const buildAnimeInfo = (
	target: KitsuMeta | null,
	base: KitsuMeta | null,
	extra: Partial<AnimeInfo> & { isMovie: boolean },
	fallbackNames: string[],
): AnimeInfo => {
	const entryAliases = uniq([...(target?.aliases ?? []), ...(target ? [] : fallbackNames)]);
	const baseAliases = uniq([...(base?.aliases ?? []), ...fallbackNames]);
	const isFirstEntry = extra.isFirstEntry ?? (!target || !base || target.kitsuId === base.kitsuId);
	return {
		...extra,
		isFirstEntry,
		entryTitles: matchNames(entryAliases, true),
		baseTitles: matchNames(baseAliases, true),
		queryTitles: uniq(entryAliases.filter(isLatin)).slice(0, 3),
		baseQueryTitle: uniq(baseAliases.filter(isLatin))[0],
	};
};

const fromImdb = async (type: ContentType, imdbId: string, season?: number, episode?: number) => {
	const isSeries = type === "series" && season !== undefined && episode !== undefined;
	const [meta, entries] = await Promise.all([
		getCinemeta(isSeries ? "series" : type, imdbId).catch((err) => {
			logger.warn({ err: String(err), imdbId }, "cinemeta lookup failed");
			return null;
		}),
		animeByImdb(imdbId),
	]);
	const kitsuEntries = entries.filter((e) => e.kitsu);
	const heuristicAnime =
		!!meta && /japan/i.test(meta.country ?? "") && meta.genres.some((g) => /animation|anime/i.test(g));
	const isAnime = kitsuEntries.length > 0 || heuristicAnime;
	const name = meta?.name ?? "";

	const ctx: SearchContext = {
		id: isSeries ? `${imdbId}:${season}:${episode}` : imdbId,
		type: isSeries ? "series" : "movie",
		imdbId,
		name,
		queryTitles: uniq([name]),
		matchTitles: matchNames(uniq([name]), false),
		year: meta?.year,
		isAnime,
		released: meta?.released,
	};

	if (!isSeries) {
		if (isAnime) {
			const movieEntry = kitsuEntries.find((e) => /movie/i.test(e.type ?? "")) ?? kitsuEntries.sort(preferTv)[0];
			const km = await safeKitsu(movieEntry?.kitsu);
			ctx.anime = buildAnimeInfo(km, km, { kitsuId: km?.kitsuId, isMovie: true, isFirstEntry: true }, [name]);
		}
		return finish(ctx);
	}

	ctx.season = season;
	ctx.episode = episode;
	if (meta) ctx.released = episodeReleased(meta, season!, episode!) ?? ctx.released;
	if (!isAnime) return finish(ctx);

	ctx.anime = await resolveImdbAnime(kitsuEntries, meta, name, season!, episode!);
	return finish(ctx);
};

/** Map an IMDb S/E onto the right Kitsu entry + relative/absolute episode numbers. */
const resolveImdbAnime = async (
	entries: AnimeEntry[],
	meta: CinemetaMeta | null,
	name: string,
	season: number,
	episode: number,
): Promise<AnimeInfo> => {
	const absFallback = meta ? absoluteEpisode(meta, season, episode) : episode;
	const seasonMatches = entries.filter((e) => e.tvdbSeason === season).sort(preferTv);
	const others = entries.filter((e) => !seasonMatches.includes(e)).sort(preferTv);
	const probe = [...seasonMatches, ...others].slice(0, 6);
	const baseEntry = baseEntryOf(entries);

	const [metas, base] = await Promise.all([
		Promise.all(probe.map((e) => safeKitsu(e.kitsu))),
		safeKitsu(baseEntry?.kitsu),
	]);

	for (let i = 0; i < metas.length; i++) {
		const km = metas[i];
		const v = km?.videos.find((x) => x.is === season && x.ie === episode);
		if (km && v) {
			return buildAnimeInfo(
				km,
				base,
				{
					kitsuId: km.kitsuId,
					relEpisode: v.e,
					absEpisode: v.a ?? absFallback,
					entrySeason: probe[i]!.tvdbSeason ?? season,
					isMovie: false,
				},
				[name],
			);
		}
	}

	const target = seasonMatches.length ? (metas[0] ?? null) : null;
	const offset = seasonMatches[0]?.tvdbOffset ?? 0;
	return buildAnimeInfo(
		target,
		base,
		{
			kitsuId: target?.kitsuId,
			relEpisode: target ? episode - offset : episode,
			absEpisode: absFallback,
			entrySeason: season,
			isMovie: false,
			isFirstEntry: season === 1 || (!!target && !!base && target.kitsuId === base.kitsuId),
		},
		[name],
	);
};

const fromKitsu = async (kitsuId: number, episode?: number) => {
	const [km, entry] = await Promise.all([getKitsuMeta(kitsuId), animeByKitsu(kitsuId)]);
	if (!km) return null;
	const video = episode !== undefined ? km.videos.find((v) => v.e === episode) : undefined;
	const isSeries = episode !== undefined && km.type === "series";
	const imdbId = km.imdbId ?? entry?.imdb[0];

	const siblings = imdbId ? (await animeByImdb(imdbId)).filter((e) => e.kitsu) : [];
	const baseEntry = baseEntryOf(siblings);
	const [base, cm] = await Promise.all([
		baseEntry && baseEntry.kitsu !== kitsuId ? safeKitsu(baseEntry.kitsu) : Promise.resolve(km),
		imdbId ? getCinemeta(isSeries ? "series" : "movie", imdbId).catch(() => null) : Promise.resolve(null),
	]);

	const imdbName = cm?.name;
	const ctx: SearchContext = {
		id: `kitsu:${kitsuId}${episode !== undefined ? `:${episode}` : ""}`,
		type: isSeries ? "series" : "movie",
		imdbId,
		name: km.name,
		queryTitles: uniq([km.name, imdbName]),
		matchTitles: [],
		year: km.year ?? cm?.year,
		season: isSeries ? video?.is : undefined,
		episode: isSeries ? video?.ie : undefined,
		released: video?.r ?? cm?.released,
		isAnime: true,
	};
	ctx.anime = buildAnimeInfo(
		km,
		base,
		{
			kitsuId,
			relEpisode: isSeries ? episode : undefined,
			absEpisode: isSeries ? (video?.a ?? episode) : undefined,
			entrySeason: entry?.tvdbSeason ?? video?.is,
			isMovie: !isSeries,
		},
		uniq([imdbName]),
	);
	return finish(ctx);
};

const finish = (ctx: SearchContext): SearchContext => {
	if (ctx.anime) {
		ctx.matchTitles = [...new Set([...ctx.matchTitles, ...ctx.anime.entryTitles, ...ctx.anime.baseTitles])];
		ctx.queryTitles = uniq([...ctx.anime.queryTitles, ctx.anime.baseQueryTitle, ...ctx.queryTitles]);
	}
	return ctx;
};

export const buildContext = (type: string, rawId: string): Promise<SearchContext | null> =>
	cached(
		`ctx:v2:${type}:${rawId}`,
		{ ttlMs: 6 * 3_600_000, maxAgeMs: 7 * 86_400_000, shouldCache: (v) => !!v?.name },
		async () => {
			const id = await parseStremioId(rawId);
			if (!id) return null;
			const ctype: ContentType =
				type === "movie"
					? "movie"
					: type === "series"
						? "series"
						: id.episode !== undefined
							? "series"
							: "movie";
			if (id.kind === "imdb") return fromImdb(ctype, id.imdbId, id.season, id.episode);
			return fromKitsu(id.kitsuId, id.episode);
		},
	);
