import { Client, type ClientConfig } from "@xdevplatform/xdk";
import type { TweetMedia, TwitterMetaStore, TwitterTweet, TwitterTweetsStore } from "../schema";
import { err, ok, type Result } from "../utils";
import type { ProviderError } from "./types";

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

const maskToken = (token: string): string => {
	if (token.length <= 8) return "***";
	return `${token.slice(0, 4)}...${token.slice(-4)}`;
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
	if (error && typeof error === "object") {
		if ("status" in error && typeof error.status === "number") {
			const status = error.status;
			const message = "message" in error ? String(error.message) : "Unknown error";

			if (status === 429) {
				const retryAfter =
					"rateLimit" in error && typeof error.rateLimit === "object" && error.rateLimit !== null && "reset" in error.rateLimit && typeof error.rateLimit.reset === "number"
						? Math.max(0, error.rateLimit.reset - Math.floor(Date.now() / 1000))
						: 900;
				return { kind: "rate_limited", retry_after: retryAfter };
			}

			if (status === 401 || status === 403) {
				return { kind: "auth_expired", message: `Twitter auth error: ${message}` };
			}

			return { kind: "api_error", status, message };
		}
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
		console.log("[twitter] ===========================================");
		console.log("[twitter] Starting Twitter fetch");
		console.log("[twitter] Token: ", maskToken(token));
		console.log("[twitter] Token length:", token.length);
		console.log("[twitter] Config:", {
			maxTweetsPerPage: this.config.maxTweetsPerPage,
			includeRetweets: this.config.includeRetweets,
			includeReplies: this.config.includeReplies,
		});

		try {
			// Use accessToken for OAuth2 user tokens, NOT bearerToken
			// bearerToken is for app-only authentication
			console.log("[twitter] Initializing XDK client with accessToken...");
			const clientConfig: ClientConfig = { accessToken: token };
			const client = new Client(clientConfig);
			console.log("[twitter] XDK client initialized successfully");

			console.log("[twitter] Fetching user profile...");
			const userResult = await this.fetchUser(client);
			if (!userResult.ok) {
				console.error("[twitter] User fetch failed:", userResult.error);
				return userResult;
			}
			const { userId, meta } = userResult.value;
			console.log("[twitter] Authenticated as:", meta.username, "(id:", userId, ")");

			console.log("[twitter] Fetching tweets...");
			const tweetsResult = await this.fetchTweets(client, userId, meta.username);
			if (!tweetsResult.ok) {
				console.error("[twitter] Tweets fetch failed:", tweetsResult.error);
				return tweetsResult;
			}

			console.log("[twitter] Fetch complete:", {
				tweets: tweetsResult.value.total_tweets,
			});
			console.log("[twitter] ===========================================");

			return ok({
				meta,
				tweets: tweetsResult.value,
			});
		} catch (error) {
			console.error("[twitter] ===========================================");
			console.error("[twitter] Fetch failed with exception");
			console.error("[twitter] Error type:", typeof error);
			console.error("[twitter] Error constructor:", error?.constructor?.name);
			console.error("[twitter] Error:", error);
			if (error instanceof Error) {
				console.error("[twitter] Error message:", error.message);
				console.error("[twitter] Error stack:", error.stack);
			}
			if (typeof error === "object" && error !== null) {
				console.error("[twitter] Error keys:", Object.keys(error));
				console.error("[twitter] Error JSON:", JSON.stringify(error, null, 2));
			}
			console.error("[twitter] ===========================================");
			return err(mapError(error));
		}
	}

	private async fetchUser(client: Client): Promise<Result<{ userId: string; meta: TwitterMetaStore }, ProviderError>> {
		console.log("[twitter:fetchUser] Starting getMe request...");
		try {
			const response = await client.users.getMe({
				"user.fields": ["created_at", "description", "profile_image_url", "public_metrics", "verified", "verified_type", "protected", "location", "url", "pinned_tweet_id"],
			});

			console.log("[twitter:fetchUser] Response received");
			console.log("[twitter:fetchUser] Response keys:", Object.keys(response));

			const user = response.data as XDKUser | undefined;
			if (!user) {
				console.error("[twitter:fetchUser] No user data in response");
				console.error("[twitter:fetchUser] Full response:", JSON.stringify(response, null, 2));
				return err({ kind: "api_error", status: 404, message: "User not found" });
			}

			console.log("[twitter:fetchUser] User found:", { id: user.id, username: user.username, name: user.name });
			return ok({
				userId: user.id,
				meta: parseUserMeta(user),
			});
		} catch (error) {
			console.error("[twitter:fetchUser] Request failed");
			console.error("[twitter:fetchUser] Error type:", typeof error);
			console.error("[twitter:fetchUser] Error constructor:", error?.constructor?.name);
			if (error instanceof Error) {
				console.error("[twitter:fetchUser] Error message:", error.message);
				console.error("[twitter:fetchUser] Error stack:", error.stack);
			}
			if (typeof error === "object" && error !== null) {
				console.error("[twitter:fetchUser] Error keys:", Object.keys(error as object));
				try {
					console.error("[twitter:fetchUser] Error JSON:", JSON.stringify(error, null, 2));
				} catch {
					console.error("[twitter:fetchUser] Error (not serializable):", error);
				}
				if ("status" in error) console.error("[twitter:fetchUser] Error status:", (error as { status: unknown }).status);
				if ("statusText" in error) console.error("[twitter:fetchUser] Error statusText:", (error as { statusText: unknown }).statusText);
				if ("data" in error) console.error("[twitter:fetchUser] Error data:", JSON.stringify((error as { data: unknown }).data, null, 2));
			}
			return err(mapError(error));
		}
	}

	private async fetchTweets(client: Client, userId: string, username: string): Promise<Result<TwitterTweetsStore, ProviderError>> {
		console.log("[twitter:fetchTweets] Starting for user:", userId, username);
		console.log("[twitter:fetchTweets] Fetching single page (no pagination) - Free tier only allows 1 request/15min");

		const exclude: string[] = [];
		if (!this.config.includeRetweets) exclude.push("retweets");
		if (!this.config.includeReplies) exclude.push("replies");

		try {
			// Use getPosts() to get user's OWN tweets, not getTimeline() which returns home feed
			// getPosts() maps to GET /2/users/{id}/tweets - user's authored posts
			// getTimeline() maps to GET /2/users/{id}/timelines/reverse_chronological - home timeline
			const response = await client.users.getPosts(userId, {
				max_results: this.config.maxTweetsPerPage,
				exclude: exclude.length > 0 ? (exclude as ["retweets"] | ["replies"] | ["retweets", "replies"]) : undefined,
				"tweet.fields": ["created_at", "public_metrics", "entities", "attachments", "referenced_tweets", "in_reply_to_user_id", "conversation_id", "possibly_sensitive", "lang", "source"],
				"media.fields": ["type", "url", "preview_image_url", "alt_text", "duration_ms", "width", "height"],
				expansions: ["attachments.media_keys"],
			});

			console.log("[twitter:fetchTweets] Response received");

			const data = response.data as XDKTweet[] | undefined;
			if (!data || data.length === 0) {
				console.log("[twitter:fetchTweets] No tweets returned");
				return ok({
					user_id: userId,
					username,
					tweets: [],
					media: [],
					total_tweets: 0,
					fetched_at: new Date().toISOString(),
				});
			}

			console.log(`[twitter:fetchTweets] Got ${data.length} tweets`);

			const tweets = data.map(parseTweet);
			const newestId = tweets[0]?.id;
			const oldestId = tweets[tweets.length - 1]?.id;

			const mediaMap = new Map<string, TweetMedia>();
			const includes = response.includes as { media?: XDKMedia[] } | undefined;
			if (includes?.media) {
				console.log(`[twitter:fetchTweets] Got ${includes.media.length} media items`);
				for (const media of includes.media) {
					mediaMap.set(media.media_key, parseMedia(media));
				}
			}

			console.log(`[twitter:fetchTweets] Completed: ${tweets.length} tweets, ${mediaMap.size} media items`);
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
			console.error("[twitter:fetchTweets] Request failed");
			this.logError(error);
			return err(mapError(error));
		}
	}

	private logError(error: unknown): void {
		console.error("[twitter:fetchTweets] Error type:", typeof error);
		console.error("[twitter:fetchTweets] Error constructor:", error?.constructor?.name);
		if (error instanceof Error) {
			console.error("[twitter:fetchTweets] Error message:", error.message);
			console.error("[twitter:fetchTweets] Error stack:", error.stack);
		}
		if (typeof error === "object" && error !== null) {
			console.error("[twitter:fetchTweets] Error keys:", Object.keys(error as object));
			try {
				console.error("[twitter:fetchTweets] Error JSON:", JSON.stringify(error, null, 2));
			} catch {
				console.error("[twitter:fetchTweets] Error (not serializable):", error);
			}
			if ("status" in error) console.error("[twitter:fetchTweets] Error status:", (error as { status: unknown }).status);
			if ("statusText" in error) console.error("[twitter:fetchTweets] Error statusText:", (error as { statusText: unknown }).statusText);
			if ("data" in error) console.error("[twitter:fetchTweets] Error data:", JSON.stringify((error as { data: unknown }).data, null, 2));
		}
	}
}
