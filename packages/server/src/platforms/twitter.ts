import type { TweetMedia, TwitterMetaStore, TwitterTweet, TwitterTweetsStore } from "@media/schema";
import { Client, type ClientConfig } from "@xdevplatform/xdk";
import { createLogger } from "../logger";
import { type Result, err, ok } from "../utils";
import { type ProviderError, mapHttpError } from "./types";

const log = createLogger("twitter");

export type TwitterProviderConfig = {
	maxTweetsPerPage: number; // Max tweets to fetch per API call (max 100)
	includeRetweets: boolean;
	includeReplies: boolean;
};

const DEFAULT_CONFIG: TwitterProviderConfig = {
	maxTweetsPerPage: 5, // Free tier: 100 posts/month cap, so fetch only 5 at a time
	includeRetweets: false, // Only user's own tweets, not retweets
	includeReplies: false,
};

export type TwitterFetchResult = {
	meta: TwitterMetaStore;
	tweets: TwitterTweetsStore;
};

type VerifiedType = "blue" | "business" | "government" | "none";

const mapVerifiedType = (type: string | undefined): VerifiedType => {
	switch (type) {
		case "blue":
			return "blue";
		case "business":
			return "business";
		case "government":
			return "government";
		default:
			return "none";
	}
};

const mapError = (error: unknown): ProviderError => {
	if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
		const status = error.status;
		const message = "message" in error ? String(error.message) : "Unknown error";

		// Twitter XDK may include rateLimit.reset for 429 responses
		if (status === 429 && "rateLimit" in error && typeof error.rateLimit === "object" && error.rateLimit !== null && "reset" in error.rateLimit && typeof error.rateLimit.reset === "number") {
			const retryAfter = Math.max(0, error.rateLimit.reset - Math.floor(Date.now() / 1000));
			return { kind: "rate_limited", retry_after: retryAfter };
		}

		return mapHttpError(status, message);
	}

	if (error instanceof Error) {
		return { kind: "network_error", cause: error };
	}

	return { kind: "network_error", cause: new Error(String(error)) };
};

type XDKUser = {
	id: string;
	username: string;
	name: string;
	description?: string;
	profile_image_url?: string;
	url?: string;
	location?: string;
	created_at?: string;
	verified?: boolean;
	verified_type?: string;
	protected?: boolean;
	public_metrics?: {
		followers_count?: number;
		following_count?: number;
		tweet_count?: number;
		listed_count?: number;
	};
	pinned_tweet_id?: string;
};

type XDKTweet = {
	id: string;
	text: string;
	created_at?: string;
	author_id?: string;
	conversation_id?: string;
	in_reply_to_user_id?: string;
	public_metrics?: {
		retweet_count?: number;
		reply_count?: number;
		like_count?: number;
		quote_count?: number;
		impression_count?: number;
		bookmark_count?: number;
	};
	possibly_sensitive?: boolean;
	lang?: string;
	source?: string;
	referenced_tweets?: Array<{ type: "retweeted" | "quoted" | "replied_to"; id: string }>;
	attachments?: {
		media_keys?: string[];
		poll_ids?: string[];
	};
	entities?: {
		urls?: Array<{
			start: number;
			end: number;
			url: string;
			expanded_url: string;
			display_url: string;
			title?: string;
			description?: string;
		}>;
		mentions?: Array<{
			start: number;
			end: number;
			username: string;
			id: string;
		}>;
		hashtags?: Array<{
			start: number;
			end: number;
			tag: string;
		}>;
	};
};

type XDKMedia = {
	media_key: string;
	type: string;
	url?: string;
	preview_image_url?: string;
	alt_text?: string;
	duration_ms?: number;
	width?: number;
	height?: number;
};

const parseTweet = (tweet: XDKTweet): TwitterTweet => ({
	id: tweet.id,
	text: tweet.text,
	created_at: tweet.created_at ?? new Date().toISOString(),
	author_id: tweet.author_id ?? "",
	conversation_id: tweet.conversation_id,
	in_reply_to_user_id: tweet.in_reply_to_user_id,
	public_metrics: {
		retweet_count: tweet.public_metrics?.retweet_count ?? 0,
		reply_count: tweet.public_metrics?.reply_count ?? 0,
		like_count: tweet.public_metrics?.like_count ?? 0,
		quote_count: tweet.public_metrics?.quote_count ?? 0,
		impression_count: tweet.public_metrics?.impression_count,
		bookmark_count: tweet.public_metrics?.bookmark_count,
	},
	possibly_sensitive: tweet.possibly_sensitive ?? false,
	lang: tweet.lang,
	source: tweet.source,
	referenced_tweets: tweet.referenced_tweets?.map(ref => ({
		type: ref.type,
		id: ref.id,
	})),
	attachments: tweet.attachments
		? {
				media_keys: tweet.attachments.media_keys,
				poll_ids: tweet.attachments.poll_ids,
			}
		: undefined,
	entities: tweet.entities
		? {
				urls: tweet.entities.urls?.map(url => ({
					start: url.start,
					end: url.end,
					url: url.url,
					expanded_url: url.expanded_url,
					display_url: url.display_url,
					title: url.title,
					description: url.description,
				})),
				mentions: tweet.entities.mentions?.map(m => ({
					start: m.start,
					end: m.end,
					username: m.username,
					id: m.id,
				})),
				hashtags: tweet.entities.hashtags?.map(h => ({
					start: h.start,
					end: h.end,
					tag: h.tag,
				})),
			}
		: undefined,
});

