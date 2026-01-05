import { type Backend, type Parser, type Store, create_corpus, define_store, json_codec } from "@f0rbit/corpus";
import {
	BlueskyRawSchema,
	DevpadRawSchema,
	errors,
	type GitHubMetaStore,
	GitHubMetaStoreSchema,
	GitHubRawSchema,
	type GitHubRepoCommitsStore,
	GitHubRepoCommitsStoreSchema,
	type GitHubRepoPRsStore,
	GitHubRepoPRsStoreSchema,
	type ParseError,
	type RedditCommentsStore,
	RedditCommentsStoreSchema,
	type RedditMetaStore,
	RedditMetaStoreSchema,
	type RedditPostsStore,
	RedditPostsStoreSchema,
	type StoreError,
	TimelineSchema,
	type TwitterMetaStore,
	TwitterMetaStoreSchema,
	type TwitterTweetsStore,
	TwitterTweetsStoreSchema,
	YouTubeRawSchema,
} from "@media/schema";
import { z } from "zod";
import { type Result, ok } from "./utils";

const STORAGE_PREFIX = "media";

export type CorpusError = StoreError | ParseError;

const createTypedStore = <TData, TId extends string>(backend: Backend, id: TId, schema: Parser<TData>): Result<{ store: Store<TData>; id: TId }, CorpusError> => {
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(schema)))
		.build();
	const store = corpus.stores[id];
	if (!store) return errors.storeError("get", `Store not found: ${id}`);
	return ok({ store, id });
};

export const STORE_PATTERNS = {
	raw: (platform: string, accountId: string) => `${STORAGE_PREFIX}/raw/${platform}/${accountId}` as const,
	timeline: (userId: string) => `${STORAGE_PREFIX}/timeline/${userId}` as const,
	githubMeta: (accountId: string) => `${STORAGE_PREFIX}/github/${accountId}/meta` as const,
	githubCommits: (accountId: string, owner: string, repo: string) => `${STORAGE_PREFIX}/github/${accountId}/commits/${owner}/${repo}` as const,
	githubPRs: (accountId: string, owner: string, repo: string) => `${STORAGE_PREFIX}/github/${accountId}/prs/${owner}/${repo}` as const,
	redditMeta: (accountId: string) => `${STORAGE_PREFIX}/reddit/${accountId}/meta` as const,
	redditPosts: (accountId: string) => `${STORAGE_PREFIX}/reddit/${accountId}/posts` as const,
	redditComments: (accountId: string) => `${STORAGE_PREFIX}/reddit/${accountId}/comments` as const,
	twitterMeta: (accountId: string) => `${STORAGE_PREFIX}/twitter/${accountId}/meta` as const,
	twitterTweets: (accountId: string) => `${STORAGE_PREFIX}/twitter/${accountId}/tweets` as const,
} as const;

export type RawStoreId = ReturnType<typeof STORE_PATTERNS.raw>;
export type TimelineStoreId = ReturnType<typeof STORE_PATTERNS.timeline>;
export type GitHubMetaStoreId = ReturnType<typeof STORE_PATTERNS.githubMeta>;
export type GitHubCommitsStoreId = ReturnType<typeof STORE_PATTERNS.githubCommits>;
export type GitHubPRsStoreId = ReturnType<typeof STORE_PATTERNS.githubPRs>;
export type RedditMetaStoreId = ReturnType<typeof STORE_PATTERNS.redditMeta>;
export type RedditPostsStoreId = ReturnType<typeof STORE_PATTERNS.redditPosts>;
export type RedditCommentsStoreId = ReturnType<typeof STORE_PATTERNS.redditComments>;
export type TwitterMetaStoreId = ReturnType<typeof STORE_PATTERNS.twitterMeta>;
export type TwitterTweetsStoreId = ReturnType<typeof STORE_PATTERNS.twitterTweets>;

export type StoreId = RawStoreId | TimelineStoreId | GitHubMetaStoreId | GitHubCommitsStoreId | GitHubPRsStoreId | RedditMetaStoreId | RedditPostsStoreId | RedditCommentsStoreId | TwitterMetaStoreId | TwitterTweetsStoreId;

export type ParsedStoreId =
	| { type: "github_meta"; accountId: string }
	| { type: "github_commits"; accountId: string; owner: string; repo: string; branch: string }
	| { type: "github_prs"; accountId: string; owner: string; repo: string }
	| { type: "reddit_meta"; accountId: string }
	| { type: "reddit_posts"; accountId: string }
	| { type: "reddit_comments"; accountId: string }
	| { type: "twitter_meta"; accountId: string }
	| { type: "twitter_tweets"; accountId: string }
	| { type: "raw"; platform: string; accountId: string };

