import { type Backend, type Parser, type Store, create_corpus, define_store, json_codec } from "@f0rbit/corpus";
import { z } from "zod";
import {
	BlueskyRawSchema,
	DevpadRawSchema,
	type GitHubMetaStore,
	GitHubMetaStoreSchema,
	GitHubRawSchema,
	type GitHubRepoCommitsStore,
	GitHubRepoCommitsStoreSchema,
	type GitHubRepoPRsStore,
	GitHubRepoPRsStoreSchema,
	type RedditCommentsStore,
	RedditCommentsStoreSchema,
	type RedditMetaStore,
	RedditMetaStoreSchema,
	type RedditPostsStore,
	RedditPostsStoreSchema,
	TimelineSchema,
	type TwitterMetaStore,
	TwitterMetaStoreSchema,
	type TwitterTweetsStore,
	TwitterTweetsStoreSchema,
	YouTubeRawSchema,
} from "./schema";
import { type Result, err, ok } from "./utils";

const STORAGE_PREFIX = "media";

export type CorpusError = { kind: "store_not_found"; store_id: string };

const createTypedStore = <TData, TId extends string>(backend: Backend, id: TId, schema: Parser<TData>): Result<{ store: Store<TData>; id: TId }, CorpusError> => {
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(schema)))
		.build();
	const store = corpus.stores[id];
	if (!store) return err({ kind: "store_not_found", store_id: id });
	return ok({ store, id });
};

export type RawStoreId = `${typeof STORAGE_PREFIX}/raw/${string}/${string}`;
export type TimelineStoreId = `${typeof STORAGE_PREFIX}/timeline/${string}`;
export type GitHubMetaStoreId = `${typeof STORAGE_PREFIX}/github/${string}/meta`;
export type GitHubCommitsStoreId = `${typeof STORAGE_PREFIX}/github/${string}/commits/${string}/${string}`;
export type GitHubPRsStoreId = `${typeof STORAGE_PREFIX}/github/${string}/prs/${string}/${string}`;

// Reddit store IDs
export type RedditMetaStoreId = `${typeof STORAGE_PREFIX}/reddit/${string}/meta`;
export type RedditPostsStoreId = `${typeof STORAGE_PREFIX}/reddit/${string}/posts`;
export type RedditCommentsStoreId = `${typeof STORAGE_PREFIX}/reddit/${string}/comments`;

// Twitter store IDs
export type TwitterMetaStoreId = `${typeof STORAGE_PREFIX}/twitter/${string}/meta`;
export type TwitterTweetsStoreId = `${typeof STORAGE_PREFIX}/twitter/${string}/tweets`;

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

export const parseStoreId = (storeId: string): Result<ParsedStoreId, { kind: "invalid_store_id"; storeId: string }> => {
	const parts = storeId.split("/");

	// Check for media prefix
	if (parts[0] !== STORAGE_PREFIX) {
		return err({ kind: "invalid_store_id", storeId });
	}

	// media/github/{accountId}/meta
	if (parts[1] === "github" && parts[3] === "meta" && parts[2]) {
		return ok({ type: "github_meta", accountId: parts[2] });
	}

	// media/github/{accountId}/commits/{owner}/{repo}/{branch}
	if (parts[1] === "github" && parts[3] === "commits" && parts[2] && parts[4] && parts[5] && parts[6]) {
		return ok({ type: "github_commits", accountId: parts[2], owner: parts[4], repo: parts[5], branch: parts[6] });
	}

	// media/github/{accountId}/prs/{owner}/{repo}
	if (parts[1] === "github" && parts[3] === "prs" && parts[2] && parts[4] && parts[5]) {
		return ok({ type: "github_prs", accountId: parts[2], owner: parts[4], repo: parts[5] });
	}

	// media/reddit/{accountId}/meta
	if (parts[1] === "reddit" && parts[3] === "meta" && parts[2]) {
		return ok({ type: "reddit_meta", accountId: parts[2] });
	}

	// media/reddit/{accountId}/posts
	if (parts[1] === "reddit" && parts[3] === "posts" && parts[2]) {
		return ok({ type: "reddit_posts", accountId: parts[2] });
	}

	// media/reddit/{accountId}/comments
	if (parts[1] === "reddit" && parts[3] === "comments" && parts[2]) {
		return ok({ type: "reddit_comments", accountId: parts[2] });
	}

	// media/twitter/{accountId}/meta
	if (parts[1] === "twitter" && parts[3] === "meta" && parts[2]) {
		return ok({ type: "twitter_meta", accountId: parts[2] });
	}

	// media/twitter/{accountId}/tweets
	if (parts[1] === "twitter" && parts[3] === "tweets" && parts[2]) {
		return ok({ type: "twitter_tweets", accountId: parts[2] });
	}

	// media/raw/{platform}/{accountId}
	if (parts[1] === "raw" && parts[2] && parts[3]) {
		return ok({ type: "raw", platform: parts[2], accountId: parts[3] });
	}

	return err({ kind: "invalid_store_id", storeId });
};

