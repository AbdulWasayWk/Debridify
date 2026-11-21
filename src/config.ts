import "dotenv/config";
import path from "node:path";

const int = (v: string | undefined, def: number) => {
	const n = Number.parseInt(v ?? "", 10);
	return Number.isFinite(n) ? n : def;
};

const list = (v: string | undefined) =>
	(v ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);

const PORT = int(process.env.PORT, 7000);

export const env = {
	port: PORT,
	host: process.env.HOST || "0.0.0.0",
	baseUrl: (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, ""),
	torboxApiKey: process.env.TORBOX_API_KEY?.trim() || "",
	providerTimeoutMs: int(process.env.PROVIDER_TIMEOUT_MS, 7000),
	disabledProviders: new Set(list(process.env.DISABLED_PROVIDERS)),
	jackett: { url: process.env.JACKETT_URL?.replace(/\/+$/, "") || "", apiKey: process.env.JACKETT_API_KEY || "" },
	prowlarr: { url: process.env.PROWLARR_URL?.replace(/\/+$/, "") || "", apiKey: process.env.PROWLARR_API_KEY || "" },
	logLevel: process.env.LOG_LEVEL || "info",
	logPretty: process.env.LOG_PRETTY !== "false",
	dataDir: path.resolve(process.env.DATA_DIR || "./data"),
};

export type SortMode = "quality" | "qualitysize" | "seeders" | "size";

export const ALL_RESOLUTIONS = ["2160p", "1440p", "1080p", "720p", "576p", "480p", "360p", "unknown"] as const;
export type Resolution = (typeof ALL_RESOLUTIONS)[number];

export const QUALITY_GROUPS = ["remux", "bluray", "web", "hdtv", "dvd", "cam", "unknown"] as const;
export type QualityGroup = (typeof QUALITY_GROUPS)[number];

/** Per-install preferences. Encoded in the addon URL so different Stremio installs can differ. */
export interface UserConfig {
	/** Optional TorBox key override (otherwise TORBOX_API_KEY from env). */
	torboxKey?: string;
	sort: SortMode;
	/** Show only TorBox-cached results. */
	cachedOnly: boolean;
	/** Resolutions to hide. */
	excludeResolutions: Resolution[];
	/** Quality groups to hide (cam = CAM/TS/TC/SCR). */
	excludeQualities: QualityGroup[];
	/** Max streams per resolution (0 = unlimited). */
	maxPerResolution: number;
	/** Max streams overall (0 = unlimited). */
	maxResults: number;
	/** Max size in GB (0 = unlimited). */
	maxSizeGb: number;
	/** Preferred audio languages (ISO 639-1); matching results get a ranking boost. */
	languages: string[];
	/** Also return P2P (non-debrid) streams. */
	includeP2P: boolean;
}

export const DEFAULT_CONFIG: UserConfig = {
	sort: "quality",
	cachedOnly: false,
	excludeResolutions: [],
	excludeQualities: ["cam"],
	maxPerResolution: 0,
	maxResults: 60,
	maxSizeGb: 0,
	languages: [],
	includeP2P: false,
};

export const encodeConfig = (cfg: Partial<UserConfig>): string =>
	Buffer.from(JSON.stringify(cfg), "utf8").toString("base64url");

/** Decode the URL config segment. Unknown/invalid input falls back to defaults rather than failing. */
export const decodeConfig = (segment: string | undefined): UserConfig => {
	if (!segment) return { ...DEFAULT_CONFIG };
	try {
		const raw = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Partial<UserConfig>;
		return sanitizeConfig(raw);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
};

export const sanitizeConfig = (raw: Partial<UserConfig>): UserConfig => {
	const c = { ...DEFAULT_CONFIG };
	if (typeof raw.torboxKey === "string" && raw.torboxKey.trim()) c.torboxKey = raw.torboxKey.trim();
	if (raw.sort && ["quality", "qualitysize", "seeders", "size"].includes(raw.sort)) c.sort = raw.sort;
	if (typeof raw.cachedOnly === "boolean") c.cachedOnly = raw.cachedOnly;
	if (typeof raw.includeP2P === "boolean") c.includeP2P = raw.includeP2P;
	if (Array.isArray(raw.excludeResolutions))
		c.excludeResolutions = raw.excludeResolutions.filter((r): r is Resolution =>
			(ALL_RESOLUTIONS as readonly string[]).includes(r),
		);
	if (Array.isArray(raw.excludeQualities))
		c.excludeQualities = raw.excludeQualities.filter((q): q is QualityGroup =>
			(QUALITY_GROUPS as readonly string[]).includes(q),
		);
	if (Array.isArray(raw.languages))
		c.languages = raw.languages.filter((l) => typeof l === "string" && /^[a-z]{2}$/.test(l));
	for (const k of ["maxPerResolution", "maxResults", "maxSizeGb"] as const) {
		const v = Number(raw[k]);
		if (Number.isFinite(v) && v >= 0) c[k] = Math.floor(v);
	}
	return c;
};

export const torboxKeyFor = (cfg: UserConfig) => cfg.torboxKey || env.torboxApiKey;
