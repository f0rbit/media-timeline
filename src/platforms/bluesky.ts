import { type BlueskyFeedItem, type BlueskyRaw, BlueskyRawSchema, type PostPayload, type TimelineItem } from "../schema";
import { err, ok, tryCatchAsync } from "../utils";
import type { FetchResult, Provider, ProviderError, Tagged } from "./types";
import { toProviderError } from "./types";

// === PROVIDER (real API) ===

export type BlueskyProviderConfig = {
	actor: string;
};

const handleBlueskyResponse = async (response: Response): Promise<BlueskyRaw> => {
	if (response.status === 401) {
		throw { _tag: "auth_expired", kind: "auth_expired", message: "Bluesky token expired or invalid" } as Tagged<ProviderError>;
	}

	if (response.status === 429) {
		const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "60", 10);
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
			reply_count: post.replyCount,
			repost_count: post.repostCount,
			like_count: post.likeCount,
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

type MemoryProviderState = {
	call_count: number;
	simulate_rate_limit: boolean;
	simulate_auth_expired: boolean;
};

const createMemoryProviderState = (): MemoryProviderState => ({
	call_count: 0,
	simulate_rate_limit: false,
	simulate_auth_expired: false,
});

type SimulationConfig = {
	rate_limit_retry_after?: number;
};

const simulateErrors = <T>(state: MemoryProviderState, getData: () => T, config: SimulationConfig = {}): FetchResult<T> => {
	state.call_count++;

	if (state.simulate_rate_limit) {
		return err({ kind: "rate_limited", retry_after: config.rate_limit_retry_after ?? 60 });
	}
	if (state.simulate_auth_expired) {
		return err({ kind: "auth_expired", message: "Simulated auth expiry" });
	}

	return ok(getData());
};

export interface MemoryProviderControls {
	getCallCount(): number;
	reset(): void;
	setSimulateRateLimit(value: boolean): void;
	setSimulateAuthExpired(value: boolean): void;
}

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
