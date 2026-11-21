import { pad2 } from "../lib/parse.js";
import type { SearchContext } from "../types.js";

/** Strip characters that hurt full-text search on torrent sites ("Frieren: Beyond…" → "Frieren Beyond…"). */
const clean = (s: string) =>
	s
		.replace(/[:!?,'’"()[\]]/g, " ")
		.replace(/\s+-\s+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const uniq = (xs: string[]) => [...new Set(xs.map(clean).filter(Boolean))];

/** Title-based queries for general trackers (TPB, 1337x, RuTracker... via Knaben/apibay). */
export const generalQueries = (ctx: SearchContext): string[] => {
	const titles = ctx.isAnime ? ctx.queryTitles.slice(0, 2) : ctx.queryTitles.slice(0, 1);
	const out: string[] = [];
	for (const t of titles) {
		if (ctx.type === "movie") {
			out.push(ctx.year ? `${t} ${ctx.year}` : t);
		} else if (ctx.season !== undefined && ctx.episode !== undefined) {
			out.push(`${t} S${pad2(ctx.season)}E${pad2(ctx.episode)}`);
			out.push(`${t} S${pad2(ctx.season)}`);
		}
	}
	// Anime episodes are often only labelled by number.
	if (ctx.anime && !ctx.anime.isMovie) out.push(...animeQueries(ctx).slice(0, 2));
	return uniq(out);
};

/** Queries tuned for anime trackers (Nyaa/SubsPlease naming: "[Group] Title S2 - 05"). */
export const animeQueries = (ctx: SearchContext): string[] => {
	const a = ctx.anime;
	if (!a) return [];
	const entry = a.queryTitles[0] ?? ctx.queryTitles[0] ?? ctx.name;
	const english = a.queryTitles[1];
	const base = a.baseQueryTitle ?? entry;
	if (a.isMovie) return uniq([entry, english ?? "", ctx.name]);

	const out: string[] = [];
	const rel = a.relEpisode;
	const abs = a.absEpisode;
	if (rel !== undefined) out.push(`${entry} ${pad2(rel)}`);
	if (abs !== undefined && abs !== rel) out.push(`${base} ${pad2(abs)}`);
	if (!a.isFirstEntry && a.entrySeason && rel !== undefined) out.push(`${base} S${a.entrySeason} ${pad2(rel)}`);
	// Title-only search surfaces batches and season packs.
	out.push(entry);
	if (english && rel !== undefined) out.push(`${english} ${pad2(rel)}`);
	return uniq(out).slice(0, 5);
};
