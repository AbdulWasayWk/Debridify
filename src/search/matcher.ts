import {
	looksNonVideo,
	normalizeResolution,
	normalizeTitle,
	parseTitle,
	qualityGroupOf,
	titleMatches,
	type ParsedTitle,
} from "../lib/parse.js";
import type { Candidate, RawTorrent, SearchContext } from "../types.js";

/**
 * Decides whether a torrent is relevant to the request, and whether it is a single item or a pack.
 * Returns null to drop it.
 */
export type MatchResult = { kind: "single" | "pack" } | null;

const has = (xs: number[] | undefined, n: number | undefined) => n !== undefined && !!xs?.includes(n);

const BATCH_HINT = /\b(batch|complete|completa|bd|blu-?ray|bdrip|season|saison|temporada|collection|全集)\b/i;

const matchMovie = (ctx: SearchContext, t: RawTorrent, p: ParsedTitle): MatchResult => {
	if (!t.imdbVerified) {
		if (!titleMatches(p.title || t.title, ctx.matchTitles)) return null;
		const year = Number.parseInt(String(p.year ?? ""), 10);
		if (ctx.year && Number.isFinite(year) && Math.abs(year - ctx.year) > 1) return null;
		// A title without a year is accepted only on an exact name match, to avoid remakes/sequels.
		if (ctx.year && !Number.isFinite(year) && !ctx.isAnime) {
			const exact = ctx.matchTitles.includes(normalizeTitle(p.title || ""));
			if (!exact) return null;
		}
	}
	// Episodes of a show sharing the movie's name.
	if ((p.episodes?.length ?? 0) > 0 && !ctx.isAnime) return null;
	if ((p.seasons?.length ?? 0) > 0 && !ctx.isAnime) return null;
	return { kind: "single" };
};

const matchSeries = (ctx: SearchContext, t: RawTorrent, p: ParsedTitle): MatchResult => {
	const s = ctx.season;
	const e = ctx.episode;
	if (!t.imdbVerified && !titleMatches(p.title || t.title, ctx.matchTitles)) return null;

	// EZTV gives us numbers directly.
	if (t.season !== undefined && t.season > 0) {
		if (t.season !== s) return null;
		if (t.episode && t.episode > 0) return t.episode === e ? { kind: "single" } : null;
	}

	const seasons = p.seasons ?? [];
	const episodes = p.episodes ?? [];
	if (seasons.length && !has(seasons, s)) return null;
	if (episodes.length) {
		if (!has(episodes, e)) return null;
		if (!seasons.length) return null; // "Show 05" without a season is ambiguous for western TV
		return { kind: episodes.length === 1 ? "single" : "pack" };
	}
	if (seasons.length) return { kind: "pack" };
	if (p.complete) return { kind: "pack" };
	return null;
};

const matchAnimeEpisode = (ctx: SearchContext, t: RawTorrent, p: ParsedTitle): MatchResult => {
	const a = ctx.anime!;
	const torrentTitle = p.title || t.title;
	if (!t.imdbVerified && !titleMatches(torrentTitle, ctx.matchTitles)) return null;

	const rel = a.relEpisode;
	const abs = a.absEpisode;
	const imdbS = ctx.season;
	const imdbE = ctx.episode;
	const entryS = a.entrySeason;
	const seasons = p.seasons ?? [];
	const episodes = p.episodes ?? [];

	// Titles naming this specific entry ("Kimetsu no Yaiba - Katanakaji no Sato-hen") count as that season even
	// without a season number. Only meaningful when the entry's name differs from the base name.
	const entrySpecific =
		!a.isFirstEntry &&
		titleMatches(
			torrentTitle,
			a.entryTitles.filter((x) => !a.baseTitles.includes(x)),
		);
	const unnumberedIsUs = a.isFirstEntry || entrySpecific;

	if (t.season !== undefined && t.season > 0) {
		if (t.season !== imdbS) return null;
		if (t.episode && t.episode > 0) return t.episode === imdbE ? { kind: "single" } : null;
	}

	if (seasons.length) {
		const seasonOk = has(seasons, imdbS) || has(seasons, entryS) || (entrySpecific && has(seasons, 1));
		if (episodes.length) {
			const single = episodes.length === 1;
			if (has(seasons, imdbS) && has(episodes, imdbE)) return { kind: single ? "single" : "pack" };
			if ((has(seasons, entryS) || entrySpecific) && has(episodes, rel))
				return { kind: single ? "single" : "pack" };
			// Some groups keep absolute numbering even with a season tag ("S2 - 29").
			if (seasonOk && has(episodes, abs)) return { kind: single ? "single" : "pack" };
			return null;
		}
		return seasonOk ? { kind: "pack" } : null;
	}

	if (episodes.length) {
		const single = episodes.length === 1;
		if (has(episodes, abs)) return { kind: single ? "single" : "pack" };
		if (has(episodes, rel) && unnumberedIsUs) return { kind: single ? "single" : "pack" };
		return null;
	}

	// No numbers at all: a batch of something. Accept when it plausibly is this entry.
	if (unnumberedIsUs && (p.complete || BATCH_HINT.test(t.title))) return { kind: "pack" };
	return null;
};

