import type { RawTorrent, SearchContext } from "../types.js";

export interface Provider {
	id: string;
	name: string;
	/** Whether this provider can contribute anything for the context. */
	supports(ctx: SearchContext): boolean;
	search(ctx: SearchContext, signal: AbortSignal): Promise<RawTorrent[]>;
}

const DAY = 86_400_000;

/**
 * How long a provider's raw search result stays fresh. New releases change quickly; old catalogue items barely
 * change, so they are cached for much longer. Stale results are still served while a refresh runs.
 */
export const queryTtl = (ctx: SearchContext) => {
	const released = ctx.released ? Date.parse(ctx.released) : NaN;
	const age = Number.isFinite(released) ? Date.now() - released : Infinity;
	if (age < 3 * DAY) return { ttlMs: 15 * 60_000, maxAgeMs: 3 * DAY };
	if (age < 30 * DAY) return { ttlMs: 2 * 3_600_000, maxAgeMs: 7 * DAY };
	return { ttlMs: 12 * 3_600_000, maxAgeMs: 30 * DAY };
};

export const nonEmpty = <T>(v: T[]) => v.length > 0;
