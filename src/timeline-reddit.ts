import type { Backend } from "@f0rbit/corpus";
import type { RedditComment, RedditPost, TimelineItem } from "./schema";
import { createRedditCommentsStore, createRedditPostsStore } from "./storage";

export type RedditTimelineData = {
	posts: RedditPost[];
	comments: RedditComment[];
};

export async function loadRedditDataForAccount(backend: Backend, accountId: string): Promise<RedditTimelineData> {
	const posts: RedditPost[] = [];
	const comments: RedditComment[] = [];

	const postsStoreResult = createRedditPostsStore(backend, accountId);
	if (postsStoreResult.ok) {
		const snapshotResult = await postsStoreResult.value.store.get_latest();
		if (snapshotResult.ok && snapshotResult.value) {
			posts.push(...snapshotResult.value.data.posts);
		}
	}

	const commentsStoreResult = createRedditCommentsStore(backend, accountId);
	if (commentsStoreResult.ok) {
		const snapshotResult = await commentsStoreResult.value.store.get_latest();
		if (snapshotResult.ok && snapshotResult.value) {
			comments.push(...snapshotResult.value.data.comments);
		}
	}

	console.log(`[loadRedditDataForAccount] Loaded: ${posts.length} posts, ${comments.length} comments`);
	return { posts, comments };
}

const truncateContent = (content: string, maxLength = 200): string => {
	if (content.length <= maxLength) return content;
	return `${content.slice(0, maxLength - 3)}...`;
};

const truncateTitle = (text: string, maxLength = 72): string => {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxLength) return singleLine;
	return `${singleLine.slice(0, maxLength - 3)}...`;
};

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
				content: truncateContent(content),
				author_handle: post.author,
				author_name: post.author,
				reply_count: post.num_comments,
				repost_count: 0, // Reddit doesn't have native repost concept
				like_count: post.score,
				has_media: hasMedia,
				is_reply: false,
				is_repost: false,
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
			title: truncateTitle(comment.body),
			url: `https://reddit.com${comment.permalink}`,
			payload: {
				type: "comment",
				content: comment.body,
				author_handle: comment.author,
				parent_title: comment.link_title,
				parent_url: `https://reddit.com${comment.link_permalink}`,
				subreddit: comment.subreddit,
				score: comment.score,
				is_op: comment.is_submitter,
			},
		});
	}

	console.log(`[normalizeReddit] Generated ${items.length} timeline items`);
	return items;
}
