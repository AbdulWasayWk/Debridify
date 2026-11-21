import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { env } from "../config.js";
import logger from "./logger.js";

/**
 * Two-tier cache: a bounded in-memory map in front of a SQLite key/value table, so results survive restarts.
 * Every entry has a `fresh` deadline and a hard `expires` deadline; between the two an entry is "stale"
 * and can be served while a refresh runs in the background (stale-while-revalidate).
 */

interface Entry<T = unknown> {
	v: T;
	fresh: number;
	expires: number;
}

const MEMORY_MAX = 5000;
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

let db: DatabaseSync | null = null;
let stmtGet: StatementSync, stmtSet: StatementSync, stmtDel: StatementSync, stmtPrune: StatementSync;

const openDb = () => {
	if (db) return db;
	fs.mkdirSync(env.dataDir, { recursive: true });
	db = new DatabaseSync(path.join(env.dataDir, "cache.sqlite"));
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, fresh INTEGER NOT NULL, expires INTEGER NOT NULL);
		CREATE INDEX IF NOT EXISTS kv_expires ON kv(expires);
	`);
	stmtGet = db.prepare("SELECT value, fresh, expires FROM kv WHERE key = ?");
	stmtSet = db.prepare("INSERT OR REPLACE INTO kv (key, value, fresh, expires) VALUES (?, ?, ?, ?)");
	stmtDel = db.prepare("DELETE FROM kv WHERE key = ?");
	stmtPrune = db.prepare("DELETE FROM kv WHERE expires < ?");
	stmtPrune.run(Date.now());
	setInterval(() => {
		try {
			stmtPrune.run(Date.now());
		} catch (err) {
			logger.warn({ err }, "cache prune failed");
		}
	}, 30 * 60_000).unref();
	return db;
};

const remember = (key: string, e: Entry) => {
	if (memory.has(key)) memory.delete(key);
	memory.set(key, e);
	if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
};

const read = <T>(key: string): Entry<T> | undefined => {
	const now = Date.now();
	const m = memory.get(key) as Entry<T> | undefined;
	if (m) {
		if (m.expires > now) return m;
		memory.delete(key);
	}
	try {
		openDb();
		const row = stmtGet.get(key) as { value: string; fresh: number; expires: number } | undefined;
		if (!row) return undefined;
		if (row.expires <= now) {
			stmtDel.run(key);
			return undefined;
		}
		const e: Entry<T> = { v: JSON.parse(row.value) as T, fresh: row.fresh, expires: row.expires };
		remember(key, e);
		return e;
	} catch (err) {
		logger.warn({ err, key }, "cache read failed");
		return undefined;
	}
};

export interface SetOptions {
	/** How long the value is considered fresh. */
	ttlMs: number;
	/** How long a stale value may still be served (defaults to ttlMs, i.e. no stale window). */
	maxAgeMs?: number;
	/** Keep in memory only (for secrets/short-lived data such as CDN links). */
	memoryOnly?: boolean;
}

export const set = <T>(key: string, value: T, opts: SetOptions) => {
	const now = Date.now();
	const e: Entry<T> = { v: value, fresh: now + opts.ttlMs, expires: now + Math.max(opts.ttlMs, opts.maxAgeMs ?? 0) };
	remember(key, e);
	if (opts.memoryOnly) return;
	try {
		openDb();
		stmtSet.run(key, JSON.stringify(value), e.fresh, e.expires);
	} catch (err) {
		logger.warn({ err, key }, "cache write failed");
	}
};

export const get = <T>(key: string): T | undefined => read<T>(key)?.v;

export const del = (key: string) => {
	memory.delete(key);
	try {
		openDb();
		stmtDel.run(key);
	} catch {
		/* ignore */
	}
};

/** Run `fn` once per key at a time; concurrent callers share the same promise. */
export const dedupe = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
	const existing = inflight.get(key) as Promise<T> | undefined;
	if (existing) return existing;
	const p = fn().finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
};

export interface CachedOptions<T> extends SetOptions {
	/** Return false to skip caching a result (e.g. empty arrays from a flaky source). */
	shouldCache?: (value: T) => boolean;
}

/**
 * Get-or-compute with stale-while-revalidate. Fresh hit: returned directly. Stale hit: returned directly and
 * refreshed in the background. Miss: computed (deduped across concurrent callers).
 */
export const cached = async <T>(key: string, opts: CachedOptions<T>, fn: () => Promise<T>): Promise<T> => {
	const hit = read<T>(key);
	const compute = () =>
		dedupe(key, async () => {
			const v = await fn();
			if (!opts.shouldCache || opts.shouldCache(v)) set(key, v, opts);
			return v;
		});
	if (hit) {
		if (hit.fresh <= Date.now() && !inflight.has(key)) {
			compute().catch((err) => logger.debug({ err, key }, "background refresh failed"));
		}
		return hit.v;
	}
	return compute();
};

export const stats = () => ({ memoryEntries: memory.size, inflight: inflight.size });
