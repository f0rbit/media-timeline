import type { Backend } from "@f0rbit/corpus";
import { createLogger } from "./logger";
import type { RedditComment, RedditPost, TimelineItem } from "./schema";
import { createRedditCommentsStore, createRedditPostsStore } from "./storage";
import { truncate } from "./utils";

const log = createLogger("timeline:reddit");

export type RedditTimelineData = {
	posts: RedditPost[];
	comments: RedditComment[];
};

export async function loadRedditDataForAccount(backend: Backend, accountId: string): Promise<RedditTimelineData> {
	// Note: corpus json_codec applies Zod defaults during decode, so the runtime type is correct
	const [posts, comments] = await Promise.all([
		(async (): Promise<RedditPost[]> => {
			const storeResult = createRedditPostsStore(backend, accountId);
			if (!storeResult.ok) return [];
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return [];
			return snapshotResult.value.data.posts as RedditPost[];
		})(),
		(async (): Promise<RedditComment[]> => {
			const storeResult = createRedditCommentsStore(backend, accountId);
			if (!storeResult.ok) return [];
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return [];
			return snapshotResult.value.data.comments as RedditComment[];
		})(),
	]);

	log.info("Loaded data", { account_id: accountId, posts: posts.length, comments: comments.length });
	return { posts, comments };
}

export function normalizeReddit(data: RedditTimelineData, _username: string): TimelineItem[] {
	const items: TimelineItem[] = [];

	// Normalize posts
	for (const post of data.posts) {
		const timestamp = new Date(post.created_utc * 1000).toISOString();
		const content = post.is_self ? post.selftext : post.url;
		const hasMedia = post.is_video || (!post.is_self && (post.url.includes("imgur") || post.url.includes("i.redd.it")));

		items.push({
			id: `reddit:post:${post.id}`,
			platform: "reddit",
			type: "post",
			timestamp,
			title: post.title,
			url: `https://reddit.com${post.permalink}`,
			payload: {
				type: "post",
				content: truncate(content, 200),
				author_handle: post.author,
				author_name: post.author,
				reply_count: post.num_comments,
				repost_count: 0, // Reddit doesn't have native repost concept
				like_count: post.score,
				has_media: hasMedia,
				is_reply: false,
				is_repost: false,
				subreddit: post.subreddit,
			},
		});
	}

	// Normalize comments
	for (const comment of data.comments) {
		const timestamp = new Date(comment.created_utc * 1000).toISOString();

		items.push({
			id: `reddit:comment:${comment.id}`,
			platform: "reddit",
			type: "comment",
			timestamp,
			title: truncate(comment.body),
			url: `https://reddit.com${comment.permalink}`,
			payload: {
				type: "comment",
				content: comment.body,
				author_handle: comment.author,
				parent_title: comment.link_title,
				parent_url: comment.link_permalink.startsWith("http") ? comment.link_permalink : `https://reddit.com${comment.link_permalink}`,
				subreddit: comment.subreddit,
				score: comment.score,
				is_op: comment.is_submitter,
			},
		});
	}

	log.info("Normalization complete", { total_items: items.length });
	return items;
}
