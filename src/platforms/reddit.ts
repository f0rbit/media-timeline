import { createLogger } from "../logger";
import type { RedditComment, RedditCommentsStore, RedditMetaStore, RedditPost, RedditPostsStore } from "../schema";
import type { Result } from "../utils";
import { type FetchError, err, ok, pipe } from "../utils";
import { type ProviderError, mapHttpError } from "./types";

const log = createLogger("reddit");

export type RedditProviderConfig = {
	maxPosts: number;
	maxComments: number;
	userAgent: string;
};

const DEFAULT_CONFIG: RedditProviderConfig = {
	maxPosts: 1000,
	maxComments: 1000,
	userAgent: "media-timeline/2.0.0",
};

export type RedditFetchResult = {
	meta: RedditMetaStore;
	posts: RedditPostsStore;
	comments: RedditCommentsStore;
};

const mapRedditError = (e: FetchError): ProviderError => (e.type === "http" ? mapHttpError(e.status, e.status_text) : { kind: "network_error", cause: e.cause instanceof Error ? e.cause : new Error(String(e.cause)) });

export class RedditProvider {
	readonly platform = "reddit";
	private config: RedditProviderConfig;

	constructor(config: Partial<RedditProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	async fetch(token: string): Promise<Result<RedditFetchResult, ProviderError>> {
		log.debug("Starting fetch", { maxPosts: this.config.maxPosts, maxComments: this.config.maxComments });

		return pipe(this.fetchUser(token))
			.tap(({ username }) => log.info("Authenticated as", username))
			.flat_map(async ({ username, meta }) => {
				const [postsResult, commentsResult] = await Promise.all([this.fetchPosts(token, username), this.fetchComments(token, username)]);

				if (!postsResult.ok) return postsResult;
				if (!commentsResult.ok) return commentsResult;

				const subreddits = new Set<string>();
				for (const post of postsResult.value) {
					subreddits.add(post.subreddit);
				}
				for (const comment of commentsResult.value) {
					subreddits.add(comment.subreddit);
				}

				const result: RedditFetchResult = {
					meta: {
						...meta,
						subreddits_active: Array.from(subreddits),
					},
					posts: {
						username,
						posts: postsResult.value,
						total_posts: postsResult.value.length,
						fetched_at: new Date().toISOString(),
					},
					comments: {
						username,
						comments: commentsResult.value,
						total_comments: commentsResult.value.length,
						fetched_at: new Date().toISOString(),
					},
				};

				log.info("Fetch complete", { posts: result.posts.total_posts, comments: result.comments.total_comments });

				return ok(result);
			})
			.tap_err(e => log.error("Fetch failed", e))
			.result();
	}

	private fetchUser(token: string): Promise<Result<{ username: string; meta: RedditMetaStore }, ProviderError>> {
		return pipe
			.fetch<Record<string, unknown>, ProviderError>("https://oauth.reddit.com/api/v1/me", { headers: this.headers(token) }, mapRedditError)
			.map(data => {
				const username = data.name as string;
				return {
					username,
					meta: {
						username,
						user_id: data.id as string,
						icon_img: data.icon_img as string | undefined,
						total_karma: (data.total_karma as number) ?? 0,
						link_karma: (data.link_karma as number) ?? 0,
						comment_karma: (data.comment_karma as number) ?? 0,
						created_utc: data.created_utc as number,
						is_gold: (data.is_gold as boolean) ?? false,
						subreddits_active: [],
						fetched_at: new Date().toISOString(),
					},
				};
			})
			.result();
	}

	private async fetchPosts(token: string, username: string): Promise<Result<RedditPost[], ProviderError>> {
		return this.fetchPaginated(token, `https://oauth.reddit.com/user/${username}/submitted`, this.config.maxPosts, this.parsePost.bind(this));
	}

	private async fetchComments(token: string, username: string): Promise<Result<RedditComment[], ProviderError>> {
		return this.fetchPaginated(token, `https://oauth.reddit.com/user/${username}/comments`, this.config.maxComments, this.parseComment.bind(this));
	}

	private async fetchPaginated<T>(token: string, baseUrl: string, maxItems: number, parser: (item: Record<string, unknown>) => T): Promise<Result<T[], ProviderError>> {
		const items: T[] = [];
		let after: string | null = null;

		while (items.length < maxItems) {
			const url = new URL(baseUrl);
			url.searchParams.set("limit", "100");
			url.searchParams.set("raw_json", "1");
			if (after) url.searchParams.set("after", after);

			const result = await pipe.fetch<{ data: { children: Array<{ data: Record<string, unknown> }>; after: string | null } }, ProviderError>(url.toString(), { headers: this.headers(token) }, mapRedditError).result();

			if (!result.ok) return result;

			const children = result.value.data.children;
			if (children.length === 0) break;

			for (const child of children) {
				items.push(parser(child.data));
			}

			after = result.value.data.after;
			if (!after) break;
		}

		return ok(items.slice(0, maxItems));
	}

	private parsePost(data: Record<string, unknown>): RedditPost {
		return {
			id: data.id as string,
			name: data.name as string,
			title: data.title as string,
			selftext: (data.selftext as string) ?? "",
			url: data.url as string,
			permalink: data.permalink as string,
			subreddit: data.subreddit as string,
			subreddit_prefixed: (data.subreddit_name_prefixed as string) ?? `r/${data.subreddit}`,
			author: data.author as string,
			created_utc: data.created_utc as number,
			score: data.score as number,
			upvote_ratio: data.upvote_ratio as number | undefined,
			num_comments: data.num_comments as number,
			is_self: data.is_self as boolean,
			is_video: (data.is_video as boolean) ?? false,
			thumbnail: data.thumbnail as string | undefined,
			link_flair_text: data.link_flair_text as string | null | undefined,
			over_18: (data.over_18 as boolean) ?? false,
			spoiler: (data.spoiler as boolean) ?? false,
			stickied: (data.stickied as boolean) ?? false,
			locked: (data.locked as boolean) ?? false,
			archived: (data.archived as boolean) ?? false,
		};
	}

	private parseComment(data: Record<string, unknown>): RedditComment {
		return {
			id: data.id as string,
			name: data.name as string,
			body: data.body as string,
			body_html: data.body_html as string | undefined,
			permalink: data.permalink as string,
			link_id: data.link_id as string,
			link_title: data.link_title as string,
			link_permalink: (data.link_permalink as string) ?? "",
			subreddit: data.subreddit as string,
			subreddit_prefixed: (data.subreddit_name_prefixed as string) ?? `r/${data.subreddit}`,
			author: data.author as string,
			created_utc: data.created_utc as number,
			score: data.score as number,
			is_submitter: (data.is_submitter as boolean) ?? false,
			stickied: (data.stickied as boolean) ?? false,
			edited: (data.edited as boolean | number) ?? false,
			parent_id: data.parent_id as string,
		};
	}

	private headers(token: string): Record<string, string> {
		return {
			Authorization: `Bearer ${token}`,
			"User-Agent": this.config.userAgent,
		};
	}
}
