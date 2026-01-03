import { z } from "zod";

// === Comments ===

export const RedditCommentSchema = z.object({
	id: z.string(),
	name: z.string(), // fullname like "t1_abc123"
	body: z.string(),
	body_html: z.string().optional(),
	permalink: z.string(),
	link_id: z.string(), // parent post fullname
	link_title: z.string(),
	link_permalink: z.string(),
	subreddit: z.string(),
	subreddit_prefixed: z.string(),
	author: z.string(),
	created_utc: z.number(),
	score: z.number(),
	is_submitter: z.boolean().default(false), // is OP
	stickied: z.boolean().default(false),
	edited: z.union([z.boolean(), z.number()]).default(false),
	parent_id: z.string(), // parent comment or post
});

export const RedditCommentsStoreSchema = z.object({
	username: z.string(),
	comments: z.array(RedditCommentSchema),
	total_comments: z.number(),
	fetched_at: z.string().datetime(),
});

export type RedditComment = z.infer<typeof RedditCommentSchema>;
export type RedditCommentsStore = z.infer<typeof RedditCommentsStoreSchema>;

// === Meta ===

export const RedditMetaStoreSchema = z.object({
	username: z.string(),
	user_id: z.string(),
	icon_img: z.string().url().optional(),
	total_karma: z.number(),
	link_karma: z.number(),
	comment_karma: z.number(),
	created_utc: z.number(),
	is_gold: z.boolean().default(false),
	subreddits_active: z.array(z.string()).default([]), // unique subreddits user posts in
	fetched_at: z.string().datetime(),
});

export type RedditMetaStore = z.infer<typeof RedditMetaStoreSchema>;

// === Posts ===

export const RedditPostSchema = z.object({
	id: z.string(),
	name: z.string(), // fullname like "t3_abc123"
	title: z.string(),
	selftext: z.string().default(""),
	url: z.string().url(),
	permalink: z.string(),
	subreddit: z.string(),
	subreddit_prefixed: z.string(),
	author: z.string(),
	created_utc: z.number(),
	score: z.number(),
	upvote_ratio: z.number().optional(),
	num_comments: z.number(),
	is_self: z.boolean(), // true = text post, false = link post
	is_video: z.boolean().default(false),
	thumbnail: z.string().optional(),
	link_flair_text: z.string().nullable().optional(),
	over_18: z.boolean().default(false),
	spoiler: z.boolean().default(false),
	stickied: z.boolean().default(false),
	locked: z.boolean().default(false),
	archived: z.boolean().default(false),
});

export const RedditPostsStoreSchema = z.object({
	username: z.string(),
	posts: z.array(RedditPostSchema),
	total_posts: z.number(),
	fetched_at: z.string().datetime(),
});

export type RedditPost = z.infer<typeof RedditPostSchema>;
export type RedditPostsStore = z.infer<typeof RedditPostsStoreSchema>;
