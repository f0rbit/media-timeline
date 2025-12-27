import type { RedditComment, RedditMetaStore, RedditPost } from "../schema";
import type { Result } from "../utils";
import { createMemoryProviderState, type MemoryProviderControls, type MemoryProviderState, simulateErrors } from "./memory-base";
import type { RedditFetchResult } from "./reddit";
import type { ProviderError } from "./types";

export type { RedditFetchResult };

export type RedditMemoryConfig = {
	username?: string;
	meta?: Partial<RedditMetaStore>;
	posts?: RedditPost[];
	comments?: RedditComment[];
};

export class RedditMemoryProvider implements MemoryProviderControls {
	readonly platform = "reddit";
	private config: RedditMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: RedditMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<Result<RedditFetchResult, ProviderError>> {
		return simulateErrors(this.state, () => {
			const username = this.config.username ?? "test-user";
			const now = new Date().toISOString();

			return {
				meta: {
					username,
					user_id: "test-user-id",
					total_karma: 1000,
					link_karma: 500,
					comment_karma: 500,
					created_utc: Date.now() / 1000 - 86400 * 365,
					is_gold: false,
					subreddits_active: [],
					fetched_at: now,
					...this.config.meta,
				},
				posts: {
					username,
					posts: this.config.posts ?? [],
					total_posts: this.config.posts?.length ?? 0,
					fetched_at: now,
				},
				comments: {
					username,
					comments: this.config.comments ?? [],
					total_comments: this.config.comments?.length ?? 0,
					fetched_at: now,
				},
			};
		});
	}

	setPosts(posts: RedditPost[]): void {
		this.config.posts = posts;
	}

	setComments(comments: RedditComment[]): void {
		this.config.comments = comments;
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
