import { Database } from "bun:sqlite";
import { type Backend, type Store, create_corpus, create_memory_backend, define_store, json_codec } from "@f0rbit/corpus";
import type { Platform } from "@media/schema";
import * as schema from "@media/schema/database";
import { connectionRoutes, profileRoutes, timelineRoutes } from "@media/server";
import type { ProviderFactory } from "@media/server/cron";
import type { AppContext } from "@media/server/infrastructure";
import { BlueskyMemoryProvider, DevpadMemoryProvider, GitHubMemoryProvider, RedditMemoryProvider, TwitterMemoryProvider, YouTubeMemoryProvider } from "@media/server/platforms";
import { credentialRoutes } from "@media/server/routes";
import { encrypt, err, hash_api_key, ok, unwrap, unwrap_err, uuid } from "@media/server/utils";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { z } from "zod";
import { ACCOUNTS, PROFILES } from "./fixtures";

export { hash_api_key };
export type { Platform };

const RawDataSchema = z.record(z.unknown());
const TimelineDataSchema = z.record(z.unknown());
const GitHubMetaStoreSchema = z.record(z.unknown());

export type UserSeed = {
	id: string;
	email?: string;
	name?: string;
};

export type AccountSeed = {
	id: string;
	platform: Platform;
	platform_user_id?: string;
	platform_username?: string;
	access_token: string;
	refresh_token?: string;
	is_active?: boolean;
};

export type RateLimitSeed = {
	remaining?: number | null;
	limit_total?: number | null;
	reset_at?: Date | null;
	consecutive_failures?: number;
	last_failure_at?: Date | null;
	circuit_open_until?: Date | null;
};

export type ProfileSeed = {
	id: string;
	slug: string;
	name: string;
	description?: string;
	theme?: string;
};

export type TestProviders = {
	github: GitHubMemoryProvider;
	bluesky: BlueskyMemoryProvider;
	youtube: YouTubeMemoryProvider;
	devpad: DevpadMemoryProvider;
	reddit: RedditMemoryProvider;
	twitter: TwitterMemoryProvider;
};

export type R2Object = {
	key: string;
	body: ReadableStream<Uint8Array>;
	arrayBuffer(): Promise<ArrayBuffer>;
};

export type R2Bucket = {
	get(key: string): Promise<R2Object | null>;
	put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<void>;
	delete(key: string): Promise<void>;
	head(key: string): Promise<{ key: string } | null>;
	list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
};

export type TestEnv = {
	ENCRYPTION_KEY: string;
	ENVIRONMENT: string;
};

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

// Drizzle database type for tests
type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export type TestContext = {
	db: Database;
	drizzle: DrizzleDB;
	r2: R2Bucket;
	providers: TestProviders;
	env: TestEnv;
	corpus: TestCorpus;
	appContext: AppContext;
	cleanup(): void;
};

const ENCRYPTION_KEY = "test-encryption-key-32-bytes-long!";

export const encryptToken = async (plaintext: string, key: string = ENCRYPTION_KEY): Promise<string> => {
	return unwrap(await encrypt(plaintext, key));
};

const createMemoryR2 = (): R2Bucket => {
	const storage = new Map<string, ArrayBuffer>();

	return {
		async get(key: string): Promise<R2Object | null> {
			const data = storage.get(key);
			if (!data) return null;
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(data));
					controller.close();
				},
			});
			return {
				key,
				body,
				async arrayBuffer() {
					return data;
				},
			};
		},
		async put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<void> {
			if (value instanceof ArrayBuffer) {
				storage.set(key, value);
			} else if (value instanceof Uint8Array) {
				storage.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
			} else if (typeof value === "string") {
				storage.set(key, new TextEncoder().encode(value).buffer as ArrayBuffer);
			} else {
				const reader = value.getReader();
				const chunks: Uint8Array[] = [];
				let done = false;
				while (!done) {
					const result = await reader.read();
					done = result.done;
					if (result.value) chunks.push(result.value);
				}
				const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
				const combined = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					combined.set(chunk, offset);
					offset += chunk.length;
				}
				storage.set(key, combined.buffer as ArrayBuffer);
			}
		},
		async delete(key: string): Promise<void> {
			storage.delete(key);
		},
		async head(key: string): Promise<{ key: string } | null> {
			return storage.has(key) ? { key } : null;
		},
		async list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }> {
			const prefix = options?.prefix ?? "";
			const objects = Array.from(storage.keys())
				.filter(k => k.startsWith(prefix))
				.map(key => ({ key }));
			return { objects };
		},
	};
};

const createTestProviders = (): TestProviders => ({
	github: new GitHubMemoryProvider({}),
	bluesky: new BlueskyMemoryProvider({}),
	youtube: new YouTubeMemoryProvider({}),
	devpad: new DevpadMemoryProvider({}),
	reddit: new RedditMemoryProvider({}),
	twitter: new TwitterMemoryProvider({}),
});

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

const defaultTestProviderFactory: ProviderFactory = {
	async create(platform, _platformUserId, _token) {
		return err({ kind: "unknown_platform", platform });
	},
};

