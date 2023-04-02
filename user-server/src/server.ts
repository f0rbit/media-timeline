// this file handles the server, which fetches posts from various website periodically and stores them in the database
import Twitter from "twitter";
import prisma from "./api/prisma";
import { fetchTweets, getTwitterClient, parseTwitterData } from "./api/twitter";
import { TwitterConfig, TwitterResponseData } from "./types";
import { Platform } from "@prisma/client";
import { addPost, getRedditPosts, getTweets } from "./api/posts";
import config from "./config";
import { fetchRedditPosts } from "./api/reddit";

export async function update() {
	console.log("Updating posts...");
	await updateTwitter();
	// fetch posts from reddit
	await updateReddit();
	// fetch commits on github
}

async function updateTwitter() {
	if (!config.TWITTER) return;
	// fetch posts from twitter
	const fetched_tweets = await fetchTweets("f0rbit");
	const parsed_tweets: TwitterResponseData[] = fetched_tweets.map((tweet: Twitter.ResponseData) => ({
		twitter_id: tweet.id,
		created_at: tweet.created_at,
		text: tweet.full_text,
		retweet_count: tweet.retweet_count,
		favorite_count: tweet.favorite_count,
	}));

	const existing_tweets = await getTweets();
	const existing_ids = new Set(existing_tweets.map((tweet) => tweet.twitter_id));
	const new_tweets = parsed_tweets.filter((tweet) => !existing_ids.has(tweet.twitter_id));

	console.log("Fetched " + parsed_tweets.length + " tweets, " + existing_tweets.length + " existing tweets, " + new_tweets.length + " new tweets.");

	for (const tweet of new_tweets) {
		await addPost({
			platform: Platform.TWITTER,
			data: JSON.stringify(tweet),
			title: "Tweet",
			posted_at: new Date(tweet.created_at),
			published: true,
		});
	}
}

async function updateReddit() {
	if (!config.REDDIT) return;
	// fetch posts from reddit
	const fetched_posts = await fetchRedditPosts("f0rbit");

	const existing_posts = await getRedditPosts();
	const existing_ids = new Set(existing_posts.map((post) => post.reddit_id));
	const new_posts = fetched_posts.filter((post) => !existing_ids.has(post.reddit_id));

	console.log("Fetched " + fetched_posts.length + " posts, " + existing_posts.length + " existing posts, " + new_posts.length + " new posts.");

	for (const post of new_posts) {
		await addPost({
			platform: Platform.REDDIT,
			data: JSON.stringify(post),
			title: post.post_title,
			posted_at: new Date(post.created_utc),
			published: true,
		});
	}
}
