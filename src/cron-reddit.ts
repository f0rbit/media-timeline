import type { Backend } from "@f0rbit/corpus";
import type { FetchError, StoreError } from "./errors";
import { createLogger } from "./logger";
import { mergeByKey } from "./merge";
import type { RedditFetchResult } from "./platforms/reddit";
import type { ProviderError } from "./platforms/types";
import type { RedditCommentsStore, RedditMetaStore, RedditPostsStore } from "./schema";
import { createRedditCommentsStore, createRedditMetaStore, createRedditPostsStore } from "./storage";
import { type Result, ok, pipe, to_nullable } from "./utils";

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

type RedditProcessError = FetchError | StoreError;

const mergePosts = (existing: RedditPostsStore | null, incoming: RedditPostsStore): { merged: RedditPostsStore; newCount: number } => {
	const { merged: posts, newCount } = mergeByKey(existing?.posts, incoming.posts, p => p.id);

	return {
		merged: {
			username: incoming.username,
			posts,
			total_posts: posts.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

const mergeComments = (existing: RedditCommentsStore | null, incoming: RedditCommentsStore): { merged: RedditCommentsStore; newCount: number } => {
	const { merged: comments, newCount } = mergeByKey(existing?.comments, incoming.comments, c => c.id);

	return {
		merged: {
			username: incoming.username,
			comments,
			total_comments: comments.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

type RedditProvider = {
	fetch(token: string): Promise<Result<RedditFetchResult, ProviderError>>;
};

type StoreStats = { version: string; newCount: number; total: number };
const defaultStats: StoreStats = { version: "", newCount: 0, total: 0 };

const storeMeta = async (backend: Backend, accountId: string, meta: RedditMetaStore): Promise<string> => {
	const storeResult = createRedditMetaStore(backend, accountId);
	if (!storeResult.ok) return "";

	const putResult = await storeResult.value.store.put(meta);
	return putResult.ok ? putResult.value.version : "";
};

const storePosts = async (backend: Backend, accountId: string, posts: RedditPostsStore): Promise<StoreStats> => {
	const storeResult = createRedditPostsStore(backend, accountId);
	if (!storeResult.ok) return defaultStats;

	const store = storeResult.value.store;
	// Note: corpus json_codec applies Zod defaults during decode, so the runtime type is correct
	const existing = (to_nullable(await store.get_latest())?.data ?? null) as RedditPostsStore | null;
	const { merged, newCount } = mergePosts(existing, posts);
	const putResult = await store.put(merged);

	return pipe(putResult)
		.map(({ version }) => ({ version, newCount, total: merged.total_posts }))
		.tap(({ newCount: n, total }) => log.debug("Stored posts", { new: n, total }))
		.unwrap_or(defaultStats);
};

const storeComments = async (backend: Backend, accountId: string, comments: RedditCommentsStore): Promise<StoreStats> => {
	const storeResult = createRedditCommentsStore(backend, accountId);
	if (!storeResult.ok) return defaultStats;

	const store = storeResult.value.store;
	// Note: corpus json_codec applies Zod defaults during decode, so the runtime type is correct
	const existing = (to_nullable(await store.get_latest())?.data ?? null) as RedditCommentsStore | null;
	const { merged, newCount } = mergeComments(existing, comments);
	const putResult = await store.put(merged);

	return pipe(putResult)
		.map(({ version }) => ({ version, newCount, total: merged.total_comments }))
		.tap(({ newCount: n, total }) => log.debug("Stored comments", { new: n, total }))
		.unwrap_or(defaultStats);
};

export const processRedditAccount = (backend: Backend, accountId: string, token: string, provider: RedditProvider): Promise<Result<RedditProcessResult, RedditProcessError>> =>
	pipe(provider.fetch(token))
		.tap(() => log.info("Processing account", { account_id: accountId }))
		.map_err((e): RedditProcessError => ({ kind: "fetch_failed", message: `Reddit fetch failed: ${e.kind}` }))
		.flat_map(async ({ meta, posts, comments }) => {
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
