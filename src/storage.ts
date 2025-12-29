import { type Backend, type Store, create_corpus, define_store, json_codec } from "@f0rbit/corpus";
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
import { type Result, err, ok, pipe } from "./utils";

export type CorpusError = { kind: "store_not_found"; store_id: string };

export type RawStoreId = `raw/${string}/${string}`;
export type TimelineStoreId = `timeline/${string}`;
export type GitHubMetaStoreId = `github/${string}/meta`;
export type GitHubCommitsStoreId = `github/${string}/commits/${string}/${string}`;
export type GitHubPRsStoreId = `github/${string}/prs/${string}/${string}`;

// Reddit store IDs
export type RedditMetaStoreId = `reddit/${string}/meta`;
export type RedditPostsStoreId = `reddit/${string}/posts`;
export type RedditCommentsStoreId = `reddit/${string}/comments`;

// Twitter store IDs
export type TwitterMetaStoreId = `twitter/${string}/meta`;
export type TwitterTweetsStoreId = `twitter/${string}/tweets`;

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

	// github/{accountId}/meta
	if (parts[0] === "github" && parts[2] === "meta" && parts[1]) {
		return ok({ type: "github_meta", accountId: parts[1] });
	}

	// github/{accountId}/commits/{owner}/{repo}/{branch}
	if (parts[0] === "github" && parts[2] === "commits" && parts[1] && parts[3] && parts[4] && parts[5]) {
		return ok({ type: "github_commits", accountId: parts[1], owner: parts[3], repo: parts[4], branch: parts[5] });
	}

	// github/{accountId}/prs/{owner}/{repo}
	if (parts[0] === "github" && parts[2] === "prs" && parts[1] && parts[3] && parts[4]) {
		return ok({ type: "github_prs", accountId: parts[1], owner: parts[3], repo: parts[4] });
	}

	// reddit/{accountId}/meta
	if (parts[0] === "reddit" && parts[2] === "meta" && parts[1]) {
		return ok({ type: "reddit_meta", accountId: parts[1] });
	}

	// reddit/{accountId}/posts
	if (parts[0] === "reddit" && parts[2] === "posts" && parts[1]) {
		return ok({ type: "reddit_posts", accountId: parts[1] });
	}

	// reddit/{accountId}/comments
	if (parts[0] === "reddit" && parts[2] === "comments" && parts[1]) {
		return ok({ type: "reddit_comments", accountId: parts[1] });
	}

	// twitter/{accountId}/meta
	if (parts[0] === "twitter" && parts[2] === "meta" && parts[1]) {
		return ok({ type: "twitter_meta", accountId: parts[1] });
	}

	// twitter/{accountId}/tweets
	if (parts[0] === "twitter" && parts[2] === "tweets" && parts[1]) {
		return ok({ type: "twitter_tweets", accountId: parts[1] });
	}

	// raw/{platform}/{accountId}
	if (parts[0] === "raw" && parts[1] && parts[2]) {
		return ok({ type: "raw", platform: parts[1], accountId: parts[2] });
	}

	return err({ kind: "invalid_store_id", storeId });
};

export const rawStoreId = (platform: string, accountId: string): RawStoreId => `raw/${platform}/${accountId}`;
export const timelineStoreId = (userId: string): TimelineStoreId => `timeline/${userId}`;

// === GitHub Store ID Helpers ===

export const githubMetaStoreId = (accountId: string): GitHubMetaStoreId => `github/${accountId}/meta`;

export const githubCommitsStoreId = (accountId: string, owner: string, repo: string): GitHubCommitsStoreId => `github/${accountId}/commits/${owner}/${repo}`;

export const githubPRsStoreId = (accountId: string, owner: string, repo: string): GitHubPRsStoreId => `github/${accountId}/prs/${owner}/${repo}`;

// === Reddit Store ID Helpers ===

export const redditMetaStoreId = (accountId: string): RedditMetaStoreId => `reddit/${accountId}/meta`;

