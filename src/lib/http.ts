const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		readonly body: string,
	) {
		super(`HTTP ${status} for ${redactUrl(url)}`);
	}
}

export interface RequestOptions {
	method?: string;
	headers?: Record<string, string>;
	query?: Record<string, string | number | boolean | undefined | null>;
	json?: unknown;
	body?: RequestInit["body"];
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Hide API keys/tokens if a URL ends up in a log line or error message. */
export const redactUrl = (url: string) => url.replace(/((?:apikey|token|api_key)=)[^&]+/gi, "$1***");

const buildUrl = (url: string, query?: RequestOptions["query"]) => {
	if (!query) return url;
	const u = new URL(url);
	for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
	return u.toString();
};

export const request = async (url: string, opts: RequestOptions = {}): Promise<Response> => {
	const full = buildUrl(url, opts.query);
	const headers: Record<string, string> = { "user-agent": UA, accept: "*/*", ...opts.headers };
	let body = opts.body;
	if (opts.json !== undefined) {
		body = JSON.stringify(opts.json);
		headers["content-type"] = "application/json";
	}
	const signals = [AbortSignal.timeout(opts.timeoutMs ?? 10_000)];
	if (opts.signal) signals.push(opts.signal);
	const res = await fetch(full, {
		method: opts.method ?? (body ? "POST" : "GET"),
		headers,
		body,
		signal: AbortSignal.any(signals),
		redirect: "follow",
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new HttpError(res.status, full, text.slice(0, 500));
	}
	return res;
};

export const getJson = async <T>(url: string, opts?: RequestOptions): Promise<T> => {
	const res = await request(url, { ...opts, headers: { accept: "application/json", ...opts?.headers } });
	return (await res.json()) as T;
};

export const getText = async (url: string, opts?: RequestOptions): Promise<string> => {
	const res = await request(url, opts);
	return res.text();
};
