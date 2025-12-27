import type { TweetMedia, TwitterTweet } from "../schema";
import type { Result } from "../utils";
import { createMemoryProviderState, type MemoryProviderControls, type MemoryProviderState, simulateErrors } from "./memory-base";
import type { TwitterFetchResult } from "./twitter";
import type { ProviderError } from "./types";

export type TwitterMemoryConfig = {
	userId?: string;
	username?: string;
	name?: string;
	tweets?: TwitterTweet[];
	media?: TweetMedia[];
};

export class TwitterMemoryProvider implements MemoryProviderControls {
	readonly platform = "twitter";
	private config: TwitterMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: TwitterMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<Result<TwitterFetchResult, ProviderError>> {
		return simulateErrors(this.state, () => {
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
					fetched_at: now,
				},
			};
		});
	}

	setTweets(tweets: TwitterTweet[]): void {
		this.config.tweets = tweets;
	}

	setMedia(media: TweetMedia[]): void {
		this.config.media = media;
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
}
