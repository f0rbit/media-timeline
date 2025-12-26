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

export interface Provider<TRaw> {
	readonly platform: string;
	fetch(token: string): Promise<FetchResult<TRaw>>;
}

export type ProviderFactory = {
	create(platform: string, platformUserId: string | null, token: string): Promise<FetchResult<Record<string, unknown>>>;
};
