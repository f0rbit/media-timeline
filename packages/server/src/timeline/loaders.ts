import type { Backend } from "@f0rbit/corpus";
import type { GitHubRepoCommit, GitHubRepoPR, Platform, RedditComment, RedditPost, TweetMedia, TwitterMetaStore, TwitterTweet } from "@media/schema";
import { createLogger } from "../logger";
import { createGitHubCommitsStore, createGitHubPRsStore, createRedditCommentsStore, createRedditPostsStore, createTwitterMetaStore, createTwitterTweetsStore, listGitHubCommitStores, listGitHubPRStores } from "../storage";

const log = createLogger("timeline:loaders");

// === GITHUB ===

type CommitWithRepo = GitHubRepoCommit & { _repo: string };
type PRWithRepo = GitHubRepoPR & { _repo: string };

export type GitHubTimelineData = {
	commits: CommitWithRepo[];
	prs: PRWithRepo[];
};

export const loadGitHubData = async (backend: Backend, accountId: string): Promise<GitHubTimelineData> => {
	const commits: CommitWithRepo[] = [];
	const prs: PRWithRepo[] = [];

	const commitStores = await listGitHubCommitStores(backend, accountId);

	await Promise.all(
		commitStores.map(async ({ owner, repo }) => {
			const storeResult = createGitHubCommitsStore(backend, accountId, owner, repo);
			if (!storeResult.ok) return;

			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok || !snapshotResult.value) return;

			const fullName = `${owner}/${repo}`;
			for (const commit of snapshotResult.value.data.commits) {
				commits.push({ ...commit, _repo: fullName });
			}
		})
	);

	const prStores = await listGitHubPRStores(backend, accountId);

	await Promise.all(
		prStores.map(async ({ owner, repo }) => {
			const storeResult = createGitHubPRsStore(backend, accountId, owner, repo);
			if (!storeResult.ok) return;

			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok || !snapshotResult.value) return;

			const fullName = `${owner}/${repo}`;
			for (const pr of snapshotResult.value.data.pull_requests) {
				prs.push({ ...pr, _repo: fullName });
			}
		})
	);

	log.info("Loaded GitHub data", { account_id: accountId, commits: commits.length, prs: prs.length });
	return { commits, prs };
};

// === REDDIT ===

export type RedditTimelineData = {
	posts: RedditPost[];
	comments: RedditComment[];
};

export const loadRedditData = async (backend: Backend, accountId: string): Promise<RedditTimelineData> => {
	const [posts, comments] = await Promise.all([
		(async (): Promise<RedditPost[]> => {
			const storeResult = createRedditPostsStore(backend, accountId);
			if (!storeResult.ok) return [];
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return [];
			return snapshotResult.value.data.posts;
		})(),
		(async (): Promise<RedditComment[]> => {
			const storeResult = createRedditCommentsStore(backend, accountId);
			if (!storeResult.ok) return [];
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return [];
			return snapshotResult.value.data.comments;
		})(),
	]);

	log.info("Loaded Reddit data", { account_id: accountId, posts: posts.length, comments: comments.length });
	return { posts, comments };
};

// === TWITTER ===

export type TwitterTimelineData = {
	tweets: TwitterTweet[];
	media: TweetMedia[];
	meta: TwitterMetaStore | null;
};

export const loadTwitterData = async (backend: Backend, accountId: string): Promise<TwitterTimelineData> => {
	const [tweetsData, meta] = await Promise.all([
		(async (): Promise<{ tweets: TwitterTweet[]; media: TweetMedia[] }> => {
			const storeResult = createTwitterTweetsStore(backend, accountId);
			if (!storeResult.ok) return { tweets: [], media: [] };
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return { tweets: [], media: [] };
			const data = snapshotResult.value.data;
			return { tweets: data.tweets, media: data.media };
		})(),
		(async (): Promise<TwitterMetaStore | null> => {
			const storeResult = createTwitterMetaStore(backend, accountId);
			if (!storeResult.ok) return null;
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return null;
			return snapshotResult.value.data;
		})(),
	]);

	log.info("Loaded Twitter data", { account_id: accountId, tweets: tweetsData.tweets.length, media: tweetsData.media.length });
	return { tweets: tweetsData.tweets, media: tweetsData.media, meta };
};

// === LOADER REGISTRY ===

type LoadFunction<T = unknown> = (backend: Backend, accountId: string) => Promise<T>;

export const loaders: Record<Platform, LoadFunction> = {
	github: loadGitHubData,
	reddit: loadRedditData,
	twitter: loadTwitterData,
	bluesky: async () => ({}),
	youtube: async () => ({}),
	devpad: async () => ({}),
};

// Legacy aliases for backwards compatibility
export const loadGitHubDataForAccount = loadGitHubData;
export const loadRedditDataForAccount = loadRedditData;
export const loadTwitterDataForAccount = loadTwitterData;

export type { CommitWithRepo, PRWithRepo };
