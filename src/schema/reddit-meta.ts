import { z } from "zod";

// User metadata
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
