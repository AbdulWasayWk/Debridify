import type { Request, Response } from "express";
import { decodeConfig, env, torboxKeyFor } from "../config.js";
import * as cache from "../lib/cache.js";
import logger from "../lib/logger.js";
import { buildMagnet, normalizeHash } from "../lib/magnet.js";
import { basename, isVideoFile } from "../lib/parse.js";
import { buildContext } from "../meta/context.js";
import { selectFile } from "../search/files.js";
import type { FileInfo } from "../types.js";
import { createTorrent, getTorrent, listTorrents, requestDownload, TorboxError, type TbTorrent } from "./torbox.js";

class NotReadyError extends Error {
	constructor(readonly progress?: number) {
		super("torrent is still downloading on TorBox");
	}
}

const keyId = (key: string) => key.slice(-6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isReady = (t: TbTorrent) =>
	(t.download_present === true || t.download_finished === true || t.download_state === "cached") &&
	(t.files?.length ?? 0) > 0;

/** Find the torrent in the user's TorBox list, or add it. Remembers hash → torrent id. */
const findOrCreate = async (key: string, hash: string): Promise<TbTorrent> => {
	const idKey = `tb:tid:${keyId(key)}:${hash}`;
	const knownId = cache.get<number>(idKey);
	if (knownId) {
		try {
			return await getTorrent(key, knownId);
		} catch {
			cache.del(idKey); // deleted from the dashboard; fall through
		}
	}
	const existing = (await listTorrents(key)).find((t) => t.hash?.toLowerCase() === hash);
	if (existing) {
		cache.set(idKey, existing.id, { ttlMs: 30 * 86_400_000 });
		return existing;
	}
	const created = await createTorrent(key, buildMagnet(hash));
	logger.info({ hash, torrentId: created.torrent_id }, "added torrent to TorBox");
	cache.set(idKey, created.torrent_id, { ttlMs: 30 * 86_400_000 });
	return getTorrent(key, created.torrent_id);
};

const pickFile = async (t: TbTorrent, type: string, id: string, hint: string | undefined): Promise<FileInfo | null> => {
	const files: FileInfo[] = (t.files ?? []).map((f) => ({ index: f.id, name: f.name, size: f.size }));
	if (hint) {
		const byName = files.find((f) => basename(f.name) === hint || f.name === hint);
		if (byName) return byName;
	}
	const ctx = await buildContext(type, id).catch(() => null);
	if (ctx) {
		const chosen = selectFile(ctx, files, "pack");
		if (chosen) return chosen;
	}
	const videos = files.filter((f) => isVideoFile(f.name));
	return videos.length ? videos.reduce((a, b) => (b.size > a.size ? b : a)) : null;
};

const resolveStream = async (key: string, hash: string, type: string, id: string, hint?: string): Promise<string> => {
	let torrent = await findOrCreate(key, hash);
	// Cached torrents become ready within a couple of seconds of being added.
	for (let i = 0; i < 4 && !isReady(torrent); i++) {
		await sleep(1500);
		torrent = await getTorrent(key, torrent.id);
	}
	if (!isReady(torrent)) throw new NotReadyError(torrent.progress);

	const file = await pickFile(torrent, type, id, hint);
	if (!file) throw new TorboxError("no playable video file in torrent");
	logger.info({ hash, file: basename(file.name), size: file.size }, "resolved TorBox stream");
	return requestDownload(key, torrent.id, file.index);
};

const video = (name: "being_cached_message" | "something_went_wrong") => `${env.baseUrl}/public/${name}.mp4`;

/** GET /resolve/torbox/:cfg/:hash/:type/:id/:file? → 302 to the TorBox CDN link. */
export const handleResolve = async (req: Request, res: Response) => {
	const p = req.params as Record<string, string | undefined>;
	const cfg = decodeConfig(p.cfg === "-" ? undefined : p.cfg);
	const key = torboxKeyFor(cfg);
	const hash = normalizeHash(p.hash);
	const type = p.type ?? "movie";
	const id = p.id ?? "";
	const hint = p.file || undefined;

	if (!key || !hash) {
		logger.warn({ hasKey: !!key, hash: p.hash }, "resolve called without TorBox key or valid hash");
		return res.redirect(302, video("something_went_wrong"));
	}

	const linkKey = `tb:link:${keyId(key)}:${hash}:${id}:${hint ?? ""}`;
	const known = cache.get<string>(linkKey);
	if (known) return res.redirect(302, known);

	try {
		const url = await cache.dedupe(linkKey, () => resolveStream(key, hash, type, id, hint));
		// CDN links are valid ~3h to start; keep them a bit less, in memory only.
		cache.set(linkKey, url, { ttlMs: 2 * 3_600_000, memoryOnly: true });
		return res.redirect(302, url);
	} catch (err) {
		if (err instanceof NotReadyError) {
			logger.info({ hash, progress: err.progress }, "not cached yet; TorBox is downloading it");
			return res.redirect(302, video("being_cached_message"));
		}
		logger.error({ err: String(err), hash }, "TorBox resolve failed");
		return res.redirect(302, video("something_went_wrong"));
	}
};
