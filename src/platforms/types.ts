import type { Result } from "../utils";

export type ProviderError =
	| { kind: "rate_limited"; retry_after: number }
	| { kind: "auth_expired"; message: string }
	| { kind: "network_error"; cause: Error }
	| { kind: "api_error"; status: number; message: string }
	| { kind: "parse_error"; message: string }
	| { kind: "unknown_platform"; platform: string };

export type FetchResult<T> = Result<T, ProviderError>;

export const toProviderError = (e: unknown): ProviderError => {
	if (typeof e === "object" && e !== null && "kind" in e) {
		return e as ProviderError;
	}
	return { kind: "network_error", cause: e instanceof Error ? e : new Error(String(e)) };
};

const getHeader = (headers: Headers | Record<string, string | number | undefined> | undefined, key: string): string | null => {
	if (!headers) return null;
	if (headers instanceof Headers) return headers.get(key);
	const value = headers[key] ?? headers[key.toLowerCase()];
	return value !== undefined ? String(value) : null;
};

const parseRetryAfterSeconds = (headers?: Headers | Record<string, string | number | undefined>): number => {
	const retryAfter = getHeader(headers, "retry-after");
	if (!retryAfter) return 60;
	const seconds = Number.parseInt(retryAfter, 10);
	return Number.isNaN(seconds) ? 60 : seconds;
};

const parseRateLimitResetSeconds = (headers?: Headers | Record<string, string | number | undefined>): number => {
	const resetAt = getHeader(headers, "x-ratelimit-reset");
	if (!resetAt) return 60;
	const resetTimestamp = Number.parseInt(resetAt, 10);
	if (Number.isNaN(resetTimestamp)) return 60;
	return Math.max(0, resetTimestamp - Math.floor(Date.now() / 1000));
};

/**
 * Maps HTTP response to a standardized ProviderError.
 * Handles rate limiting, auth expiry, and general API errors.
 */
export const mapHttpError = (status: number, statusText: string, headers?: Headers | Record<string, string | number | undefined>): ProviderError => {
	if (status === 429) {
		const retryAfter = parseRetryAfterSeconds(headers);
		return { kind: "rate_limited", retry_after: retryAfter };
	}

	if (status === 401 || status === 403) {
		const rateLimitRemaining = getHeader(headers, "x-ratelimit-remaining");
		if (rateLimitRemaining === "0") {
			const retryAfter = parseRateLimitResetSeconds(headers);
			return { kind: "rate_limited", retry_after: retryAfter };
		}
		return { kind: "auth_expired", message: statusText || "Authentication failed" };
	}

	return { kind: "api_error", status, message: statusText };
};

export interface Provider<TRaw> {
	readonly platform: string;
	fetch(token: string): Promise<FetchResult<TRaw>>;
}

export type ProviderFactory = {
	create(platform: string, platformUserId: string | null, token: string): Promise<FetchResult<Record<string, unknown>>>;
};