const matchAnimeMovie = (ctx: SearchContext, t: RawTorrent, p: ParsedTitle): MatchResult => {
	if (
		!t.imdbVerified &&
		!titleMatches(p.title || t.title, ctx.anime!.entryTitles.length ? ctx.anime!.entryTitles : ctx.matchTitles)
	)
		return null;
	if ((p.episodes?.length ?? 0) > 1) return null;
	const year = Number.parseInt(String(p.year ?? ""), 10);
	if (ctx.year && Number.isFinite(year) && Math.abs(year - ctx.year) > 1) return null;
	return { kind: "single" };
};

export const matchTorrent = (ctx: SearchContext, t: RawTorrent, p: ParsedTitle): MatchResult => {
	if (looksNonVideo(t.title, p)) return null;
	if (ctx.anime) return ctx.anime.isMovie ? matchAnimeMovie(ctx, t, p) : matchAnimeEpisode(ctx, t, p);
	return ctx.type === "movie" ? matchMovie(ctx, t, p) : matchSeries(ctx, t, p);
};

const LANG_HINTS: Array<[RegExp, string]> = [
	[/\bdual[ .-]?audio\b/i, "dual audio"],
	[/\bmulti[ .-]?(audio|lang)?\b/i, "multi audio"],
	[/\b(eng(lish)?[ .-]?dub(bed)?|dubbed)\b/i, "en"],
];

/** Source priority when merging duplicates: sites with richer, more reliable titles first. */
const PROVIDER_RANK: Record<string, number> = {
	yts: 0,
	eztv: 1,
	nyaa: 2,
	torboxsearch: 3,
	jackett: 4,
	prowlarr: 4,
	knaben: 5,
	apibay: 6,
	subsplease: 7,
	torrentscsv: 8,
};

/** Merge duplicate hashes from different providers, keeping the best title and the max seeders/size. */
export const dedupe = (torrents: RawTorrent[]): Array<RawTorrent & { sources: string[] }> => {
	const byHash = new Map<string, RawTorrent & { sources: string[] }>();
	for (const t of torrents) {
		const cur = byHash.get(t.infoHash);
		if (!cur) {
			byHash.set(t.infoHash, { ...t, sources: [t.source] });
			continue;
		}
		const better = (PROVIDER_RANK[t.provider] ?? 9) < (PROVIDER_RANK[cur.provider] ?? 9);
		const merged = better ? { ...cur, ...t } : cur;
		merged.seeders = Math.max(cur.seeders ?? 0, t.seeders ?? 0) || undefined;
		merged.size = Math.max(cur.size ?? 0, t.size ?? 0) || undefined;
		merged.imdbVerified = cur.imdbVerified || t.imdbVerified;
		merged.season ??= t.season;
		merged.episode ??= t.episode;
		merged.sources = [...new Set([...(better ? [t.source] : []), ...cur.sources, t.source])];
		byHash.set(t.infoHash, merged);
	}
	return [...byHash.values()];
};

export const toCandidates = (ctx: SearchContext, torrents: RawTorrent[]): Candidate[] => {
	const out: Candidate[] = [];
	for (const t of dedupe(torrents)) {
		const parsed = parseTitle(t.title);
		const m = matchTorrent(ctx, t, parsed);
		if (!m) continue;
		const languages = new Set(parsed.languages ?? []);
		for (const [re, lang] of LANG_HINTS) if (re.test(t.title)) languages.add(lang);
		out.push({
			...t,
			parsed,
			kind: m.kind,
			resolution: normalizeResolution(parsed, t.title),
			qualityGroup: qualityGroupOf(parsed, t.title),
			languages: [...languages],
		});
	}
	return out;
};
