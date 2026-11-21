import { basename, isVideoFile, parseTitle } from "../lib/parse.js";
import type { FileInfo, SearchContext } from "../types.js";

const has = (xs: number[] | undefined, n: number | undefined) => n !== undefined && !!xs?.includes(n);

/**
 * Score how well a file matches the requested episode: 3 = exact season+episode, 2 = absolute number,
 * 1 = episode number without a conflicting season, 0 = no match.
 */
const episodeScore = (ctx: SearchContext, path: string): number => {
	const file = parseTitle(basename(path));
	const full = parseTitle(path.replace(/[\\/]/g, " "));
	const seasons = file.seasons?.length ? file.seasons : (full.seasons ?? []);
	const episodes = file.episodes ?? [];
	if (!episodes.length) return 0;
	const s = ctx.season;
	const e = ctx.episode;
	const a = ctx.anime;

	if (has(seasons, s) && has(episodes, e)) return 3;
	if (a) {
		if (has(seasons, a.entrySeason) && has(episodes, a.relEpisode)) return 3;
		if (has(episodes, a.absEpisode) && a.absEpisode !== a.relEpisode) return 2;
		if (!seasons.length && has(episodes, a.relEpisode)) return 1;
		if (!seasons.length && has(episodes, a.absEpisode)) return 1;
		return 0;
	}
	if (!seasons.length && has(episodes, e)) return 1;
	return 0;
};

/**
 * Pick the file to play. Movies / single episodes: the best match or the largest video. Packs: only a file
 * that actually matches the episode — returning null tells the caller the pack doesn't contain it.
 */
export const selectFile = (ctx: SearchContext, files: FileInfo[], kind: "single" | "pack"): FileInfo | null => {
	const videos = files.filter((f) => isVideoFile(f.name));
	if (!videos.length) return null;
	const largest = () => videos.reduce((a, b) => (b.size > a.size ? b : a));

	const episodic = ctx.type === "series" && !ctx.anime?.isMovie;
	if (!episodic) return largest();
	if (videos.length === 1 && kind === "single") return videos[0]!;

	let best: FileInfo | null = null;
	let bestScore = 0;
	for (const f of videos) {
		const score = episodeScore(ctx, f.name);
		// Tie-break on single-episode files, then size.
		if (score > bestScore || (score === bestScore && score > 0 && best && f.size > best.size)) {
			best = f;
			bestScore = score;
		}
	}
	if (best) return best;
	return kind === "single" ? largest() : null;
};
