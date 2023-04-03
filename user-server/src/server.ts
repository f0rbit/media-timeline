// this file handles the server, which fetches posts from various website periodically and stores them in the database
import { Platform } from "@prisma/client";
import Twitter from "twitter";
import { fetchGithubCommits } from "./api/github";
import { addPost, getPosts } from "./api/posts";
import { fetchRedditPosts } from "./api/reddit";
import { fetchTweets } from "./api/twitter";
import config from "./config";
import { TwitterResponseData } from "./types";

export async function update() {
	console.log("Updating posts...");
	await updateTwitter();
	await updateReddit();
	await updateGithub();
}

async function updateTwitter() {
	if (!config.TWITTER) return;
	// fetch posts from twitter
	const fetched_tweets = await fetchTweets("f0rbit");
	const parsed_tweets: TwitterResponseData[] = fetched_tweets.map(({ id, created_at, full_text, retweet_count, favorite_count }: Twitter.ResponseData) => ({
		twitter_id: id,
		created_at,
		text: full_text,
		retweet_count,
		favorite_count,
	}));

	const existing_ids = await getExistingIds(Platform.TWITTER);
	const new_tweets = parsed_tweets.filter(({ twitter_id }) => !existing_ids.has(twitter_id));

	console.log(`Fetched ${parsed_tweets.length} tweets, ${existing_ids.size} existing tweets, ${new_tweets.length} new tweets.`);

	for (const tweet of new_tweets) {
		await addPost({
			platform: Platform.TWITTER,
			data: JSON.stringify(tweet),
			title: "Tweet by @user",
			posted_at: new Date(tweet.created_at),
			published: true,
		});
	}
}

async function updateReddit() {
	if (!config.REDDIT) return;
	// fetch posts from reddit
	const fetched_posts = await fetchRedditPosts("f0rbit");

	const existing_ids = await getExistingIds(Platform.REDDIT);
	const new_posts = fetched_posts.filter(({ reddit_id }) => !existing_ids.has(reddit_id));

	console.log(`Fetched ${fetched_posts.length} posts, ${existing_ids.size} existing posts, ${new_posts.length} new posts.`);

	for (const post of new_posts) {
		await addPost({
			platform: Platform.REDDIT,
			data: JSON.stringify(post),
			title: post.post_title,
			posted_at: new Date(post.created_utc * 1000),
			published: true,
		});
	}
}

async function updateGithub() {
	if (!config.GITHUB) return;

	const fetched_commits = await fetchGithubCommits();

	const existing_ids = await getExistingIds(Platform.GITHUB);
	const new_commits = fetched_commits.filter(({ sha }) => !existing_ids.has(sha));

	console.log(`Fetched ${fetched_commits.length} commits, ${existing_ids.size} existing commits, ${new_commits.length} new commits.`);

	for (const commit of new_commits) {
		await addPost({
			platform: Platform.GITHUB,
			data: JSON.stringify(commit),
			title: commit.title,
			posted_at: new Date(commit.date),
			published: !commit.private,
		});
	}
}

async function getExistingIds(platform: Platform): Promise<Set<string | number | null>> {
	const existing = await getPosts(platform);
	switch (platform) {
		case Platform.TWITTER:
			return new Set(existing.map(({ data, platform }) => (platform == Platform.TWITTER ? data.twitter_id : null)));
		case Platform.REDDIT:
			return new Set(existing.map(({ data, platform }) => (platform == Platform.REDDIT ? data.reddit_id : null)));
		case Platform.GITHUB:
			return new Set(existing.map(({ data, platform }) => (platform == Platform.GITHUB ? data.sha : null)));
		default:
			return new Set<string>();
	}
}
