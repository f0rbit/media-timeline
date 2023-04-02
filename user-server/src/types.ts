import { Post } from "@prisma/client";
import { parseTwitterData } from "./api/twitter";
import { parseRedditData } from "./api/reddit";

export interface Config {
	DATABASE_URL: string;
	PORT: number;
	TWITTER: TwitterConfig | null;
	REDDIT: RedditConfig | null;
}

export type TwitterConfig = {
	API_KEY: string;
	API_SECRET: string;
	ACCESS_TOKEN: string;
	ACCESS_SECRET: string;
};

export type RedditConfig = {
	CLIENT_ID: string;
	CLIENT_SECRET: string;
	USERNAME: string;
	PASSWORD: string;
	USER_AGENT: string;
};

export type TwitterResponseData = ReturnType<typeof parseTwitterData>;

export type Tweet = Post & Omit<TwitterResponseData, "created_at">;

export type RedditResponseData = ReturnType<typeof parseRedditData>;
