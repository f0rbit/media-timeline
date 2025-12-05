import { tryCatchAsync } from "@media-timeline/core";
import { BlueskyRawSchema, type BlueskyRaw } from "@media-timeline/schema";
import { toProviderError, type FetchResult, type Provider, type ProviderError, type Tagged } from "./types";

export type BlueskyProviderConfig = {
	actor: string;
};

const handleBlueskyResponse = async (response: Response): Promise<BlueskyRaw> => {
	if (response.status === 401) {
		throw { _tag: "auth_expired", kind: "auth_expired", message: "Bluesky token expired or invalid" } as Tagged<ProviderError>;
	}

	if (response.status === 429) {
		const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
		throw { _tag: "rate_limited", kind: "rate_limited", retry_after: retryAfter } as Tagged<ProviderError>;
	}

	if (!response.ok) {
		throw { _tag: "api_error", kind: "api_error", status: response.status, message: await response.text() } as Tagged<ProviderError>;
	}

	const json = (await response.json()) as Record<string, unknown>;
	const result = BlueskyRawSchema.safeParse({ ...json, fetched_at: new Date().toISOString() });

	if (!result.success) {
		throw { _tag: "parse_error", kind: "parse_error", message: result.error.message } as Tagged<ProviderError>;
	}

	return result.data;
};

export class BlueskyProvider implements Provider<BlueskyRaw> {
	readonly platform = "bluesky";
	private config: BlueskyProviderConfig;

	constructor(config: BlueskyProviderConfig) {
		this.config = config;
	}

	fetch(token: string): Promise<FetchResult<BlueskyRaw>> {
		const params = new URLSearchParams({ actor: this.config.actor, limit: "50" });
		const url = `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?${params}`;

		return tryCatchAsync(
			async () =>
				handleBlueskyResponse(
					await fetch(url, {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/json",
						},
					})
				),
			toProviderError
		);
	}
}