export const parseStoreId = (storeId: string): Result<ParsedStoreId, ParseError> => {
	const parts = storeId.split("/");
	if (parts[0] !== STORAGE_PREFIX) return errors.parseError(`Invalid store ID prefix: ${storeId}`);

	const [, type, id, subtype, ...rest] = parts;

	if (type === "github" && id && subtype === "meta") return ok({ type: "github_meta", accountId: id });
	if (type === "github" && id && subtype === "commits" && rest[0] && rest[1] && rest[2]) return ok({ type: "github_commits", accountId: id, owner: rest[0], repo: rest[1], branch: rest[2] });
	if (type === "github" && id && subtype === "prs" && rest[0] && rest[1]) return ok({ type: "github_prs", accountId: id, owner: rest[0], repo: rest[1] });
	if (type === "reddit" && id && subtype === "meta") return ok({ type: "reddit_meta", accountId: id });
	if (type === "reddit" && id && subtype === "posts") return ok({ type: "reddit_posts", accountId: id });
	if (type === "reddit" && id && subtype === "comments") return ok({ type: "reddit_comments", accountId: id });
	if (type === "twitter" && id && subtype === "meta") return ok({ type: "twitter_meta", accountId: id });
	if (type === "twitter" && id && subtype === "tweets") return ok({ type: "twitter_tweets", accountId: id });
	if (type === "raw" && id && subtype) return ok({ type: "raw", platform: id, accountId: subtype });

	return errors.parseError(`Invalid store ID format: ${storeId}`);
};

export const rawStoreId = STORE_PATTERNS.raw;
export const timelineStoreId = STORE_PATTERNS.timeline;
export const githubMetaStoreId = STORE_PATTERNS.githubMeta;
export const githubCommitsStoreId = STORE_PATTERNS.githubCommits;
export const githubPRsStoreId = STORE_PATTERNS.githubPRs;
export const redditMetaStoreId = STORE_PATTERNS.redditMeta;
export const redditPostsStoreId = STORE_PATTERNS.redditPosts;
export const redditCommentsStoreId = STORE_PATTERNS.redditComments;
export const twitterMetaStoreId = STORE_PATTERNS.twitterMeta;
export const twitterTweetsStoreId = STORE_PATTERNS.twitterTweets;

export const RawDataSchema = z.union([GitHubRawSchema, BlueskyRawSchema, YouTubeRawSchema, DevpadRawSchema]);
export const TimelineDataSchema = TimelineSchema;

export type RawData = z.infer<typeof RawDataSchema>;
export type TimelineData = z.infer<typeof TimelineDataSchema>;

export type RawStore = { store: Store<RawData>; id: RawStoreId };
export type TimelineStore = { store: Store<TimelineData>; id: TimelineStoreId };
export type GitHubMetaStoreResult = { store: Store<GitHubMetaStore>; id: GitHubMetaStoreId };
export type GitHubCommitsStoreResult = { store: Store<GitHubRepoCommitsStore>; id: GitHubCommitsStoreId };
export type GitHubPRsStoreResult = { store: Store<GitHubRepoPRsStore>; id: GitHubPRsStoreId };
export type RedditMetaStoreResult = { store: Store<RedditMetaStore>; id: RedditMetaStoreId };
export type RedditPostsStoreResult = { store: Store<RedditPostsStore>; id: RedditPostsStoreId };
export type RedditCommentsStoreResult = { store: Store<RedditCommentsStore>; id: RedditCommentsStoreId };
export type TwitterMetaStoreResult = { store: Store<TwitterMetaStore>; id: TwitterMetaStoreId };
export type TwitterTweetsStoreResult = { store: Store<TwitterTweetsStore>; id: TwitterTweetsStoreId };

export type StoreType = "raw" | "timeline" | "github_meta" | "github_commits" | "github_prs" | "reddit_meta" | "reddit_posts" | "reddit_comments" | "twitter_meta" | "twitter_tweets";

export function createStore(backend: Backend, type: "raw", platform: string, accountId: string): Result<RawStore, CorpusError>;
export function createStore(backend: Backend, type: "timeline", userId: string): Result<TimelineStore, CorpusError>;
export function createStore(backend: Backend, type: "github_meta", accountId: string): Result<GitHubMetaStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "github_commits", accountId: string, owner: string, repo: string): Result<GitHubCommitsStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "github_prs", accountId: string, owner: string, repo: string): Result<GitHubPRsStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "reddit_meta", accountId: string): Result<RedditMetaStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "reddit_posts", accountId: string): Result<RedditPostsStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "reddit_comments", accountId: string): Result<RedditCommentsStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "twitter_meta", accountId: string): Result<TwitterMetaStoreResult, CorpusError>;
export function createStore(backend: Backend, type: "twitter_tweets", accountId: string): Result<TwitterTweetsStoreResult, CorpusError>;
export function createStore(backend: Backend, type: StoreType, arg0?: string, arg1?: string, arg2?: string): Result<unknown, CorpusError> {
	const a0 = arg0 ?? "";
	const a1 = arg1 ?? "";
	const a2 = arg2 ?? "";
	switch (type) {
		case "raw":
			return createTypedStore(backend, rawStoreId(a0, a1), RawDataSchema);
		case "timeline":
			return createTypedStore(backend, timelineStoreId(a0), TimelineDataSchema);
		case "github_meta":
			return createTypedStore(backend, githubMetaStoreId(a0), GitHubMetaStoreSchema);
		case "github_commits":
			return createTypedStore(backend, githubCommitsStoreId(a0, a1, a2), GitHubRepoCommitsStoreSchema);
		case "github_prs":
			return createTypedStore(backend, githubPRsStoreId(a0, a1, a2), GitHubRepoPRsStoreSchema);
		case "reddit_meta":
			return createTypedStore(backend, redditMetaStoreId(a0), RedditMetaStoreSchema);
		case "reddit_posts":
			return createTypedStore(backend, redditPostsStoreId(a0), RedditPostsStoreSchema);
		case "reddit_comments":
			return createTypedStore(backend, redditCommentsStoreId(a0), RedditCommentsStoreSchema);
		case "twitter_meta":
			return createTypedStore(backend, twitterMetaStoreId(a0), TwitterMetaStoreSchema);
		case "twitter_tweets":
			return createTypedStore(backend, twitterTweetsStoreId(a0), TwitterTweetsStoreSchema);
	}
}

