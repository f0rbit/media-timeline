import type { TweetMedia, TwitterTweet } from "../schema";
import type { TwitterFetchResult } from "./twitter";
import { BaseMemoryProvider } from "./memory-base";

export type TwitterMemoryConfig = {
	userId?: string;
	username?: string;
	name?: string;
	tweets?: TwitterTweet[];
	media?: TweetMedia[];
};

export class TwitterMemoryProvider extends BaseMemoryProvider<TwitterFetchResult> {
	readonly platform = "twitter";
	private config: TwitterMemoryConfig;

	constructor(config: TwitterMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): TwitterFetchResult {
		const now = new Date().toISOString();
		const userId = this.config.userId ?? "123456789";
		const username = this.config.username ?? "testuser";

		return {
			meta: {
				id: userId,
				username,
				name: this.config.name ?? "Test User",
				created_at: new Date(Date.now() - 86400000 * 365).toISOString(),
				verified: false,
				verified_type: "none" as const,
				protected: false,
				public_metrics: {
					followers_count: 100,
					following_count: 50,
					tweet_count: this.config.tweets?.length ?? 0,
					listed_count: 1,
				},
				fetched_at: now,
			},
			tweets: {
				user_id: userId,
				username,
				tweets: this.config.tweets ?? [],
				media: this.config.media ?? [],
				total_tweets: this.config.tweets?.length ?? 0,
				oldest_tweet_id: this.config.tweets?.[this.config.tweets.length - 1]?.id,
				newest_tweet_id: this.config.tweets?.[0]?.id,
				fetched_at: now,
			},
		};
	}

	setTweets(tweets: TwitterTweet[]): void {
		this.config.tweets = tweets;
	}

	setMedia(media: TweetMedia[]): void {
		this.config.media = media;
	}
}
