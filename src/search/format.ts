import { env } from "../config.js";
import { DEFAULT_TRACKERS } from "../lib/magnet.js";
import { basename, formatBytes, qualityLabel } from "../lib/parse.js";
import type { Candidate, SearchContext, Stream } from "../types.js";

const FLAGS: Record<string, string> = {
	en: "🇬🇧",
	ja: "🇯🇵",
	hi: "🇮🇳",
	ta: "🇮🇳",
	te: "🇮🇳",
	ml: "🇮🇳",
	kn: "🇮🇳",
	bn: "🇮🇳",
	mr: "🇮🇳",
	gu: "🇮🇳",
	pa: "🇮🇳",
	es: "🇪🇸",
	la: "🇲🇽",
	fr: "🇫🇷",
	de: "🇩🇪",
	it: "🇮🇹",
	pt: "🇵🇹",
	ru: "🇷🇺",
	uk: "🇺🇦",
	ko: "🇰🇷",
	zh: "🇨🇳",
	ar: "🇸🇦",
	tr: "🇹🇷",
	pl: "🇵🇱",
	nl: "🇳🇱",
	sv: "🇸🇪",
	no: "🇳🇴",
	da: "🇩🇰",
	fi: "🇫🇮",
	cs: "🇨🇿",
	hu: "🇭🇺",
	ro: "🇷🇴",
	el: "🇬🇷",
	he: "🇮🇱",
	th: "🇹🇭",
	vi: "🇻🇳",
	id: "🇮🇩",
	ms: "🇲🇾",
	fa: "🇮🇷",
	ur: "🇵🇰",
	bg: "🇧🇬",
	hr: "🇭🇷",
	sr: "🇷🇸",
	sk: "🇸🇰",
	lt: "🇱🇹",
	lv: "🇱🇻",
	et: "🇪🇪",
	tl: "🇵🇭",
	zt: "🇹🇼",
};

const RES_LABEL: Record<string, string> = {
	"2160p": "4K",
	"1440p": "1440p",
	"1080p": "1080p",
	"720p": "720p",
	"576p": "576p",
	"480p": "480p",
	"360p": "360p",
	unknown: "SD",
};

const languageLine = (c: Candidate) => {
	const flags = [...new Set(c.languages.map((l) => FLAGS[l]).filter(Boolean))];
	const tags: string[] = [];
	if (c.languages.includes("dual audio")) tags.push("Dual Audio");
	if (c.languages.includes("multi audio")) tags.push("Multi Audio");
	if (c.languages.includes("multi subs")) tags.push("Multi Subs");
	return [flags.join(" "), tags.join(" · ")].filter(Boolean).join("  ");
};

const techLine = (c: Candidate) => {
	const p = c.parsed;
	const parts = [
		qualityLabel(p, c.qualityGroup),
		p.codec?.toUpperCase(),
		p.bitDepth,
		...(p.hdr ?? []),
		[...(p.audio ?? []), ...(p.channels ?? [])].join(" ") || undefined,
	].filter(Boolean);
	return parts.length ? `🎞️ ${parts.join(" · ")}` : "";
};

const describe = (c: Candidate) => {
	const lines = [c.title];
	if (c.file && c.kind === "pack") lines.push(`📄 ${basename(c.file.name)}`);
	const size = c.file?.size ?? c.size;
	const seeders = c.seeders !== undefined ? `👤 ${c.seeders}  ` : "";
	lines.push(`${seeders}💾 ${formatBytes(size)}  ⚙️ ${c.sources.slice(0, 2).join(", ")}`);
	const tech = techLine(c);
	if (tech) lines.push(tech);
	const lang = languageLine(c);
	if (lang) lines.push(lang);
	return lines.join("\n");
};

const resLabel = (c: Candidate) => {
	const hdr = c.parsed.hdr?.length ? (c.parsed.hdr.includes("DV") ? " DV" : " HDR") : "";
	return `${RES_LABEL[c.resolution]}${hdr}${c.qualityGroup === "cam" ? " CAM" : ""}`;
};

const bingeGroup = (c: Candidate, mode: string) =>
	`debridify|${mode}|${c.resolution}|${c.qualityGroup}|${c.parsed.group ?? ""}`;

export const toTorboxStream = (ctx: SearchContext, c: Candidate, cfgSegment: string): Stream => {
	const tag = c.cached ? "[TB⚡]" : "[TB⏳]";
	const file = c.file ? `/${encodeURIComponent(basename(c.file.name))}` : "";
	const url = `${env.baseUrl}/resolve/torbox/${cfgSegment}/${c.infoHash}/${ctx.type}/${encodeURIComponent(ctx.id)}${file}`;
	const desc = describe(c);
	return {
		name: `${tag} Debridify\n${resLabel(c)}`,
		// Only `title`: stremio-core aliases it to `description`, so sending both is a duplicate-field error
		// and Stremio silently drops the whole response.
		title: desc,
		url,
		behaviorHints: {
			bingeGroup: bingeGroup(c, "tb"),
			filename: c.file ? basename(c.file.name) : undefined,
			videoSize: c.file?.size ?? (c.kind === "single" ? c.size : undefined),
		},
	};
};

export const toP2PStream = (c: Candidate): Stream => {
	const desc = describe(c);
	const trackers = c.trackers?.length ? c.trackers : DEFAULT_TRACKERS;
	return {
		name: `[P2P] Debridify\n${resLabel(c)}`,
		title: desc,
		infoHash: c.infoHash,
		sources: [...trackers.map((t) => `tracker:${t}`), `dht:${c.infoHash}`],
		behaviorHints: {
			bingeGroup: bingeGroup(c, "p2p"),
			filename: c.file ? basename(c.file.name) : undefined,
			notWebReady: true,
		},
	};
};