export const rawStoreId = (platform: string, accountId: string): RawStoreId => `${STORAGE_PREFIX}/raw/${platform}/${accountId}`;
export const timelineStoreId = (userId: string): TimelineStoreId => `${STORAGE_PREFIX}/timeline/${userId}`;

// === GitHub Store ID Helpers ===

export const githubMetaStoreId = (accountId: string): GitHubMetaStoreId => `${STORAGE_PREFIX}/github/${accountId}/meta`;

export const githubCommitsStoreId = (accountId: string, owner: string, repo: string): GitHubCommitsStoreId => `${STORAGE_PREFIX}/github/${accountId}/commits/${owner}/${repo}`;

export const githubPRsStoreId = (accountId: string, owner: string, repo: string): GitHubPRsStoreId => `${STORAGE_PREFIX}/github/${accountId}/prs/${owner}/${repo}`;

// === Reddit Store ID Helpers ===

export const redditMetaStoreId = (accountId: string): RedditMetaStoreId => `${STORAGE_PREFIX}/reddit/${accountId}/meta`;

export const redditPostsStoreId = (accountId: string): RedditPostsStoreId => `${STORAGE_PREFIX}/reddit/${accountId}/posts`;

export const redditCommentsStoreId = (accountId: string): RedditCommentsStoreId => `${STORAGE_PREFIX}/reddit/${accountId}/comments`;

// === Twitter Store ID Helpers ===

export const twitterMetaStoreId = (accountId: string): TwitterMetaStoreId => `${STORAGE_PREFIX}/twitter/${accountId}/meta`;

export const twitterTweetsStoreId = (accountId: string): TwitterTweetsStoreId => `${STORAGE_PREFIX}/twitter/${accountId}/tweets`;

export const RawDataSchema = z.union([GitHubRawSchema, BlueskyRawSchema, YouTubeRawSchema, DevpadRawSchema]);
export const TimelineDataSchema = TimelineSchema;

export type RawData = z.infer<typeof RawDataSchema>;
export type TimelineData = z.infer<typeof TimelineDataSchema>;

export type RawStore = { store: Store<RawData>; id: RawStoreId };
export type TimelineStore = { store: Store<TimelineData>; id: TimelineStoreId };

export const createRawStore = (backend: Backend, platform: string, accountId: string) => createTypedStore(backend, rawStoreId(platform, accountId), RawDataSchema);

export const createTimelineStore = (backend: Backend, userId: string) => createTypedStore(backend, timelineStoreId(userId), TimelineDataSchema);

export type GitHubMetaStoreResult = { store: Store<GitHubMetaStore>; id: GitHubMetaStoreId };
export type GitHubCommitsStoreResult = { store: Store<GitHubRepoCommitsStore>; id: GitHubCommitsStoreId };
export type GitHubPRsStoreResult = { store: Store<GitHubRepoPRsStore>; id: GitHubPRsStoreId };

export const createGitHubMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, githubMetaStoreId(accountId), GitHubMetaStoreSchema);

export const createGitHubCommitsStore = (backend: Backend, accountId: string, owner: string, repo: string) => createTypedStore(backend, githubCommitsStoreId(accountId, owner, repo), GitHubRepoCommitsStoreSchema);

export const createGitHubPRsStore = (backend: Backend, accountId: string, owner: string, repo: string) => createTypedStore(backend, githubPRsStoreId(accountId, owner, repo), GitHubRepoPRsStoreSchema);

// === Reddit Store Types ===

