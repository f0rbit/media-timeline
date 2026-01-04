import type { Backend } from "@f0rbit/corpus";
import type { RedditCommentsStore, RedditMetaStore, RedditPostsStore } from "@media/schema";
import { type ProcessError, type StoreStats, formatFetchError, storeMeta as genericStoreMeta, storeWithMerge } from "./cron/platform-processor";
import { createLogger } from "./logger";
import { mergeByKey } from "./merge";
import type { AccountWithUser } from "./platforms/registry";
import type { RedditFetchResult, RedditProvider } from "./platforms/reddit";
import type { ProviderError } from "./platforms/types";
import { createRedditCommentsStore, createRedditMetaStore, createRedditPostsStore } from "./storage";
import { type Result, ok, pipe } from "./utils";

const log = createLogger("cron:reddit");

export type RedditProcessResult = {
	account_id: string;
	meta_version: string;
	posts_version: string;
	comments_version: string;
	stats: {
		total_posts: number;
		total_comments: number;
		new_posts: number;
		new_comments: number;
	};
};

const mergePosts = (existing: RedditPostsStore | null, incoming: RedditPostsStore): { merged: RedditPostsStore; newCount: number } => {
	const { merged: posts, newCount } = mergeByKey(existing?.posts, incoming.posts, p => p.id);
	return {
		merged: { username: incoming.username, posts, total_posts: posts.length, fetched_at: incoming.fetched_at },
		newCount,
	};
};

const mergeComments = (existing: RedditCommentsStore | null, incoming: RedditCommentsStore): { merged: RedditCommentsStore; newCount: number } => {
	const { merged: comments, newCount } = mergeByKey(existing?.comments, incoming.comments, c => c.id);
	return {
		merged: { username: incoming.username, comments, total_comments: comments.length, fetched_at: incoming.fetched_at },
		newCount,
	};
};

const storeMeta = (backend: Backend, accountId: string, meta: RedditMetaStore): Promise<string> => genericStoreMeta(backend, accountId, createRedditMetaStore, meta);

const storePosts = (backend: Backend, accountId: string, posts: RedditPostsStore): Promise<StoreStats> =>
	storeWithMerge(backend, accountId, { name: "posts", create: createRedditPostsStore, merge: mergePosts, getKey: () => "", getTotal: m => m.total_posts }, posts);

const storeComments = (backend: Backend, accountId: string, comments: RedditCommentsStore): Promise<StoreStats> =>
	storeWithMerge(backend, accountId, { name: "comments", create: createRedditCommentsStore, merge: mergeComments, getKey: () => "", getTotal: m => m.total_comments }, comments);

/**
 * Process a Reddit account. For BYO accounts, we use the stored username (platform_username)
 * since client_credentials tokens can't access /api/v1/me.
 */
export const processRedditAccount = (backend: Backend, accountId: string, token: string, provider: RedditProvider, account?: AccountWithUser): Promise<Result<RedditProcessResult, ProcessError>> => {
	// For BYO accounts, use fetchForUsername with the stored username
	// The username is stored in platform_username when setting up BYO credentials
	const storedUsername = account?.platform_user_id;

	const fetchPromise = storedUsername ? provider.fetchForUsername(token, storedUsername) : provider.fetch(token);

	return pipe(fetchPromise)
		.tap(() => log.info("Processing account", { account_id: accountId, username: storedUsername ?? "from-oauth" }))
		.map_err((e): ProcessError => formatFetchError("Reddit", e))
		.flat_map(async ({ meta, posts, comments }) => {
			log.debug("Storing Reddit data", {
				account_id: accountId,
				incoming_posts: posts.posts.length,
				incoming_comments: comments.comments.length,
				username: posts.username,
			});

			const [metaVersion, postsResult, commentsResult] = await Promise.all([storeMeta(backend, accountId, meta), storePosts(backend, accountId, posts), storeComments(backend, accountId, comments)]);

			log.info("Processing complete", {
				account_id: accountId,
				posts: postsResult.total,
				comments: commentsResult.total,
				new_posts: postsResult.newCount,
				new_comments: commentsResult.newCount,
			});

			return ok({
				account_id: accountId,
				meta_version: metaVersion,
				posts_version: postsResult.version,
				comments_version: commentsResult.version,
				stats: {
					total_posts: postsResult.total,
					total_comments: commentsResult.total,
					new_posts: postsResult.newCount,
					new_comments: commentsResult.newCount,
				},
			});
		})
		.result();
};
