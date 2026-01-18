import { type Backend, type Store, create_corpus, create_memory_backend, define_store, json_codec } from "@f0rbit/corpus";
import type { Platform } from "@media/schema";
import { z } from "zod";

const RawDataSchema = z.record(z.unknown());
const TimelineDataSchema = z.record(z.unknown());
const GitHubMetaStoreSchema = z.record(z.unknown());

export type TestCorpus = {
	backend: Backend;
	createRawStore(platform: Platform, accountId: string): Store<Record<string, unknown>>;
	createTimelineStore(userId: string): Store<Record<string, unknown>>;
	createGitHubMetaStore(accountId: string): Store<Record<string, unknown>>;
	createGitHubCommitsStore(accountId: string, owner: string, repo: string): Store<Record<string, unknown>>;
	createRedditPostsStore(accountId: string): Store<Record<string, unknown>>;
	createRedditCommentsStore(accountId: string): Store<Record<string, unknown>>;
	createTwitterTweetsStore(accountId: string): Store<Record<string, unknown>>;
};

export const createTestCorpus = (): TestCorpus => {
	const backend = create_memory_backend();
	const stores = new Map<string, Store<Record<string, unknown>>>();

	const createRawStore = (platform: Platform, accountId: string): Store<Record<string, unknown>> => {
		const storeId = `media/raw/${platform}/${accountId}`;
		const existing = stores.get(storeId);
		if (existing) return existing;

		const corpus = create_corpus()
			.with_backend(backend)
			.with_store(define_store(storeId, json_codec(RawDataSchema)))
			.build();

		const store = corpus.stores[storeId];
		if (!store) throw new Error(`Failed to create store: ${storeId}`);
		stores.set(storeId, store);
		return store;
	};

	const createTimelineStore = (userId: string): Store<Record<string, unknown>> => {
		const storeId = `media/timeline/${userId}`;
		const existing = stores.get(storeId);
		if (existing) return existing;

		const corpus = create_corpus()
			.with_backend(backend)
			.with_store(define_store(storeId, json_codec(TimelineDataSchema)))
			.build();

		const store = corpus.stores[storeId];
		if (!store) throw new Error(`Failed to create store: ${storeId}`);
		stores.set(storeId, store);
		return store;
	};

	const createGitHubMetaStore = (accountId: string): Store<Record<string, unknown>> => {
		const storeId = `media/github/${accountId}/meta`;
		const existing = stores.get(storeId);
		if (existing) return existing;

		const corpus = create_corpus()
			.with_backend(backend)
			.with_store(define_store(storeId, json_codec(GitHubMetaStoreSchema)))
			.build();

		const store = corpus.stores[storeId];
		if (!store) throw new Error(`Failed to create store: ${storeId}`);
		stores.set(storeId, store);
		return store;
	};

	const createGenericStore = (storeId: string): Store<Record<string, unknown>> => {
		const existing = stores.get(storeId);
		if (existing) return existing;

		const corpus = create_corpus()
			.with_backend(backend)
			.with_store(define_store(storeId, json_codec(RawDataSchema)))
			.build();

		const store = corpus.stores[storeId];
		if (!store) throw new Error(`Failed to create store: ${storeId}`);
		stores.set(storeId, store);
		return store;
	};

	const createGitHubCommitsStore = (accountId: string, owner: string, repo: string): Store<Record<string, unknown>> => createGenericStore(`media/github/${accountId}/commits/${owner}/${repo}`);

	const createRedditPostsStore = (accountId: string): Store<Record<string, unknown>> => createGenericStore(`media/reddit/${accountId}/posts`);

	const createRedditCommentsStore = (accountId: string): Store<Record<string, unknown>> => createGenericStore(`media/reddit/${accountId}/comments`);

	const createTwitterTweetsStore = (accountId: string): Store<Record<string, unknown>> => createGenericStore(`media/twitter/${accountId}/tweets`);

	return {
		backend,
		createRawStore,
		createTimelineStore,
		createGitHubMetaStore,
		createGitHubCommitsStore,
		createRedditPostsStore,
		createRedditCommentsStore,
		createTwitterTweetsStore,
	};
};
