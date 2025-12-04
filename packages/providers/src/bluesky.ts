import type { FetchResult, Provider } from "./types";
import { err, ok } from "./types";

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

export class BlueskyProvider implements Provider<BlueskyRaw> {
	readonly platform = "bluesky";
	private config: BlueskyProviderConfig;

	constructor(config: BlueskyProviderConfig) {
		this.config = config;
	}

	async fetch(token: string): Promise<FetchResult<BlueskyRaw>> {
		const params = new URLSearchParams({ actor: this.config.actor, limit: "50" });
		const url = `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?${params}`;

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
			});
		} catch (cause) {
			return err({ kind: "network_error", cause: cause as Error });
		}

		if (response.status === 401) {
			return err({ kind: "auth_expired", message: "Bluesky token expired or invalid" });
		}

		if (response.status === 429) {
			const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
			return err({ kind: "rate_limited", retry_after: retryAfter });
		}

		if (!response.ok) {
			return err({ kind: "api_error", status: response.status, message: await response.text() });
		}

		let data: { feed: BlueskyFeedItem[]; cursor?: string };
		try {
			data = (await response.json()) as { feed: BlueskyFeedItem[]; cursor?: string };
		} catch {
			return err({ kind: "api_error", status: response.status, message: "Invalid JSON response" });
		}

		return ok({
			feed: data.feed,
			cursor: data.cursor,
			fetched_at: new Date().toISOString(),
		});
	}
}
