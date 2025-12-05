import { tryCatchAsync } from "@media-timeline/core";
import { toProviderError, type FetchResult, type Provider, type ProviderError, type Tagged } from "./types";

export type BlueskyPost = {
	uri: string;
	cid: string;
	author: {
		did: string;
		handle: string;
		displayName?: string;
		avatar?: string;
	};
	record: {
		text: string;
		createdAt: string;
		embed?: Record<string, unknown>;
		reply?: { parent: { uri: string; cid: string }; root: { uri: string; cid: string } };
	};
	replyCount: number;
	repostCount: number;
	likeCount: number;
	indexedAt: string;
};

export type BlueskyFeedItem = {
	post: BlueskyPost;
	reason?: { $type: string; by?: { did: string; handle: string }; indexedAt?: string };
};

export type BlueskyRaw = {
	feed: BlueskyFeedItem[];
	cursor?: string;
	fetched_at: string;
};

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

	const data = (await response.json()) as { feed: BlueskyFeedItem[]; cursor?: string };
	return { feed: data.feed, cursor: data.cursor, fetched_at: new Date().toISOString() };
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
