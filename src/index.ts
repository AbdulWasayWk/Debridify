import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { decodeConfig, env, torboxKeyFor } from "./config.js";
import { handleResolve } from "./debrid/resolve.js";
import { getUser } from "./debrid/torbox.js";
import { stats } from "./lib/cache.js";
import logger from "./lib/logger.js";
import { initAnimeMap } from "./meta/animeMap.js";
import { providerHealth } from "./providers/index.js";
import { search } from "./search/streams.js";
import { configurePage } from "./web/configure.js";

const VERSION = "2.0.0";

const manifest = () => ({
	id: "com.abdulwasaywk.debridify",
	version: VERSION,
	name: "Debridify",
	description:
		"Live torrent search for movies, series and anime (Nyaa, SubsPlease, YTS, EZTV, TPB, 1337x/RuTracker via Knaben…), streamed through TorBox.",
	logo: `${env.baseUrl}/public/logo.svg`,
	resources: ["stream"],
	types: ["movie", "series", "anime", "other"],
	idPrefixes: ["tt", "kitsu", "mal", "anilist", "anidb"],
	catalogs: [],
	behaviorHints: { configurable: true, configurationRequired: false },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Access log: one line per request. The base64 config segment (may hold an API key) is masked.
app.use((req: Request, res: Response, next: NextFunction) => {
	const started = Date.now();
	res.on("finish", () => {
		if (req.path.startsWith("/public") || req.path === "/health") return;
		const p = req.path.replace(/^\/[A-Za-z0-9_-]{20,}(?=\/)/, "/<cfg>").replace(/\/resolve\/torbox\/[^/]+/, "/resolve/torbox/<cfg>");
		logger.info(
			{ status: res.statusCode, ms: Date.now() - started, client: req.get("origin") ?? req.get("user-agent")?.slice(0, 60) },
			`${req.method} ${p}`,
		);
	});
	next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
	// Chrome's Private Network Access: lets Stremio Web (https) call this addon on localhost/LAN.
	res.setHeader("Access-Control-Allow-Private-Network", "true");
	if (req.method === "OPTIONS") return res.sendStatus(204);
	next();
});

app.use("/public", express.static(path.resolve("public"), { maxAge: "7d" }));

app.get("/", (_req, res) => res.redirect("/configure"));

app.get(["/configure", "/:cfg/configure"], (req, res) => {
	const cfg = decodeConfig(req.params.cfg as string | undefined);
	res.type("html").send(configurePage(cfg, !!env.torboxApiKey));
});

app.get(["/manifest.json", "/:cfg/manifest.json"], (req, res) => {
	res.setHeader("Cache-Control", "no-cache");
	res.json(manifest());
});

const streamHandler = async (req: Request, res: Response) => {
	const cfgSegment = (req.params.cfg as string | undefined) ?? "-";
	const cfg = decodeConfig(cfgSegment === "-" ? undefined : cfgSegment);
	const type = req.params.type as string;
	const id = (req.params.id as string).replace(/\.json$/, "");
	const started = Date.now();
	try {
		const out = await search(type, id, cfg, cfgSegment);
		logger.info(
			{
				type,
				id,
				title: out.ctx?.name,
				anime: out.ctx?.anime
					? { kitsu: out.ctx.anime.kitsuId, rel: out.ctx.anime.relEpisode, abs: out.ctx.anime.absEpisode }
					: undefined,
				streams: out.streams.length,
				cached: out.ranked.filter((c) => c.cached).length,
				client: req.get("origin") ?? req.get("user-agent")?.slice(0, 80),
				ms: Date.now() - started,
				timings: out.timings,
			},
			"stream request",
		);
		// No client-side caching: Stremio's webview would otherwise replay old responses for minutes. The server
		// cache (SQLite + memory) already makes repeat requests take milliseconds.
		res.setHeader("Cache-Control", "no-store");
		res.json({ streams: out.streams });
	} catch (err) {
		logger.error({ err, type, id }, "stream request failed");
		res.json({ streams: [] });
	}
};

app.get(["/stream/:type/:id", "/:cfg/stream/:type/:id"], streamHandler);

app.get("/resolve/torbox/:cfg/:hash/:type/:id{/:file}", handleResolve);

app.get("/health", async (req, res) => {
	const key = torboxKeyFor(decodeConfig(undefined));
	let torbox: unknown = "no key configured";
	if (key && req.query.torbox !== "0") {
		try {
			const u = await getUser(key);
			torbox = { ok: true, plan: u.plan, premiumUntil: u.premium_expires_at };
		} catch (err) {
			torbox = { ok: false, error: String(err) };
		}
	}
	res.json({ version: VERSION, torbox, providers: providerHealth(), cache: stats() });
});

app.use((_req, res) => res.status(404).json({ error: "not found" }));

initAnimeMap();

app.listen(env.port, env.host, () => {
	logger.info(`Debridify ${VERSION} listening on ${env.host}:${env.port}`);
	logger.info(`Install: ${env.baseUrl}/manifest.json  ·  Configure: ${env.baseUrl}/configure`);
	if (!env.torboxApiKey)
		logger.warn("TORBOX_API_KEY not set: returning P2P streams unless a key is set on /configure");
});