export type RedditMetaStoreResult = { store: Store<RedditMetaStore>; id: RedditMetaStoreId };
export type RedditPostsStoreResult = { store: Store<RedditPostsStore>; id: RedditPostsStoreId };
export type RedditCommentsStoreResult = { store: Store<RedditCommentsStore>; id: RedditCommentsStoreId };

export const createRedditMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditMetaStoreId(accountId), RedditMetaStoreSchema);

export const createRedditPostsStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditPostsStoreId(accountId), RedditPostsStoreSchema);

export const createRedditCommentsStore = (backend: Backend, accountId: string) => createTypedStore(backend, redditCommentsStoreId(accountId), RedditCommentsStoreSchema);

// === Twitter Store Types ===

export type TwitterMetaStoreResult = { store: Store<TwitterMetaStore>; id: TwitterMetaStoreId };
export type TwitterTweetsStoreResult = { store: Store<TwitterTweetsStore>; id: TwitterTweetsStoreId };

export const createTwitterMetaStore = (backend: Backend, accountId: string) => createTypedStore(backend, twitterMetaStoreId(accountId), TwitterMetaStoreSchema);

export const createTwitterTweetsStore = (backend: Backend, accountId: string) => createTypedStore(backend, twitterTweetsStoreId(accountId), TwitterTweetsStoreSchema);

// === Twitter Store ID Listing ===

export function listTwitterStoreIds(accountId: string): string[] {
	return [twitterMetaStoreId(accountId), twitterTweetsStoreId(accountId)];
}

// === Reddit Store ID Listing ===

export function listRedditStoreIds(accountId: string): string[] {
	return [redditMetaStoreId(accountId), redditPostsStoreId(accountId), redditCommentsStoreId(accountId)];
}

// === GitHub Store Discovery ===

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

export type RateLimitState = {
	remaining: number | null;
	limit_total: number | null;
	reset_at: Date | null;
	consecutive_failures: number;
	last_failure_at: Date | null;
	circuit_open_until: Date | null;
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION_MS = 5 * 60 * 1000;

export const initialState = (): RateLimitState => ({
	remaining: null,
	limit_total: null,
	reset_at: null,
	consecutive_failures: 0,
	last_failure_at: null,
	circuit_open_until: null,
});

export const isCircuitOpen = (state: RateLimitState): boolean => {
	if (!state.circuit_open_until) return false;
	return new Date() < state.circuit_open_until;
};

const isRateLimited = (state: RateLimitState): boolean => {
	if (state.remaining === null) return false;
	if (state.remaining > 0) return false;
	if (!state.reset_at) return false;
	return new Date() < state.reset_at;
};

export const shouldFetch = (state: RateLimitState): boolean => {
	if (isCircuitOpen(state)) return false;
	if (isRateLimited(state)) return false;
	return true;
};

const parseHeader = (headers: Headers, name: string): number | null => {
	const value = headers.get(name);
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
};

const parseResetHeader = (headers: Headers): Date | null => {
	const resetTimestamp = parseHeader(headers, "X-RateLimit-Reset");
	if (!resetTimestamp) return null;
	return new Date(resetTimestamp * 1000);
};

export const updateOnSuccess = (_state: RateLimitState, headers: Headers): RateLimitState => ({
	remaining: parseHeader(headers, "X-RateLimit-Remaining"),
	limit_total: parseHeader(headers, "X-RateLimit-Limit"),
	reset_at: parseResetHeader(headers),
	consecutive_failures: 0,
	last_failure_at: null,
	circuit_open_until: null,
});

export const updateOnFailure = (state: RateLimitState, retryAfter?: number): RateLimitState => {
	const now = new Date();
	const failures = state.consecutive_failures + 1;
	const shouldOpenCircuit = failures >= CIRCUIT_BREAKER_THRESHOLD;

	const circuitOpenUntil = shouldOpenCircuit ? new Date(now.getTime() + CIRCUIT_OPEN_DURATION_MS) : state.circuit_open_until;
	const resetAt = retryAfter ? new Date(now.getTime() + retryAfter * 1000) : state.reset_at;

	return {
		...state,
		remaining: retryAfter ? 0 : state.remaining,
		reset_at: resetAt,
		consecutive_failures: failures,
		last_failure_at: now,
		circuit_open_until: circuitOpenUntil,
	};
};