export const redditPostsStoreId = (accountId: string): RedditPostsStoreId => `reddit/${accountId}/posts`;

export const redditCommentsStoreId = (accountId: string): RedditCommentsStoreId => `reddit/${accountId}/comments`;

// === Twitter Store ID Helpers ===

export const twitterMetaStoreId = (accountId: string): TwitterMetaStoreId => `twitter/${accountId}/meta`;

export const twitterTweetsStoreId = (accountId: string): TwitterTweetsStoreId => `twitter/${accountId}/tweets`;

export const RawDataSchema = z.union([GitHubRawSchema, BlueskyRawSchema, YouTubeRawSchema, DevpadRawSchema]);
export const TimelineDataSchema = TimelineSchema;

export type RawData = z.infer<typeof RawDataSchema>;
export type TimelineData = z.infer<typeof TimelineDataSchema>;

export type RawStore = { store: Store<RawData>; id: RawStoreId };
export type TimelineStore = { store: Store<TimelineData>; id: TimelineStoreId };

export function createRawStore(backend: Backend, platform: string, accountId: string): Result<RawStore, CorpusError> {
	const id = rawStoreId(platform, accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(RawDataSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createTimelineStore(backend: Backend, userId: string): Result<TimelineStore, CorpusError> {
	const id = timelineStoreId(userId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(TimelineDataSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export type GitHubMetaStoreResult = { store: Store<GitHubMetaStore>; id: GitHubMetaStoreId };
export type GitHubCommitsStoreResult = { store: Store<GitHubRepoCommitsStore>; id: GitHubCommitsStoreId };
export type GitHubPRsStoreResult = { store: Store<GitHubRepoPRsStore>; id: GitHubPRsStoreId };

export function createGitHubMetaStore(backend: Backend, accountId: string): Result<GitHubMetaStoreResult, CorpusError> {
	const id = githubMetaStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(GitHubMetaStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createGitHubCommitsStore(backend: Backend, accountId: string, owner: string, repo: string): Result<GitHubCommitsStoreResult, CorpusError> {
	const id = githubCommitsStoreId(accountId, owner, repo);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(GitHubRepoCommitsStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createGitHubPRsStore(backend: Backend, accountId: string, owner: string, repo: string): Result<GitHubPRsStoreResult, CorpusError> {
	const id = githubPRsStoreId(accountId, owner, repo);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(GitHubRepoPRsStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

// === Reddit Store Types ===

export type RedditMetaStoreResult = { store: Store<RedditMetaStore>; id: RedditMetaStoreId };
export type RedditPostsStoreResult = { store: Store<RedditPostsStore>; id: RedditPostsStoreId };
export type RedditCommentsStoreResult = { store: Store<RedditCommentsStore>; id: RedditCommentsStoreId };

// === Reddit Store Creators ===

export function createRedditMetaStore(backend: Backend, accountId: string): Result<RedditMetaStoreResult, CorpusError> {
	const id = redditMetaStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(RedditMetaStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createRedditPostsStore(backend: Backend, accountId: string): Result<RedditPostsStoreResult, CorpusError> {
	const id = redditPostsStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(RedditPostsStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createRedditCommentsStore(backend: Backend, accountId: string): Result<RedditCommentsStoreResult, CorpusError> {
	const id = redditCommentsStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(RedditCommentsStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

// === Twitter Store Types ===

export type TwitterMetaStoreResult = { store: Store<TwitterMetaStore>; id: TwitterMetaStoreId };
export type TwitterTweetsStoreResult = { store: Store<TwitterTweetsStore>; id: TwitterTweetsStoreId };

// === Twitter Store Creators ===

export function createTwitterMetaStore(backend: Backend, accountId: string): Result<TwitterMetaStoreResult, CorpusError> {
	const id = twitterMetaStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(TwitterMetaStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createTwitterTweetsStore(backend: Backend, accountId: string): Result<TwitterTweetsStoreResult, CorpusError> {
	const id = twitterTweetsStoreId(accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(TwitterTweetsStoreSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

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
