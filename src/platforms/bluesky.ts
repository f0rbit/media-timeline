import { type BlueskyFeedItem, type BlueskyRaw, BlueskyRawSchema, type PostPayload, type TimelineItem } from "../schema";
import { try_catch_async } from "../utils";
import { type MemoryProviderControls, type MemoryProviderState, createMemoryProviderState, simulateErrors } from "./memory-base";
import { type FetchResult, type Provider, type ProviderError, toProviderError } from "./types";

// === PROVIDER (real API) ===

export type BlueskyProviderConfig = {
	actor: string;
};

const handleBlueskyResponse = async (response: Response): Promise<BlueskyRaw> => {
	if (response.status === 401) {
		throw { kind: "auth_expired", message: "Bluesky token expired or invalid" } satisfies ProviderError;
	}

	if (response.status === 429) {
		const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "60", 10);
		throw { kind: "rate_limited", retry_after: retryAfter } satisfies ProviderError;
	}

	if (!response.ok) {
		throw { kind: "api_error", status: response.status, message: await response.text() } satisfies ProviderError;
	}

	const json = (await response.json()) as Record<string, unknown>;
	const result = BlueskyRawSchema.safeParse({ ...json, fetched_at: new Date().toISOString() });

	if (!result.success) {
		throw { kind: "parse_error", message: result.error.message } satisfies ProviderError;
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

		return try_catch_async(
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

// === NORMALIZER ===

const makePostId = (uri: string): string => {
	const parts = uri.split("/");
	const rkey = parts[parts.length - 1] ?? uri;
	return `bluesky:post:${rkey}`;
};

const makePostUrl = (author: string, uri: string): string => {
	const parts = uri.split("/");
	const rkey = parts[parts.length - 1] ?? "";
	return `https://bsky.app/profile/${author}/post/${rkey}`;
};

const extractPostTitle = (text: string): string => {
	const firstLine = text.split("\n")[0] ?? "";
	return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
};

export const normalizeBluesky = (raw: BlueskyRaw): TimelineItem[] =>
	raw.feed.map((item): TimelineItem => {
		const { post } = item;
		const hasMedia = (post.embed?.images?.length ?? 0) > 0;
		const isReply = post.record.reply !== undefined;
		const isRepost = item.reason?.$type === "app.bsky.feed.defs#reasonRepost";
		const payload: PostPayload = {
			type: "post",
			content: post.record.text,
			author_handle: post.author.handle,
			author_name: post.author.displayName,
			author_avatar: post.author.avatar,
			reply_count: post.replyCount ?? 0,
			repost_count: post.repostCount ?? 0,
			like_count: post.likeCount ?? 0,
			has_media: hasMedia,
			is_reply: isReply,
			is_repost: isRepost,
		};
		return {
			id: makePostId(post.uri),
			platform: "bluesky",
			type: "post",
			timestamp: post.record.createdAt,
			title: extractPostTitle(post.record.text),
			url: makePostUrl(post.author.handle, post.uri),
			payload,
		};
	});

// === MEMORY PROVIDER (for tests) ===

export type BlueskyMemoryConfig = {
	feed?: BlueskyFeedItem[];
	cursor?: string;
};

export class BlueskyMemoryProvider implements Provider<BlueskyRaw>, MemoryProviderControls {
	readonly platform = "bluesky";
	private config: BlueskyMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: BlueskyMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<FetchResult<BlueskyRaw>> {
		return simulateErrors(this.state, () => ({
			feed: this.config.feed ?? [],
			cursor: this.config.cursor,
			fetched_at: new Date().toISOString(),
		}));
	}

	getCallCount = () => this.state.call_count;
	reset = () => {
		this.state.call_count = 0;
	};
	setSimulateRateLimit = (value: boolean) => {
		this.state.simulate_rate_limit = value;
	};
	setSimulateAuthExpired = (value: boolean) => {
		this.state.simulate_auth_expired = value;
	};

	setFeed(feed: BlueskyFeedItem[]): void {
		this.config.feed = feed;
	}

	setCursor(cursor: string | undefined): void {
		this.config.cursor = cursor;
	}
}