/** @deprecated Use createStore(backend, 'raw', platform, accountId) instead */
export const createRawStore = (backend: Backend, platform: string, accountId: string) => createTypedStore(backend, rawStoreId(platform, accountId), RawDataSchema);
/** @deprecated Use createStore(backend, 'timeline', userId) instead */
export const createTimelineStore = (backend: Backend, userId: string) => createTypedStore(backend, timelineStoreId(userId), TimelineDataSchema);
/** @deprecated Use createStore(backend, 'github_meta', accountId) instead */
export const createGitHubMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, githubMetaStoreId(accountId), GitHubMetaStoreSchema);
/** @deprecated Use createStore(backend, 'github_commits', accountId, owner, repo) instead */
export const createGitHubCommitsStore = (backend: Backend, accountId: string, owner: string, repo: string) => createTypedStore(backend, githubCommitsStoreId(accountId, owner, repo), GitHubRepoCommitsStoreSchema);
/** @deprecated Use createStore(backend, 'github_prs', accountId, owner, repo) instead */
export const createGitHubPRsStore = (backend: Backend, accountId: string, owner: string, repo: string) => createTypedStore(backend, githubPRsStoreId(accountId, owner, repo), GitHubRepoPRsStoreSchema);
/** @deprecated Use createStore(backend, 'reddit_meta', accountId) instead */
export const createRedditMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditMetaStoreId(accountId), RedditMetaStoreSchema);
/** @deprecated Use createStore(backend, 'reddit_posts', accountId) instead */
export const createRedditPostsStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditPostsStoreId(accountId), RedditPostsStoreSchema);
/** @deprecated Use createStore(backend, 'reddit_comments', accountId) instead */
export const createRedditCommentsStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditCommentsStoreId(accountId), RedditCommentsStoreSchema);
/** @deprecated Use createStore(backend, 'twitter_meta', accountId) instead */
export const createTwitterMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, twitterMetaStoreId(accountId), TwitterMetaStoreSchema);
/** @deprecated Use createStore(backend, 'twitter_tweets', accountId) instead */
export const createTwitterTweetsStore = (backend: Backend, accountId: string) => createTypedStore(backend, twitterTweetsStoreId(accountId), TwitterTweetsStoreSchema);

export const listTwitterStoreIds = (accountId: string): string[] => [twitterMetaStoreId(accountId), twitterTweetsStoreId(accountId)];
export const listRedditStoreIds = (accountId: string): string[] => [redditMetaStoreId(accountId), redditPostsStoreId(accountId), redditCommentsStoreId(accountId)];

export type RepoStoreInfo = { owner: string; repo: string; storeId: string };

export async function listGitHubCommitStores(backend: Backend, accountId: string): Promise<RepoStoreInfo[]> {
	const metaResult = createGitHubMetaStore(backend, accountId);
	if (!metaResult.ok) return [];

	const latestResult = await metaResult.value.store.get_latest();
	if (!latestResult.ok) return [];

	return latestResult.value.data.repositories.map((repo: { owner: string; name: string }) => ({
		owner: repo.owner,
		repo: repo.name,
		storeId: githubCommitsStoreId(accountId, repo.owner, repo.name),
	}));
}

export async function listGitHubPRStores(backend: Backend, accountId: string): Promise<RepoStoreInfo[]> {
	const metaResult = createGitHubMetaStore(backend, accountId);
	if (!metaResult.ok) return [];

	const latestResult = await metaResult.value.store.get_latest();
	if (!latestResult.ok) return [];

	return latestResult.value.data.repositories.map((repo: { owner: string; name: string }) => ({
		owner: repo.owner,
		repo: repo.name,
		storeId: githubPRsStoreId(accountId, repo.owner, repo.name),
	}));
}

export { type RateLimitState, initialState, isCircuitOpen, shouldFetch, updateOnSuccess, updateOnFailure } from "./rate-limits";