const parseMedia = (media: XDKMedia): TweetMedia => ({
	media_key: media.media_key,
	type: (media.type as "photo" | "video" | "animated_gif") ?? "photo",
	url: media.url,
	preview_image_url: media.preview_image_url,
	alt_text: media.alt_text,
	duration_ms: media.duration_ms,
	width: media.width,
	height: media.height,
});

const parseUserMeta = (user: XDKUser): TwitterMetaStore => ({
	id: user.id,
	username: user.username,
	name: user.name,
	description: user.description,
	profile_image_url: user.profile_image_url,
	url: user.url,
	location: user.location,
	created_at: user.created_at ?? new Date().toISOString(),
	verified: user.verified ?? false,
	verified_type: mapVerifiedType(user.verified_type),
	protected: user.protected ?? false,
	public_metrics: {
		followers_count: user.public_metrics?.followers_count ?? 0,
		following_count: user.public_metrics?.following_count ?? 0,
		tweet_count: user.public_metrics?.tweet_count ?? 0,
		listed_count: user.public_metrics?.listed_count ?? 0,
	},
	pinned_tweet_id: user.pinned_tweet_id,
	fetched_at: new Date().toISOString(),
});

export class TwitterProvider {
	readonly platform = "twitter";
	private config: TwitterProviderConfig;

	constructor(config: Partial<TwitterProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	async fetch(token: string): Promise<Result<TwitterFetchResult, ProviderError>> {
		log.debug("Starting fetch", { maxTweetsPerPage: this.config.maxTweetsPerPage });

		try {
			const clientConfig: ClientConfig = { accessToken: token };
			const client = new Client(clientConfig);

			const userResult = await this.fetchUser(client);
			if (!userResult.ok) {
				log.error("User fetch failed", userResult.error);
				return userResult;
			}
			const { userId, meta } = userResult.value;
			log.info("Authenticated as", meta.username);

			const tweetsResult = await this.fetchTweets(client, userId, meta.username);
			if (!tweetsResult.ok) {
				log.error("Tweets fetch failed", tweetsResult.error);
				return tweetsResult;
			}

			log.info("Fetch complete", { tweets: tweetsResult.value.total_tweets });

			return ok({
				meta,
				tweets: tweetsResult.value,
			});
		} catch (error) {
			log.error("Fetch failed", error);
			return err(mapError(error));
		}
	}

	private async fetchUser(client: Client): Promise<Result<{ userId: string; meta: TwitterMetaStore }, ProviderError>> {
		try {
			const response = await client.users.getMe({
				"user.fields": ["created_at", "description", "profile_image_url", "public_metrics", "verified", "verified_type", "protected", "location", "url", "pinned_tweet_id"],
			});

			const user = response.data as XDKUser | undefined;
			if (!user) {
				log.error("No user data in response");
				return err({ kind: "api_error", status: 404, message: "User not found" });
			}

			log.debug("User found", { id: user.id, username: user.username });
			return ok({
				userId: user.id,
				meta: parseUserMeta(user),
			});
		} catch (error) {
			log.error("fetchUser failed", error);
			return err(mapError(error));
		}
	}

	private async fetchTweets(client: Client, userId: string, username: string): Promise<Result<TwitterTweetsStore, ProviderError>> {
		log.debug("Fetching tweets for user", { userId, username });

		const exclude: string[] = [];
		if (!this.config.includeRetweets) exclude.push("retweets");
		if (!this.config.includeReplies) exclude.push("replies");

		try {
			const response = await client.users.getPosts(userId, {
				max_results: this.config.maxTweetsPerPage,
				exclude: exclude.length > 0 ? (exclude as ["retweets"] | ["replies"] | ["retweets", "replies"]) : undefined,
				"tweet.fields": ["created_at", "public_metrics", "entities", "attachments", "referenced_tweets", "in_reply_to_user_id", "conversation_id", "possibly_sensitive", "lang", "source"],
				"media.fields": ["type", "url", "preview_image_url", "alt_text", "duration_ms", "width", "height"],
				expansions: ["attachments.media_keys"],
			});

			const data = response.data as XDKTweet[] | undefined;
			if (!data || data.length === 0) {
				log.debug("No tweets returned");
				return ok({
					user_id: userId,
					username,
					tweets: [],
					media: [],
					total_tweets: 0,
					fetched_at: new Date().toISOString(),
				});
			}

			const tweets = data.map(parseTweet);
			const newestId = tweets[0]?.id;
			const oldestId = tweets[tweets.length - 1]?.id;

			const mediaMap = new Map<string, TweetMedia>();
			const includes = response.includes as { media?: XDKMedia[] } | undefined;
			if (includes?.media) {
				for (const media of includes.media) {
					mediaMap.set(media.media_key, parseMedia(media));
				}
			}

			log.debug("Fetched tweets", { count: tweets.length, media: mediaMap.size });
			return ok({
				user_id: userId,
				username,
				tweets,
				media: Array.from(mediaMap.values()),
				total_tweets: tweets.length,
				oldest_tweet_id: oldestId,
				newest_tweet_id: newestId,
				fetched_at: new Date().toISOString(),
			});
		} catch (error) {
			log.error("fetchTweets failed", error);
			return err(mapError(error));
		}
	}
}
