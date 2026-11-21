import { parseTorrentTitle } from "@viren070/parse-torrent-title";
import type { QualityGroup, Resolution } from "../config.js";

export type ParsedTitle = ReturnType<typeof parseTorrentTitle>;

const memo = new Map<string, ParsedTitle>();

/** Memoised wrapper around the PTT parser (titles repeat a lot across providers and requests). */
export const parseTitle = (title: string): ParsedTitle => {
	let p = memo.get(title);
	if (!p) {
		try {
			p = parseTorrentTitle(title);
		} catch {
			p = { title } as ParsedTitle;
		}
		memo.set(title, p);
		if (memo.size > 20_000) memo.delete(memo.keys().next().value as string);
	}
	return p;
};

export const normalizeResolution = (p: ParsedTitle, raw: string): Resolution => {
	const r = (p.resolution ?? "").toLowerCase();
	if (r === "4k" || r === "2160p" || (!r && /\b(uhd|2160p|4k)\b/i.test(raw))) return "2160p";
	if (r === "1440p" || r === "2k") return "1440p";
	if (r === "1080p" || r === "1080i") return "1080p";
	if (r === "720p") return "720p";
	if (r === "576p") return "576p";
	if (r === "480p") return "480p";
	if (r === "360p" || r === "240p") return "360p";
	return "unknown";
};

export const qualityGroupOf = (p: ParsedTitle, raw: string): QualityGroup => {
	const q = (p.quality ?? "").toLowerCase();
	if (/cam|telesync|telecine|scr|\bts\b|\btc\b/.test(q)) return "cam";
	if (q.includes("remux") || /\bremux\b/i.test(raw)) return "remux";
	if (/blu|bd|br|uhdrip/.test(q)) return "bluray";
	if (q.includes("web")) return "web";
	if (/hdtv|pdtv|tvrip|satrip|ppv|dsr/.test(q)) return "hdtv";
	if (q.includes("dvd")) return "dvd";
	if (/\b(bd|bluray|blu-ray|bdrip)\b/i.test(raw)) return "bluray";
	if (/\b(web-?dl|webrip|web)\b/i.test(raw)) return "web";
	return "unknown";
};

const QUALITY_LABEL: Record<QualityGroup, string> = {
	remux: "REMUX",
	bluray: "BluRay",
	web: "WEB",
	hdtv: "HDTV",
	dvd: "DVD",
	cam: "CAM",
	unknown: "",
};
export const qualityLabel = (p: ParsedTitle, g: QualityGroup) => p.quality || QUALITY_LABEL[g];

/** Lowercase, strip accents/punctuation, collapse whitespace. Used for title comparison. */
export const normalizeTitle = (s: string): string =>
	s
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/['’`]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/^the /, "")
		.trim();

const tokens = (s: string) => new Set(s.split(" ").filter(Boolean));

/** Split titles like "Frieren - Beyond Journey's End (Sousou no Frieren)" into their alternative names. */
const titleVariants = (title: string): string[] => {
	const out = new Set<string>([normalizeTitle(title)]);
	for (const part of title.split(/[()[\]|/]| aka /i)) {
		const n = normalizeTitle(part);
		if (n.length >= 2) out.add(n);
	}
	return [...out].filter(Boolean);
};

/**
 * Does a torrent's title refer to one of the candidate names? Exact (normalised) match, or the torrent title is
 * the candidate followed by at most two extra tokens ("The Office US", "Dune 2021"), or a near-identical token set.
 */
export const titleMatches = (torrentTitle: string, candidates: readonly string[]): boolean => {
	if (!torrentTitle) return false;
	const variants = titleVariants(torrentTitle);
	for (const c of candidates) {
		if (!c) continue;
		const ct = tokens(c);
		for (const t of variants) {
			if (t === c) return true;
			if (t.startsWith(c + " ") && t.slice(c.length).trim().split(" ").length <= 2) return true;
			const tt = tokens(t);
			if (tt.size >= 3 && ct.size >= 3) {
				let inter = 0;
				for (const x of tt) if (ct.has(x)) inter++;
				if (inter / (tt.size + ct.size - inter) >= 0.8) return true;
			}
		}
	}
	return false;
};

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|wmv|ts|m2ts|webm|flv|mpg|mpeg|ogm|divx)$/i;
export const isVideoFile = (name: string) => VIDEO_EXT.test(name) && !/\bsample\b/i.test(name);

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

const NON_VIDEO =
	/\b(ost|soundtrack|flac|mp3|aac2\.0 only|ebook|epub|pdf|cbz|cbr|manga|artbook|game|repack-fitgirl)\b/i;
export const looksNonVideo = (raw: string, p: ParsedTitle) => !p.resolution && !p.quality && NON_VIDEO.test(raw);

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const formatBytes = (bytes?: number): string => {
	if (!bytes || bytes <= 0) return "?";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let v = bytes;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
};

/** "6.6 GiB", "850 MB" → bytes. */
export const parseSize = (s: string | undefined | null): number | undefined => {
	if (!s) return undefined;
	const m = /([\d.,]+)\s*([KMGT]?i?B)/i.exec(s);
	if (!m) return undefined;
	const n = Number.parseFloat(m[1]!.replace(",", "."));
	const unit = m[2]!.toUpperCase().replace("I", "");
	const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] ?? 1;
	return Math.round(n * mult);
};
