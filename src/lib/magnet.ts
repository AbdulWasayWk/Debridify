const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32ToHex = (b32: string): string | null => {
	let bits = "";
	for (const ch of b32.toUpperCase()) {
		const v = BASE32.indexOf(ch);
		if (v < 0) return null;
		bits += v.toString(2).padStart(5, "0");
	}
	let hex = "";
	for (let i = 0; i + 4 <= bits.length; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
	return hex.slice(0, 40);
};

/** Normalise an info hash (hex or base32) to 40-char lowercase hex, or null if invalid. */
export const normalizeHash = (h: string | null | undefined): string | null => {
	if (!h) return null;
	const s = h.trim();
	if (/^[a-f0-9]{40}$/i.test(s)) return s.toLowerCase();
	if (/^[a-z2-7]{32}$/i.test(s)) return base32ToHex(s);
	return null;
};

export interface ParsedMagnet {
	infoHash: string;
	name?: string;
	size?: number;
	trackers: string[];
}

export const parseMagnet = (magnet: string | null | undefined): ParsedMagnet | null => {
	if (!magnet?.startsWith("magnet:?")) return null;
	const params = new URLSearchParams(magnet.slice("magnet:?".length));
	const xt = params.getAll("xt").find((x) => x.toLowerCase().startsWith("urn:btih:"));
	const infoHash = normalizeHash(xt?.slice("urn:btih:".length));
	if (!infoHash) return null;
	const xl = Number(params.get("xl"));
	return {
		infoHash,
		name: params.get("dn") ?? undefined,
		size: Number.isFinite(xl) && xl > 0 ? xl : undefined,
		trackers: params.getAll("tr"),
	};
};

export const DEFAULT_TRACKERS = [
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
	"udp://exodus.desync.com:6969/announce",
	"udp://open.demonii.com:1337/announce",
	"udp://tracker.dler.org:6969/announce",
	"http://nyaa.tracker.wf:7777/announce",
];

export const buildMagnet = (infoHash: string, name?: string, trackers: string[] = DEFAULT_TRACKERS) => {
	const parts = [`xt=urn:btih:${infoHash}`];
	if (name) parts.push(`dn=${encodeURIComponent(name)}`);
	for (const tr of trackers) parts.push(`tr=${encodeURIComponent(tr)}`);
	return `magnet:?${parts.join("&")}`;
};
