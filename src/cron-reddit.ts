import type { Backend } from "@f0rbit/corpus";
import type { RedditFetchResult } from "./platforms/reddit";
import type { ProviderError } from "./platforms/types";
import type { RedditCommentsStore, RedditPostsStore } from "./schema";
import { createRedditCommentsStore, createRedditMetaStore, createRedditPostsStore } from "./storage";
import { err, ok, type Result, to_nullable } from "./utils";

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

type ProcessError = { kind: "fetch_failed"; message: string } | { kind: "store_failed"; store_id: string };

type MergeResult<T> = { merged: T; newCount: number };

const mergePosts = (existing: RedditPostsStore | null, incoming: RedditPostsStore): MergeResult<RedditPostsStore> => {
	if (!existing) {
		return { merged: incoming, newCount: incoming.posts.length };
	}

	const existingIds = new Set(existing.posts.map(p => p.id));
	const newPosts = incoming.posts.filter(p => !existingIds.has(p.id));

	const updatedExisting = existing.posts.map(existingPost => {
		const incomingPost = incoming.posts.find(p => p.id === existingPost.id);
		return incomingPost ?? existingPost;
	});

	return {
		merged: {
			username: incoming.username,
			posts: [...updatedExisting, ...newPosts],
			total_posts: updatedExisting.length + newPosts.length,
			fetched_at: incoming.fetched_at,
		},
		newCount: newPosts.length,
	};
};

const mergeComments = (existing: RedditCommentsStore | null, incoming: RedditCommentsStore): MergeResult<RedditCommentsStore> => {
	if (!existing) {
		return { merged: incoming, newCount: incoming.comments.length };
	}

	const existingIds = new Set(existing.comments.map(c => c.id));
	const newComments = incoming.comments.filter(c => !existingIds.has(c.id));

	const updatedExisting = existing.comments.map(existingComment => {
		const incomingComment = incoming.comments.find(c => c.id === existingComment.id);
		return incomingComment ?? existingComment;
	});

	return {
		merged: {
			username: incoming.username,
			comments: [...updatedExisting, ...newComments],
			total_comments: updatedExisting.length + newComments.length,
			fetched_at: incoming.fetched_at,
		},
		newCount: newComments.length,
	};
};

type RedditProvider = {
	fetch(token: string): Promise<Result<RedditFetchResult, ProviderError>>;
};

export async function processRedditAccount(backend: Backend, accountId: string, token: string, provider: RedditProvider): Promise<Result<RedditProcessResult, ProcessError>> {
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

	console.log(`[processRedditAccount] Completed:`, {
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
