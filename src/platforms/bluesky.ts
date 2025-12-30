import { type BlueskyFeedItem, type BlueskyRaw, BlueskyRawSchema, type PostPayload, type TimelineItem } from "../schema";
import { type FetchError, err, ok, pipe } from "../utils";
import { BaseMemoryProvider } from "./memory-base";
import { type FetchResult, type Provider, type ProviderError, mapHttpError } from "./types";

// === PROVIDER (real API) ===

export type BlueskyProviderConfig = {
	actor: string;
};

const mapBlueskyError = (e: FetchError): ProviderError => (e.type === "http" ? mapHttpError(e.status, e.status_text) : { kind: "network_error", cause: e.cause instanceof Error ? e.cause : new Error(String(e.cause)) });

const parseBlueskyResponse = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

export class BlueskyProvider implements Provider<BlueskyRaw> {
	readonly platform = "bluesky";
	private config: BlueskyProviderConfig;

	constructor(config: BlueskyProviderConfig) {
		this.config = config;
	}

	fetch(token: string): Promise<FetchResult<BlueskyRaw>> {
		const params = new URLSearchParams({ actor: this.config.actor, limit: "50" });
		const url = `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?${params}`;

		return pipe
			.fetch<Record<string, unknown>, ProviderError>(
				url,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
					},
				},
				mapBlueskyError,
				parseBlueskyResponse
			)
			.flat_map(json => {
				const result = BlueskyRawSchema.safeParse({ ...json, fetched_at: new Date().toISOString() });
				return result.success ? ok(result.data) : err({ kind: "parse_error", message: result.error.message } as ProviderError);
			})
			.result();
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

export class BlueskyMemoryProvider extends BaseMemoryProvider<BlueskyRaw> implements Provider<BlueskyRaw> {
	readonly platform = "bluesky";
	private config: BlueskyMemoryConfig;

	constructor(config: BlueskyMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): BlueskyRaw {
		return {
			feed: this.config.feed ?? [],
			cursor: this.config.cursor,
			fetched_at: new Date().toISOString(),
		};
	}

	setFeed(feed: BlueskyFeedItem[]): void {
		this.config.feed = feed;
	}

	setCursor(cursor: string | undefined): void {
		this.config.cursor = cursor;
	}
}
