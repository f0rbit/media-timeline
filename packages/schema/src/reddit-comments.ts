import { z } from "zod";

// Individual Reddit comment
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

// Store for comments per user
export const RedditCommentsStoreSchema = z.object({
	username: z.string(),
	comments: z.array(RedditCommentSchema),
	total_comments: z.number(),
	fetched_at: z.string().datetime(),
});

export type RedditComment = z.infer<typeof RedditCommentSchema>;
export type RedditCommentsStore = z.infer<typeof RedditCommentsStoreSchema>;