export const createTestContext = (): TestContext => {
	const db = new Database(":memory:");
	const drizzleDb = drizzle(db, { schema });

	// Run migrations programmatically
	migrate(drizzleDb, { migrationsFolder: "./migrations" });

	const r2 = createMemoryR2();
	const providers = createTestProviders();
	const corpus = createTestCorpus();

	const env: TestEnv = {
		ENCRYPTION_KEY: ENCRYPTION_KEY,
		ENVIRONMENT: "test",
	};

	const dbWithBatch = Object.assign(drizzleDb, {
		batch: async <T extends readonly unknown[]>(queries: T): Promise<T> => {
			for (const query of queries) {
				await query;
			}
			return queries;
		},
	});

	const appContext: AppContext = {
		db: dbWithBatch as unknown as AppContext["db"],
		backend: corpus.backend as unknown as AppContext["backend"],
		providerFactory: defaultTestProviderFactory,
		encryptionKey: ENCRYPTION_KEY,
		gitHubProvider: providers.github,
	};

	const cleanup = () => {
		db.close();
		providers.github.reset();
		providers.bluesky.reset();
		providers.youtube.reset();
		providers.devpad.reset();
		providers.reddit.reset();
		providers.twitter.reset();
	};

	return { db, drizzle: drizzleDb, r2, providers, env, corpus, appContext, cleanup };
};

type TestVariables = {
	auth: { user_id: string; name: string | null; email: string | null; image_url: string | null; jwt_token?: string };
	appContext: AppContext;
};

/**
 * Test auth middleware that validates API keys from local database.
 */
const createTestAuthMiddleware = (ctx: TestContext) => {
	return async (c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void; json: (body: unknown, status?: number) => Response }, next: () => Promise<void>) => {
		const authHeader = c.req.header("Authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			const keyHash = await hash_api_key(token);

			const result = await ctx.drizzle
				.select({
					id: schema.apiKeys.id,
					user_id: schema.apiKeys.user_id,
					name: schema.users.name,
					email: schema.users.email,
				})
				.from(schema.apiKeys)
				.innerJoin(schema.users, sql`${schema.apiKeys.user_id} = ${schema.users.id}`)
				.where(sql`${schema.apiKeys.key_hash} = ${keyHash}`)
				.get();

			if (result) {
				c.set("auth", {
					user_id: result.user_id,
					name: result.name ?? null,
					email: result.email ?? null,
					image_url: null,
				});
				return next();
			}
		}
		return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
	};
};

export const createTestApp = (ctx: TestContext) => {
	const app = new Hono<{ Variables: TestVariables }>();

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	const mediaApp = new Hono<{ Variables: TestVariables }>();

	mediaApp.use("/api/*", async (c, next) => {
		c.set("appContext", ctx.appContext);
		await next();
	});

	mediaApp.use("/api/*", createTestAuthMiddleware(ctx));

	mediaApp.route("/api/v1/timeline", timelineRoutes);
	mediaApp.route("/api/v1/connections", connectionRoutes);
	mediaApp.route("/api/v1/profiles", profileRoutes);
	mediaApp.route("/api/v1/credentials", credentialRoutes);

	app.route("/media", mediaApp);

	app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

	return app;
};

type ProviderDataMap = Record<string, Record<string, unknown>>;

export const createAppContextWithProviders = (ctx: TestContext, providerData: ProviderDataMap): AppContext => ({
	...ctx.appContext,
	providerFactory: {
		async create(platform, _platformUserId, _token) {
			const data = Object.entries(providerData).find(([_accountId, _]) => true)?.[1];
			if (data) return ok(data);
			return err({ kind: "unknown_platform" as const, platform });
		},
	},
});

export const createProviderFactoryFromData = (providerData: ProviderDataMap): ProviderFactory => ({
	async create(_platform, _platformUserId, _token) {
		const data = Object.values(providerData)[0];
		if (data) return ok(data);
		return err({ kind: "unknown_platform" as const, platform: _platform });
	},
});

export const createProviderFactoryByAccountId =
	(providerData: ProviderDataMap): ((accountId: string) => ProviderFactory) =>
	(accountId: string) => ({
		async create(platform, _platformUserId, _token) {
			const data = providerData[accountId];
			if (data) return ok(data);
			return err({ kind: "unknown_platform" as const, platform });
		},
	});

export type ProviderDataByToken = Record<string, Record<string, unknown>>;

