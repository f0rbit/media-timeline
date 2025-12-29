import type { RedditComment, RedditMetaStore, RedditPost } from "../schema";
import type { RedditFetchResult } from "./reddit";
import { BaseMemoryProvider } from "./memory-base";

export type { RedditFetchResult };

export type RedditMemoryConfig = {
	username?: string;
	meta?: Partial<RedditMetaStore>;
	posts?: RedditPost[];
	comments?: RedditComment[];
};

export class RedditMemoryProvider extends BaseMemoryProvider<RedditFetchResult> {
	readonly platform = "reddit";
	private config: RedditMemoryConfig;

	constructor(config: RedditMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): RedditFetchResult {
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
	}

	setPosts(posts: RedditPost[]): void {
		this.config.posts = posts;
	}

	setComments(comments: RedditComment[]): void {
		this.config.comments = comments;
	}
}
