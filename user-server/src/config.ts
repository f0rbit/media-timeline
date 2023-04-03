import dotenv from "dotenv";
import { Config, GithubConfig, RedditConfig, TwitterConfig } from "./types";

dotenv.config();

const twitter = {
	API_KEY: process.env.TWITTER_API_KEY,
	API_SECRET: process.env.TWITTER_API_SECRET,
	ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
	ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET,
};

var invalid_twitter = false;
if (twitter.API_KEY === undefined || twitter.API_SECRET === undefined || twitter.ACCESS_TOKEN === undefined || twitter.ACCESS_SECRET === undefined) {
	console.log("Twitter API Keys not set.");
	invalid_twitter = true;
}

const reddit = {
	CLIENT_ID: process.env.REDDIT_CLIENT_ID,
	CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
	USERNAME: process.env.REDDIT_USERNAME,
	PASSWORD: process.env.REDDIT_PASSWORD,
	USER_AGENT: process.env.REDDIT_USER_AGENT,
};

var invalid_reddit = false;
if (reddit.CLIENT_ID === undefined || reddit.CLIENT_SECRET === undefined || reddit.USERNAME === undefined || reddit.PASSWORD === undefined || reddit.USER_AGENT === undefined) {
	console.log("Reddit API Keys not set.");
	invalid_reddit = true;
}

const github = {
	AUTH_TOKEN: process.env.GITHUB_AUTH_TOKEN,
	USERNAME: process.env.GITHUB_USERNAME,
};

var invalid_github = false;
if (github.AUTH_TOKEN === undefined || github.USERNAME === undefined) {
	console.log("Github API Keys not set.");
	invalid_github = true;
}

const config: Config = {
	DATABASE_URL: process.env.DATABASE_URL || "",
	PORT: Number(process.env.PORT) || 3000,
	TWITTER: invalid_twitter ? null : (twitter as TwitterConfig),
	REDDIT: invalid_reddit ? null : (reddit as RedditConfig),
	GITHUB: invalid_github ? null : (github as GithubConfig),
};

if (config.DATABASE_URL === "") {
	throw new Error("DATABASE_URL is not set");
}

export default config;
