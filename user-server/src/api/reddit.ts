import Snoowrap from "snoowrap";
import config from "../config";
import { z } from "zod";

var client: Snoowrap | null = null;

function getRedditClient() {
	if (client) return client;
	if (!config.REDDIT) throw new Error("Reddit API Keys not set.");
	client = new Snoowrap({
		userAgent: config.REDDIT.USER_AGENT,
		clientId: config.REDDIT.CLIENT_ID,
		clientSecret: config.REDDIT.CLIENT_SECRET,
		username: config.REDDIT.USERNAME,
		password: config.REDDIT.PASSWORD,
	});
	return client;
}

export async function fetchRedditPosts(username: string, limit?: number) {
	const client = getRedditClient();
	const user = client.getUser(username);
	const posts = await user.getSubmissions({ limit });

	return posts.map(
		(post) =>
			({
				subreddit: post.subreddit.display_name,
				post_title: post.title,
				upvotes: post.ups,
				url: post.url,
				comments: post.num_comments,
				reddit_id: post.name,
				created_utc: post.created_utc,
			} as RedditResponseData)
	);
}

type RedditResponseData = ReturnType<typeof parseRedditData>;

export function parseRedditData(data: any) {
	return z
		.object({
			reddit_id: z.string(),
			post_title: z.string(),
			subreddit: z.string(),
			upvotes: z.number(),
			url: z.string(),
			comments: z.number(),
			created_utc: z.number(),
		})
		.parse(data);
}
