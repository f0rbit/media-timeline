import { z } from "zod";

export const TweetMetricsSchema = z.object({
	retweet_count: z.number().default(0),
	reply_count: z.number().default(0),
	like_count: z.number().default(0),
	quote_count: z.number().default(0),
	impression_count: z.number().optional(),
	bookmark_count: z.number().optional(),
});

export const TweetMediaSchema = z.object({
	media_key: z.string(),
	type: z.enum(["photo", "video", "animated_gif"]),
	url: z.string().url().optional(),
	preview_image_url: z.string().url().optional(),
	alt_text: z.string().optional(),
	duration_ms: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

export const TweetUrlSchema = z.object({
	start: z.number(),
	end: z.number(),
	url: z.string(),
	expanded_url: z.string().optional(),
	display_url: z.string().optional(),
	title: z.string().optional(),
	description: z.string().optional(),
});

export const TwitterTweetSchema = z.object({
	id: z.string(),
	text: z.string(),
	created_at: z.string().datetime(),
	author_id: z.string(),
	conversation_id: z.string().optional(),
	in_reply_to_user_id: z.string().optional(),
	public_metrics: TweetMetricsSchema,
	possibly_sensitive: z.boolean().default(false),
	lang: z.string().optional(),
	source: z.string().optional(),
	referenced_tweets: z
		.array(
			z.object({
				type: z.enum(["retweeted", "quoted", "replied_to"]),
				id: z.string(),
			})
		)
		.optional(),
	attachments: z
		.object({
			media_keys: z.array(z.string()).optional(),
			poll_ids: z.array(z.string()).optional(),
		})
		.optional(),
	entities: z
		.object({
			urls: z.array(TweetUrlSchema).optional(),
			mentions: z
				.array(
					z.object({
						start: z.number(),
						end: z.number(),
						username: z.string(),
						id: z.string(),
					})
				)
				.optional(),
			hashtags: z
				.array(
					z.object({
						start: z.number(),
						end: z.number(),
						tag: z.string(),
					})
				)
				.optional(),
		})
		.optional(),
});

export const TwitterTweetsStoreSchema = z.object({
	user_id: z.string(),
	username: z.string(),
	tweets: z.array(TwitterTweetSchema),
	media: z.array(TweetMediaSchema).default([]),
	total_tweets: z.number(),
	oldest_tweet_id: z.string().optional(),
	newest_tweet_id: z.string().optional(),
	fetched_at: z.string().datetime(),
});

export type TweetMetrics = z.infer<typeof TweetMetricsSchema>;
export type TweetMedia = z.infer<typeof TweetMediaSchema>;
export type TweetUrl = z.infer<typeof TweetUrlSchema>;
export type TwitterTweet = z.infer<typeof TwitterTweetSchema>;
export type TwitterTweetsStore = z.infer<typeof TwitterTweetsStoreSchema>;
