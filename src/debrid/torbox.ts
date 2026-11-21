import * as cache from "../lib/cache.js";
import { getJson, HttpError, request } from "../lib/http.js";
import logger from "../lib/logger.js";
import type { FileInfo } from "../types.js";

const API = "https://api.torbox.app/v1/api";

interface TbResponse<T> {
	success: boolean;
	error?: string | null;
	detail?: string;
	data: T;
}

export interface TbCachedItem {
	name: string;
	size: number;
	hash: string;
	files?: Array<{ name: string; size: number }>;
}

export interface TbTorrent {
	id: number;
	hash: string;
	name: string;
	size: number;
	download_state?: string;
	download_present?: boolean;
	download_finished?: boolean;
	progress?: number;
	files?: Array<{ id: number; name: string; short_name?: string; size: number; mimetype?: string }>;
}

export class TorboxError extends Error {
	constructor(
		message: string,
		readonly code?: string,
	) {
		super(message);
	}
}

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

const unwrap = <T>(res: TbResponse<T>): T => {
	if (!res.success) throw new TorboxError(res.detail || res.error || "TorBox request failed", res.error ?? undefined);
	return res.data;
};

/** TorBox puts useful error info in the JSON body even on 4xx responses. */
const call = async <T>(fn: () => Promise<TbResponse<T>>): Promise<T> => {
	try {
		return unwrap(await fn());
	} catch (err) {
		if (err instanceof HttpError) {
			try {
				const body = JSON.parse(err.body) as TbResponse<unknown>;
				throw new TorboxError(body.detail || body.error || err.message, body.error ?? undefined);
			} catch (inner) {
				if (inner instanceof TorboxError) throw inner;
			}
		}
		throw err;
	}
};

const CACHE_CHECK_TTL = 15 * 60_000;
const keyId = (key: string) => key.slice(-6);

/**
 * Batch availability check. Returns hash → cached item (with file list). Results are memoised per hash so
 * re-opening a title doesn't re-check everything.
 */
export const checkCached = async (
	key: string,
	hashes: string[],
	timeoutMs = 6000,
): Promise<Map<string, TbCachedItem | null>> => {
	const out = new Map<string, TbCachedItem | null>();
	const todo: string[] = [];
	for (const h of hashes) {
		const hit = cache.get<TbCachedItem | null>(`tb:cached:${h}`);
		if (hit !== undefined) out.set(h, hit);
		else todo.push(h);
	}
	const chunks: string[][] = [];
	for (let i = 0; i < todo.length; i += 90) chunks.push(todo.slice(i, i + 90));
	await Promise.all(
		chunks.map(async (chunk) => {
			try {
				const data = await call(() =>
					getJson<TbResponse<Record<string, TbCachedItem> | null>>(`${API}/torrents/checkcached`, {
						query: { hash: chunk.join(","), format: "object", list_files: "true" },
						headers: auth(key),
						timeoutMs,
					}),
				);
				const found = new Map(Object.entries(data ?? {}).map(([h, v]) => [h.toLowerCase(), v]));
				for (const h of chunk) {
					const item = found.get(h) ?? null;
					out.set(h, item);
					cache.set(`tb:cached:${h}`, item, { ttlMs: CACHE_CHECK_TTL, memoryOnly: true });
				}
			} catch (err) {
				logger.warn({ err: String(err), count: chunk.length }, "TorBox cache check failed");
			}
		}),
	);
	return out;
};

export const cachedFiles = (item: TbCachedItem | null | undefined): FileInfo[] =>
	(item?.files ?? []).map((f, index) => ({ index, name: f.name, size: f.size }));

export const getTorrent = (key: string, id: number) =>
	call(() =>
		getJson<TbResponse<TbTorrent>>(`${API}/torrents/mylist`, {
			query: { id, bypass_cache: "true" },
			headers: auth(key),
			timeoutMs: 8000,
		}),
	);

export const listTorrents = (key: string) =>
	cache.dedupe(`tb:list:${keyId(key)}`, () =>
		call(() =>
			getJson<TbResponse<TbTorrent[]>>(`${API}/torrents/mylist`, {
				query: { bypass_cache: "true", limit: 1000 },
				headers: auth(key),
				timeoutMs: 10_000,
			}),
		),
	);

export const createTorrent = async (key: string, magnet: string): Promise<{ torrent_id: number; hash: string }> => {
	const form = new FormData();
	form.set("magnet", magnet);
	form.set("allow_zip", "false");
	form.set("seed", "3");
	return call(async () => {
		const res = await request(`${API}/torrents/createtorrent`, {
			method: "POST",
			body: form,
			headers: auth(key),
			timeoutMs: 15_000,
		});
		return (await res.json()) as TbResponse<{ torrent_id: number; hash: string }>;
	});
};

export const requestDownload = (key: string, torrentId: number, fileId: number) =>
	call(() =>
		getJson<TbResponse<string>>(`${API}/torrents/requestdl`, {
			query: { token: key, torrent_id: torrentId, file_id: fileId, zip_link: "false" },
			timeoutMs: 10_000,
		}),
	);

export const getUser = (key: string) =>
	call(() =>
		getJson<TbResponse<{ email?: string; plan?: number; premium_expires_at?: string }>>(`${API}/user/me`, {
			headers: auth(key),
			timeoutMs: 8000,
		}),
	);
