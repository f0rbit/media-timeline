import type { Backend } from "@f0rbit/corpus";
import type { FetchError, StoreError } from "./errors";
import { mergeByKey } from "./merge";
import type { RedditFetchResult } from "./platforms/reddit";
import type { ProviderError } from "./platforms/types";
import type { RedditCommentsStore, RedditPostsStore } from "./schema";
import { createRedditCommentsStore, createRedditMetaStore, createRedditPostsStore } from "./storage";
import { type Result, err, ok, to_nullable } from "./utils";

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

export async function processRedditAccount(backend: Backend, accountId: string, token: string, provider: RedditProvider): Promise<Result<RedditProcessResult, RedditProcessError>> {
	console.log(`[processRedditAccount] Starting for account: ${accountId}`);

	const fetchResult = await provider.fetch(token);
	if (!fetchResult.ok) {
		return err({
			kind: "fetch_failed",
			message: `Reddit fetch failed: ${fetchResult.error.kind}`,
		});
	}

	const { meta, posts, comments } = fetchResult.value;

	let metaVersion = "";
	const metaStoreResult = createRedditMetaStore(backend, accountId);
	if (metaStoreResult.ok) {
		const putResult = await metaStoreResult.value.store.put(meta);
		if (putResult.ok) {
			metaVersion = putResult.value.version;
		}
	}

	let postsVersion = "";
	let newPosts = 0;
	let totalPosts = 0;
	const postsStoreResult = createRedditPostsStore(backend, accountId);
	if (postsStoreResult.ok) {
		const store = postsStoreResult.value.store;
		const existingResult = await store.get_latest();
		const existing = to_nullable(existingResult)?.data ?? null;
		const { merged, newCount } = mergePosts(existing, posts);
		newPosts = newCount;
		totalPosts = merged.total_posts;

		const putResult = await store.put(merged);
		if (putResult.ok) {
			postsVersion = putResult.value.version;
		}

		console.log(`[processRedditAccount] Posts: ${newCount} new, ${merged.total_posts} total`);
	}

	let commentsVersion = "";
	let newComments = 0;
	let totalComments = 0;
	const commentsStoreResult = createRedditCommentsStore(backend, accountId);
	if (commentsStoreResult.ok) {
		const store = commentsStoreResult.value.store;
		const existingResult = await store.get_latest();
		const existing = to_nullable(existingResult)?.data ?? null;
		const { merged, newCount } = mergeComments(existing, comments);
		newComments = newCount;
		totalComments = merged.total_comments;

		const putResult = await store.put(merged);
		if (putResult.ok) {
			commentsVersion = putResult.value.version;
		}

		console.log(`[processRedditAccount] Comments: ${newCount} new, ${merged.total_comments} total`);
	}

	console.log("[processRedditAccount] Completed:", {
		posts: totalPosts,
		comments: totalComments,
		newPosts,
		newComments,
	});

	return ok({
		account_id: accountId,
		meta_version: metaVersion,
		posts_version: postsVersion,
		comments_version: commentsVersion,
		stats: {
			total_posts: totalPosts,
			total_comments: totalComments,
			new_posts: newPosts,
			new_comments: newComments,
		},
	});
}