export const createProviderFactoryByToken = (dataByToken: ProviderDataByToken): ProviderFactory => ({
	async create(_platform, _platformUserId, token) {
		const data = dataByToken[token];
		if (data) return ok(data);
		return err({ kind: "api_error" as const, status: 404, message: `No mock data for token: ${token.slice(0, 10)}...` });
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

import type { GitHubRaw as LegacyGitHubRaw } from "@media/schema";
import type { GitHubProviderLike } from "@media/server/infrastructure";
import type { GitHubFetchResult } from "@media/server/platforms/github";
import { GITHUB_V2_FIXTURES, makeGitHubFetchResult } from "./fixtures";

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

const now = () => new Date().toISOString();

// Seed functions using drizzle
export const seedUser = async (ctx: TestContext, user: UserSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.users).values({
		id: user.id,
		email: user.email ?? null,
		name: user.name ?? null,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export const seedAccount = async (ctx: TestContext, profileId: string, account: AccountSeed): Promise<void> => {
	const timestamp = now();
	const encryptedAccessToken = await encryptToken(account.access_token, ctx.env.ENCRYPTION_KEY);
	const encryptedRefreshToken = account.refresh_token ? await encryptToken(account.refresh_token, ctx.env.ENCRYPTION_KEY) : null;

	await ctx.drizzle.insert(schema.accounts).values({
		id: account.id,
		profile_id: profileId,
		platform: account.platform,
		platform_user_id: account.platform_user_id ?? null,
		platform_username: account.platform_username ?? null,
		access_token_encrypted: encryptedAccessToken,
		refresh_token_encrypted: encryptedRefreshToken,
		is_active: account.is_active ?? true,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export const seedRateLimit = async (ctx: TestContext, accountId: string, state: RateLimitSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.rateLimits).values({
		id: uuid(),
		account_id: accountId,
		remaining: state.remaining ?? null,
		limit_total: state.limit_total ?? null,
		reset_at: state.reset_at?.toISOString() ?? null,
		consecutive_failures: state.consecutive_failures ?? 0,
		last_failure_at: state.last_failure_at?.toISOString() ?? null,
		circuit_open_until: state.circuit_open_until?.toISOString() ?? null,
		updated_at: timestamp,
	});
};

export const seedApiKey = async (ctx: TestContext, userId: string, keyValue: string, name?: string): Promise<string> => {
	const keyId = uuid();
	const keyHash = await hash_api_key(keyValue);
	const timestamp = now();

	await ctx.drizzle.insert(schema.apiKeys).values({
		id: keyId,
		user_id: userId,
		key_hash: keyHash,
		name: name ?? null,
		created_at: timestamp,
	});

	return keyId;
};

export const seedProfile = async (ctx: TestContext, userId: string, profile: ProfileSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.profiles).values({
		id: profile.id,
		user_id: userId,
		slug: profile.slug,
		name: profile.name,
		description: profile.description ?? null,
		theme: profile.theme ?? null,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export type ProfileFilterSeed = {
	account_id: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

export const seedProfileFilter = async (ctx: TestContext, profileId: string, filter: ProfileFilterSeed): Promise<string> => {
	const timestamp = now();
	const filterId = uuid();
	await ctx.drizzle.insert(schema.profileFilters).values({
		id: filterId,
		profile_id: profileId,
		account_id: filter.account_id,
		filter_type: filter.filter_type,
		filter_key: filter.filter_key,
		filter_value: filter.filter_value,
		created_at: timestamp,
		updated_at: timestamp,
	});
	return filterId;
};

export const getUser = async (ctx: TestContext, userId: string) => {
	return ctx.drizzle.select().from(schema.users).where(sql`${schema.users.id} = ${userId}`).get();
};

export const getAccount = async (ctx: TestContext, accountId: string) => {
	return ctx.drizzle.select().from(schema.accounts).where(sql`${schema.accounts.id} = ${accountId}`).get();
};

// Helper to setup GitHub memory provider with data from legacy fixtures
export const setupGitHubProvider = (ctx: TestContext, data: LegacyGitHubRaw): void => {
	const repoCommits = new Map<string, Array<{ sha?: string; message?: string; date?: string }>>();

	for (const commit of data.commits) {
		const existing = repoCommits.get(commit.repo) ?? [];
		existing.push({ sha: commit.sha, message: commit.message, date: commit.date });
		repoCommits.set(commit.repo, existing);
	}

	const repos = Array.from(repoCommits.entries()).map(([repo, commits]) => ({ repo, commits }));
	const fetchResult = repos.length > 0 ? makeGitHubFetchResult(repos) : makeGitHubFetchResult([]);

	ctx.providers.github.setUsername(fetchResult.meta.username);
	ctx.providers.github.setRepositories(fetchResult.meta.repositories);
	for (const [fullName, data] of fetchResult.repos) {
		ctx.providers.github.setRepoData(fullName, data);
	}
};

export const getRateLimit = async (ctx: TestContext, accountId: string) => {
	return ctx.drizzle.select().from(schema.rateLimits).where(sql`${schema.rateLimits.account_id} = ${accountId}`).get();
};

export const getUserAccounts = async (ctx: TestContext, userId: string) => {
	return ctx.drizzle.select().from(schema.accounts).innerJoin(schema.profiles, sql`${schema.accounts.profile_id} = ${schema.profiles.id}`).where(sql`${schema.profiles.user_id} = ${userId}`).all();
};

export const getProfileAccounts = async (ctx: TestContext, profileId: string) => {
	return ctx.drizzle.select().from(schema.accounts).where(sql`${schema.accounts.profile_id} = ${profileId}`).all();
};

export const seedUserWithProfile = async (ctx: TestContext, user: UserSeed, profile: ProfileSeed): Promise<void> => {
	await seedUser(ctx, user);
	await seedProfile(ctx, user.id, profile);
};

export { unwrap as assertResultOk, unwrap_err as assertResultErr };
