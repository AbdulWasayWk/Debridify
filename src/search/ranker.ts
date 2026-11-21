import { ALL_RESOLUTIONS, type QualityGroup, type UserConfig } from "../config.js";
import type { Candidate } from "../types.js";

const RES_RANK = Object.fromEntries(ALL_RESOLUTIONS.map((r, i) => [r, ALL_RESOLUTIONS.length - i])) as Record<
	string,
	number
>;
const QUALITY_RANK: Record<QualityGroup, number> = { remux: 6, bluray: 5, web: 4, hdtv: 3, dvd: 2, unknown: 1, cam: 0 };

const sizeOf = (c: Candidate) => c.file?.size ?? c.size ?? 0;
const upscaled = (c: Candidate) => /\b(ai[ ._-]?upscal\w*|upscal\w*)\b/i.test(c.title);

const languageMatch = (c: Candidate, langs: string[]) =>
	langs.length > 0 && c.languages.some((l) => langs.includes(l) || l === "multi audio" || l === "dual audio");

export const rankCandidates = (cands: Candidate[], cfg: UserConfig, debrid: boolean): Candidate[] => {
	const maxBytes = cfg.maxSizeGb > 0 ? cfg.maxSizeGb * 1024 ** 3 : Infinity;
	const filtered = cands.filter(
		(c) =>
			!cfg.excludeResolutions.includes(c.resolution) &&
			!cfg.excludeQualities.includes(c.qualityGroup) &&
			sizeOf(c) <= maxBytes &&
			(!debrid || !cfg.cachedOnly || c.cached),
	);

	const cmp = (a: Candidate, b: Candidate): number => {
		if (debrid && !!a.cached !== !!b.cached) return a.cached ? -1 : 1;
		const camA = a.qualityGroup === "cam" ? 1 : 0;
		const camB = b.qualityGroup === "cam" ? 1 : 0;
		if (camA !== camB) return camA - camB;
		const langA = languageMatch(a, cfg.languages) ? 1 : 0;
		const langB = languageMatch(b, cfg.languages) ? 1 : 0;
		if (langA !== langB) return langB - langA;

		switch (cfg.sort) {
			case "seeders":
				return (b.seeders ?? 0) - (a.seeders ?? 0) || sizeOf(b) - sizeOf(a);
			case "size":
				return sizeOf(b) - sizeOf(a);
			case "qualitysize":
				return RES_RANK[b.resolution]! - RES_RANK[a.resolution]! || sizeOf(b) - sizeOf(a);
			default: {
				const r = RES_RANK[b.resolution]! - RES_RANK[a.resolution]!;
				if (r) return r;
				const up = (upscaled(a) ? 1 : 0) - (upscaled(b) ? 1 : 0);
				if (up) return up;
				// An uncached pack means downloading a whole season; a single episode is quicker.
				if (!(a.cached && b.cached) && a.kind !== b.kind) return a.kind === "single" ? -1 : 1;
				// For cached results seeders barely matter; prefer better sources and single files.
				if (debrid && a.cached && b.cached) {
					const q = QUALITY_RANK[b.qualityGroup] - QUALITY_RANK[a.qualityGroup];
					if (q) return q;
				}
				return (b.seeders ?? 0) - (a.seeders ?? 0) || sizeOf(b) - sizeOf(a);
			}
		}
	};
	filtered.sort(cmp);

	const perRes = new Map<string, number>();
	const out: Candidate[] = [];
	for (const c of filtered) {
		if (cfg.maxPerResolution > 0) {
			const n = perRes.get(c.resolution) ?? 0;
			if (n >= cfg.maxPerResolution) continue;
			perRes.set(c.resolution, n + 1);
		}
		out.push(c);
		if (cfg.maxResults > 0 && out.length >= cfg.maxResults) break;
	}
	return out;
};
