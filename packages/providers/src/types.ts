import { err, ok, type Result } from "@media-timeline/core";

export { err, ok, type Result };

export type ProviderError = { kind: "rate_limited"; retry_after: number } | { kind: "auth_expired"; message: string } | { kind: "network_error"; cause: Error } | { kind: "api_error"; status: number; message: string };

export type FetchResult<T> = Result<T, ProviderError>;

export interface Provider<TRaw> {
	readonly platform: string;
	fetch(token: string): Promise<FetchResult<TRaw>>;
}
