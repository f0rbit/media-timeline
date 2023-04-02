import Twitter from "twitter";
import { z } from "zod";
import config from "../config";

var client: Twitter | null = null;

export function getTwitterClient() {
	if (client) return client;
	if (!config.TWITTER) throw new Error("Twitter API Keys not set.");
	client = new Twitter({
		consumer_key: config.TWITTER.API_KEY,
		consumer_secret: config.TWITTER.API_SECRET,
		access_token_key: config.TWITTER.ACCESS_TOKEN,
		access_token_secret: config.TWITTER.ACCESS_SECRET,
	});
	return client;
}

export async function fetchTweets(username: string, sinceId?: string) {
	const client = getTwitterClient();

	const params: Twitter.RequestParams = {
		screen_name: username,
		count: 200,
		tweet_mode: "extended",
	};

	if (sinceId) {
		params.sinceId = sinceId;
	}

	const tweets = await client.get("statuses/user_timeline", params);

	return tweets;
}

export function parseTwitterData(data: any) {
	return z
		.object({
			twitter_id: z.number(),
			text: z.string(),
			created_at: z.string(),
			retweet_count: z.number(),
			favorite_count: z.number(),
		})
		.parse(data);
}
