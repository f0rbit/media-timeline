import { errors, type GitHubRaw as LegacyGitHubRaw } from "@media/schema";
import type { ProviderFactory } from "@media/server/cron";
import type { GitHubProviderLike } from "@media/server/infrastructure/context";
import { BlueskyMemoryProvider, DevpadMemoryProvider, GitHubMemoryProvider, RedditMemoryProvider, TwitterMemoryProvider, YouTubeMemoryProvider } from "@media/server/platforms";
import type { GitHubFetchResult } from "@media/server/platforms/github";
import { ok } from "@media/server/utils";
import { ACCOUNTS, GITHUB_V2_FIXTURES, makeGitHubFetchResult } from "../integration/fixtures";

export type TestProviders = {
	github: GitHubMemoryProvider;
	bluesky: BlueskyMemoryProvider;
	youtube: YouTubeMemoryProvider;
	devpad: DevpadMemoryProvider;
	reddit: RedditMemoryProvider;
	twitter: TwitterMemoryProvider;
};

export const createTestProviders = (): TestProviders => ({
	github: new GitHubMemoryProvider({}),
	bluesky: new BlueskyMemoryProvider({}),
	youtube: new YouTubeMemoryProvider({}),
	devpad: new DevpadMemoryProvider({}),
	reddit: new RedditMemoryProvider({}),
	twitter: new TwitterMemoryProvider({}),
});

export const defaultTestProviderFactory: ProviderFactory = {
	async create(platform, _platformUserId, _token) {
		return errors.badRequest(`Unknown platform: ${platform}`);
	},
};

type ProviderDataMap = Record<string, Record<string, unknown>>;

export const createAppContextWithProviders = <T extends { appContext: { providerFactory: ProviderFactory } }>(ctx: T, providerData: ProviderDataMap): T["appContext"] => ({
	...ctx.appContext,
	providerFactory: {
		async create(platform, _platformUserId, _token) {
			const data = Object.entries(providerData).find(([_accountId, _]) => true)?.[1];
			if (data) return ok(data);
			return errors.badRequest(`Unknown platform: ${platform}`);
		},
	},
});

export const createProviderFactoryFromData = (providerData: ProviderDataMap): ProviderFactory => ({
	async create(_platform, _platformUserId, _token) {
		const data = Object.values(providerData)[0];
		if (data) return ok(data);
		return errors.badRequest(`Unknown platform: ${_platform}`);
	},
});

export const createProviderFactoryByAccountId =
	(providerData: ProviderDataMap): ((accountId: string) => ProviderFactory) =>
	(accountId: string) => ({
		async create(platform, _platformUserId, _token) {
			const data = providerData[accountId];
			if (data) return ok(data);
			return errors.badRequest(`Unknown platform: ${platform}`);
		},
	});

export type ProviderDataByToken = Record<string, Record<string, unknown>>;

export const createProviderFactoryByToken = (dataByToken: ProviderDataByToken): ProviderFactory => ({
	async create(_platform, _platformUserId, token) {
		const data = dataByToken[token];
		if (data) return ok(data);
		return errors.apiError(404, `No mock data for token: ${token.slice(0, 10)}...`);
	},
});

export const createProviderFactoryFromAccounts = (dataByAccountId: Record<string, Record<string, unknown>>, accountFixtures: Record<string, { id: string; access_token: string }> = ACCOUNTS): ProviderFactory => {
	const dataByToken: ProviderDataByToken = {};

	for (const [accountId, data] of Object.entries(dataByAccountId)) {
		const account = Object.values(accountFixtures).find(a => a.id === accountId);
		if (account) {
			dataByToken[account.access_token] = data;
		}
	}

	return createProviderFactoryByToken(dataByToken);
};

type GitHubV2DataByAccountId = Record<string, GitHubFetchResult>;
type LegacyGitHubDataByAccountId = Record<string, LegacyGitHubRaw>;

const convertLegacyToV2 = (data: LegacyGitHubRaw): GitHubFetchResult => {
	const repoCommits = new Map<string, Array<{ sha?: string; message?: string; date?: string }>>();

	for (const commit of data.commits) {
		const existing = repoCommits.get(commit.repo) ?? [];
		existing.push({ sha: commit.sha, message: commit.message, date: commit.date });
		repoCommits.set(commit.repo, existing);
	}

	const repos = Array.from(repoCommits.entries()).map(([repo, commits]) => ({ repo, commits }));
	return repos.length > 0 ? makeGitHubFetchResult(repos) : makeGitHubFetchResult([]);
};

export const createGitHubProviderFromAccounts = (dataByAccountId: GitHubV2DataByAccountId, accountFixtures: Record<string, { id: string; access_token: string }> = ACCOUNTS): GitHubProviderLike => {
	const dataByToken: Record<string, GitHubFetchResult> = {};

	for (const [accountId, data] of Object.entries(dataByAccountId)) {
		const account = Object.values(accountFixtures).find(a => a.id === accountId);
		if (account) {
			dataByToken[account.access_token] = data;
		}
	}

	return {
		async fetch(token: string) {
			const data = dataByToken[token];
			if (data) return ok(data);
			return ok(GITHUB_V2_FIXTURES.empty());
		},
	};
};

export const createGitHubProviderFromLegacyAccounts = (dataByAccountId: LegacyGitHubDataByAccountId, accountFixtures: Record<string, { id: string; access_token: string }> = ACCOUNTS): GitHubProviderLike => {
	const v2Data: GitHubV2DataByAccountId = {};
	for (const [accountId, data] of Object.entries(dataByAccountId)) {
		v2Data[accountId] = convertLegacyToV2(data);
	}
	return createGitHubProviderFromAccounts(v2Data, accountFixtures);
};

export type SetupGitHubProviderFn = (providers: TestProviders, data: LegacyGitHubRaw) => void;

export const setupGitHubProvider: SetupGitHubProviderFn = (providers, data) => {
	const repoCommits = new Map<string, Array<{ sha?: string; message?: string; date?: string }>>();

	for (const commit of data.commits) {
		const existing = repoCommits.get(commit.repo) ?? [];
		existing.push({ sha: commit.sha, message: commit.message, date: commit.date });
		repoCommits.set(commit.repo, existing);
	}

	const repos = Array.from(repoCommits.entries()).map(([repo, commits]) => ({ repo, commits }));
	const fetchResult = repos.length > 0 ? makeGitHubFetchResult(repos) : makeGitHubFetchResult([]);

	providers.github.setUsername(fetchResult.meta.username);
	providers.github.setRepositories(fetchResult.meta.repositories);
	for (const [fullName, repoData] of fetchResult.repos) {
		providers.github.setRepoData(fullName, repoData);
	}
};
