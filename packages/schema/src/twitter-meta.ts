import { z } from "zod";

export const TwitterUserMetricsSchema = z.object({
	followers_count: z.number(),
	following_count: z.number(),
	tweet_count: z.number(),
	listed_count: z.number(),
});

export const TwitterMetaStoreSchema = z.object({
	id: z.string(),
	username: z.string(),
	name: z.string(),
	description: z.string().optional(),
	profile_image_url: z.string().url().optional(),
	profile_banner_url: z.string().url().optional(),
	url: z.string().url().optional(),
	location: z.string().optional(),
	created_at: z.string().datetime(),
	verified: z.boolean().default(false),
	verified_type: z.enum(["blue", "business", "government", "none"]).default("none"),
	protected: z.boolean().default(false),
	public_metrics: TwitterUserMetricsSchema,
	pinned_tweet_id: z.string().optional(),
	fetched_at: z.string().datetime(),
});

export type TwitterUserMetrics = z.infer<typeof TwitterUserMetricsSchema>;
export type TwitterMetaStore = z.infer<typeof TwitterMetaStoreSchema>;
