import { err, ok, type Result } from "@media-timeline/core";

export { err, ok, type Result };

export type ProviderError = { kind: "rate_limited"; retry_after: number } | { kind: "auth_expired"; message: string } | { kind: "network_error"; cause: Error } | { kind: "api_error"; status: number; message: string };

export type FetchResult<T> = Result<T, ProviderError>;

export type Tagged<T> = T & { _tag: string };

export const toProviderError = (e: unknown): ProviderError => {
	if (typeof e === "object" && e !== null && "_tag" in e) {
		const { _tag, ...rest } = e as Tagged<ProviderError>;
		return rest as ProviderError;
	}
	return { kind: "network_error", cause: e instanceof Error ? e : new Error(String(e)) };
};

export interface Provider<TRaw> {
	readonly platform: string;
	fetch(token: string): Promise<FetchResult<TRaw>>;
}
