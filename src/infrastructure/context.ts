import type { Backend } from "@f0rbit/corpus/cloudflare";
import type { ProviderFactory } from "../platforms/types";
import type { Database } from "../db";
import type { GitHubFetchResult } from "../platforms/github";
import type { ProviderError } from "../platforms/types";
import type { Result } from "../utils";

export type DrizzleDB = Database;

export type GitHubProviderLike = {
	fetch(token: string): Promise<Result<GitHubFetchResult, ProviderError>>;
};

export type AppContext = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
	gitHubProvider?: GitHubProviderLike;
};
