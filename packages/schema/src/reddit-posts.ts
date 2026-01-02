import { z } from "zod";

// Individual Reddit post (submission)
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

// Store for posts per user
export const RedditPostsStoreSchema = z.object({
	username: z.string(),
	posts: z.array(RedditPostSchema),
	total_posts: z.number(),
	fetched_at: z.string().datetime(),
});

export type RedditPost = z.infer<typeof RedditPostSchema>;
export type RedditPostsStore = z.infer<typeof RedditPostsStoreSchema>;
