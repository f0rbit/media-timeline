import type { Backend } from "@f0rbit/corpus/cloudflare";
import type { Database } from "../db";
import type { GitHubFetchResult } from "../platforms/github";
import type { TwitterFetchResult } from "../platforms/twitter";
import type { ProviderError, ProviderFactory } from "../platforms/types";
import type { Result } from "../utils";

export type DrizzleDB = Database;

export type GitHubProviderLike = {
	fetch(token: string): Promise<Result<GitHubFetchResult, ProviderError>>;
};

export type TwitterProviderLike = {
	fetch(token: string): Promise<Result<TwitterFetchResult, ProviderError>>;
};

export type OAuthEnvCredentials = {
	REDDIT_CLIENT_ID?: string;
	REDDIT_CLIENT_SECRET?: string;
	TWITTER_CLIENT_ID?: string;
	TWITTER_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
};

export type AppContext = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
	gitHubProvider?: GitHubProviderLike;
	twitterProvider?: TwitterProviderLike;
	env?: OAuthEnvCredentials;
};
