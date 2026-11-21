/**
 * Run the full pipeline from the CLI: npm run smoke -- <id> [type] [--fresh]
 *   npm run smoke -- tt0111161            (movie)
 *   npm run smoke -- tt0944947:1:1        (series)
 *   npm run smoke -- kitsu:46474:5        (anime via Kitsu id)
 */
import { DEFAULT_CONFIG } from "../src/config.js";
import * as cache from "../src/lib/cache.js";
import { formatBytes } from "../src/lib/parse.js";
import { search } from "../src/search/streams.js";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const [id, typeArg] = args.filter((a) => !a.startsWith("--"));
if (!id) {
	console.error("usage: npm run smoke -- <stremio id> [movie|series] [--fresh]");
	process.exit(1);
}
const type = typeArg ?? (id.split(":").length > 2 || /^kitsu:\d+:\d+$/.test(id) ? "series" : "movie");

if (fresh) {
	// Drop cached candidates/context for this id so providers are queried live.
	for (const k of [`ctx:v2:${type}:${id}`]) cache.del(k);
}

const started = Date.now();
const out = await search(type, id, { ...DEFAULT_CONFIG, maxResults: 0 });
const ms = Date.now() - started;

const ctx = out.ctx;
console.log("\n=== context ===");
console.log(
	JSON.stringify(
		ctx && {
			id: ctx.id,
			type: ctx.type,
			name: ctx.name,
			year: ctx.year,
			imdb: ctx.imdbId,
			season: ctx.season,
			episode: ctx.episode,
			isAnime: ctx.isAnime,
			anime: ctx.anime && {
				kitsu: ctx.anime.kitsuId,
				rel: ctx.anime.relEpisode,
				abs: ctx.anime.absEpisode,
				entrySeason: ctx.anime.entrySeason,
				first: ctx.anime.isFirstEntry,
				queryTitles: ctx.anime.queryTitles,
				base: ctx.anime.baseQueryTitle,
			},
			matchTitles: ctx.matchTitles,
		},
		null,
		2,
	),
);
if (out.report) {
	console.log("\n=== providers ===");
	for (const [k, v] of Object.entries(out.report))
		console.log(
			`${k.padEnd(13)} ${v.error ? `ERROR ${v.error}` : v.skipped ? `skipped (${v.skipped})` : `${v.count} results in ${v.ms}ms`}`,
		);
} else console.log("\n(providers served from cache)");

console.log(
	`\n=== ${out.ranked.length} streams (${out.candidates.length} matched) in ${ms}ms ${JSON.stringify(out.timings)} ===`,
);
for (const c of out.ranked.slice(0, 40)) {
	const flag = c.cached === undefined ? "    " : c.cached ? "⚡   " : "⏳   ";
	console.log(
		`${flag}${c.resolution.padEnd(7)} ${c.kind.padEnd(6)} 👤${String(c.seeders ?? "?").padEnd(5)} ${formatBytes(c.file?.size ?? c.size).padEnd(10)} ${c.sources[0]!.padEnd(14)} ${c.title}${c.file ? `  →  ${c.file.name}` : ""}`,
	);
}
process.exit(0);
