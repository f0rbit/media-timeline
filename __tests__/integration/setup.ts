import { Database, type SQLQueryBindings } from "bun:sqlite";
import { type Backend, type Store, create_corpus, create_memory_backend, define_store, json_codec } from "@f0rbit/corpus";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../../src/auth";
import type { ProviderFactory } from "../../src/cron";
import type { AppContext } from "../../src/infrastructure";
import { BlueskyMemoryProvider, DevpadMemoryProvider, GitHubMemoryProvider, RedditMemoryProvider, TwitterMemoryProvider, YouTubeMemoryProvider } from "../../src/platforms";
import { connectionRoutes, timelineRoutes } from "../../src/routes";
import type { Platform } from "../../src/schema";
import * as schema from "../../src/schema/database";
import { encrypt, err, hash_api_key, ok, unwrap, unwrap_err, uuid } from "../../src/utils";
import { ACCOUNTS } from "./fixtures";

// Note: apiKeys used by seedApiKey comes from schema via the drizzle instance

export { hash_api_key };
export type { Platform };

const RawDataSchema = z.record(z.unknown());
const TimelineDataSchema = z.record(z.unknown());
const GitHubMetaStoreSchema = z.record(z.unknown());
export type MemberRole = "owner" | "member";

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

export type TestProviders = {
	github: GitHubMemoryProvider;
	bluesky: BlueskyMemoryProvider;
	youtube: YouTubeMemoryProvider;
	devpad: DevpadMemoryProvider;
	reddit: RedditMemoryProvider;
	twitter: TwitterMemoryProvider;
};

export type D1PreparedStatement = {
	bind(...params: unknown[]): D1PreparedStatement;
	first<T = unknown>(column?: string): Promise<T | null>;
	all<T = unknown>(): Promise<{ results: T[] }>;
	run(): Promise<{ success: boolean; changes: number }>;
};

export type D1Database = {
	prepare(query: string): D1PreparedStatement;
	batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
	exec(query: string): Promise<void>;
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
	DB: D1Database;
	BUCKET: R2Bucket;
	EncryptionKey: string;
	ENVIRONMENT: string;
};

export type TestCorpus = {
	backend: Backend;
	createRawStore(platform: Platform, accountId: string): Store<Record<string, unknown>>;
	createTimelineStore(userId: string): Store<Record<string, unknown>>;
	createGitHubMetaStore(accountId: string): Store<Record<string, unknown>>;
};

export type TestContext = {
	db: Database;
	d1: D1Database;
	r2: R2Bucket;
	providers: TestProviders;
	env: TestEnv;
	corpus: TestCorpus;
	appContext: AppContext;
	cleanup(): void;
};

const ENCRYPTION_KEY = "test-encryption-key-32-bytes-long!";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    devpad_user_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_user_id TEXT,
    platform_username TEXT,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expires_at TEXT,
    is_active INTEGER DEFAULT 1,
    last_fetched_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_platform_user ON accounts(platform, platform_user_id);

  CREATE TABLE IF NOT EXISTS account_members (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_account_members_account ON account_members(account_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    last_used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  CREATE TABLE IF NOT EXISTS rate_limits (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    remaining INTEGER,
    limit_total INTEGER,
    reset_at TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    last_failure_at TEXT,
    circuit_open_until TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id)
  );

  CREATE TABLE IF NOT EXISTS account_settings (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_account_settings_unique ON account_settings(account_id, setting_key);
  CREATE INDEX IF NOT EXISTS idx_account_settings_account ON account_settings(account_id);

  CREATE TABLE IF NOT EXISTS corpus_snapshots (
    store_id TEXT NOT NULL,
    version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    tags TEXT,
    metadata TEXT,
    PRIMARY KEY (store_id, version)
  );

  CREATE INDEX IF NOT EXISTS idx_corpus_snapshots_store ON corpus_snapshots(store_id);
  CREATE INDEX IF NOT EXISTS idx_corpus_snapshots_created ON corpus_snapshots(store_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS corpus_parents (
    child_store_id TEXT NOT NULL,
    child_version TEXT NOT NULL,
    parent_store_id TEXT NOT NULL,
    parent_version TEXT NOT NULL,
    role TEXT,
    PRIMARY KEY (child_store_id, child_version, parent_store_id, parent_version),
    FOREIGN KEY (child_store_id, child_version) REFERENCES corpus_snapshots(store_id, version),
    FOREIGN KEY (parent_store_id, parent_version) REFERENCES corpus_snapshots(store_id, version)
  );
`;

export const encryptToken = async (plaintext: string, key: string = ENCRYPTION_KEY): Promise<string> => {
	return unwrap(await encrypt(plaintext, key));
};

const createD1FromSqlite = (db: Database): D1Database => {
	const createPreparedStatement = (query: string): D1PreparedStatement => {
		let boundParams: SQLQueryBindings[] = [];

		const statement: D1PreparedStatement = {
			bind(...params: unknown[]): D1PreparedStatement {
				boundParams = params as SQLQueryBindings[];
				return statement;
			},
			async first<T>(column?: string): Promise<T | null> {
				const stmt = db.prepare(query);
				const row = stmt.get(...boundParams) as Record<string, unknown> | null;
				if (!row) return null;
				if (column) return row[column] as T;
				return row as T;
			},
			async all<T>(): Promise<{ results: T[] }> {
				const stmt = db.prepare(query);
				const rows = stmt.all(...boundParams) as T[];
				return { results: rows };
			},
			async run(): Promise<{ success: boolean; changes: number }> {
				const stmt = db.prepare(query);
				const result = stmt.run(...boundParams);
				return { success: true, changes: result.changes };
			},
		};
		return statement;
	};

	return {
		prepare: createPreparedStatement,
		async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
			const results: T[] = [];
			for (const stmt of statements) {
				const result = await stmt.run();
				results.push(result as T);
			}
			return results;
		},
		async exec(query: string): Promise<void> {
			db.exec(query);
		},
	};
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
		const storeId = `raw/${platform}/${accountId}`;
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
		const storeId = `timeline/${userId}`;
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
		const storeId = `github/${accountId}/meta`;
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

	return { backend, createRawStore, createTimelineStore, createGitHubMetaStore };
};

const defaultTestProviderFactory: ProviderFactory = {
	async create(platform, _platformUserId, _token) {
		return err({ kind: "unknown_platform", platform });
	},
};

export const createTestContext = (): TestContext => {
	const db = new Database(":memory:");
	db.exec(SCHEMA);

	const d1 = createD1FromSqlite(db);
	const r2 = createMemoryR2();
	const providers = createTestProviders();
	const corpus = createTestCorpus();

	const env: TestEnv = {
		DB: d1,
		BUCKET: r2,
		EncryptionKey: ENCRYPTION_KEY,
		ENVIRONMENT: "test",
	};

	const drizzleDb = drizzle(db, { schema });

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

	return { db, d1, r2, providers, env, corpus, appContext, cleanup };
};

type TestVariables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

export const createTestApp = (ctx: TestContext) => {
	const app = new Hono<{ Variables: TestVariables }>();

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	app.use("/api/*", async (c, next) => {
		c.set("appContext", ctx.appContext);
		await next();
	});

	// Use real auth middleware - it reads from appContext.db
	app.use("/api/*", authMiddleware);

	app.route("/api/v1/timeline", timelineRoutes);
	app.route("/api/v1/connections", connectionRoutes);

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

import type { GitHubProviderLike } from "../../src/infrastructure";
import type { GitHubFetchResult } from "../../src/platforms/github";
import type { GitHubRaw as LegacyGitHubRaw } from "../../src/schema";
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

export const seedUser = async (ctx: TestContext, user: UserSeed): Promise<void> => {
	const timestamp = now();
	await ctx.d1
		.prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
		.bind(user.id, user.email ?? null, user.name ?? null, timestamp, timestamp)
		.run();
};

export const seedAccount = async (ctx: TestContext, userId: string, account: AccountSeed, role: MemberRole = "owner"): Promise<void> => {
	const timestamp = now();
	const encryptedAccessToken = await encryptToken(account.access_token, ctx.env.EncryptionKey);
	const encryptedRefreshToken = account.refresh_token ? await encryptToken(account.refresh_token, ctx.env.EncryptionKey) : null;

	await ctx.d1
		.prepare(`
      INSERT INTO accounts (
        id, platform, platform_user_id, platform_username,
        access_token_encrypted, refresh_token_encrypted,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
		.bind(account.id, account.platform, account.platform_user_id ?? null, account.platform_username ?? null, encryptedAccessToken, encryptedRefreshToken, (account.is_active ?? true) ? 1 : 0, timestamp, timestamp)
		.run();

	await ctx.d1.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(uuid(), userId, account.id, role, timestamp).run();
};

export const seedRateLimit = async (ctx: TestContext, accountId: string, state: RateLimitSeed): Promise<void> => {
	const timestamp = now();
	await ctx.d1
		.prepare(`
      INSERT INTO rate_limits (
        id, account_id, remaining, limit_total, reset_at,
        consecutive_failures, last_failure_at, circuit_open_until, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
		.bind(
			uuid(),
			accountId,
			state.remaining ?? null,
			state.limit_total ?? null,
			state.reset_at?.toISOString() ?? null,
			state.consecutive_failures ?? 0,
			state.last_failure_at?.toISOString() ?? null,
			state.circuit_open_until?.toISOString() ?? null,
			timestamp
		)
		.run();
};

export const seedApiKey = async (ctx: TestContext, userId: string, keyValue: string, name?: string): Promise<string> => {
	const keyId = uuid();
	const keyHash = await hash_api_key(keyValue);
	const timestamp = now();

	await ctx.d1
		.prepare("INSERT INTO api_keys (id, user_id, key_hash, name, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(keyId, userId, keyHash, name ?? null, timestamp)
		.run();

	return keyId;
};

export const addAccountMember = async (ctx: TestContext, userId: string, accountId: string, role: MemberRole): Promise<void> => {
	const timestamp = now();
	await ctx.d1.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(uuid(), userId, accountId, role, timestamp).run();
};

export const getUser = async (ctx: TestContext, userId: string) => ctx.d1.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();

export const getAccount = async (ctx: TestContext, accountId: string) => ctx.d1.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first();

// Helper to setup GitHub memory provider with data from legacy fixtures
export const setupGitHubProvider = (ctx: TestContext, data: LegacyGitHubRaw): void => {
	// Convert legacy GitHubRaw format to new GitHubFetchResult format
	const repoCommits = new Map<string, Array<{ sha?: string; message?: string; date?: string }>>();

	for (const commit of data.commits) {
		const existing = repoCommits.get(commit.repo) ?? [];
		existing.push({ sha: commit.sha, message: commit.message, date: commit.date });
		repoCommits.set(commit.repo, existing);
	}

	const repos = Array.from(repoCommits.entries()).map(([repo, commits]) => ({ repo, commits }));
	const fetchResult = repos.length > 0 ? makeGitHubFetchResult(repos) : makeGitHubFetchResult([]);

	// Set up the memory provider
	ctx.providers.github.setUsername(fetchResult.meta.username);
	ctx.providers.github.setRepositories(fetchResult.meta.repositories);
	for (const [fullName, data] of fetchResult.repos) {
		ctx.providers.github.setRepoData(fullName, data);
	}
};

export const getAccountMembers = async (ctx: TestContext, accountId: string) => ctx.d1.prepare("SELECT * FROM account_members WHERE account_id = ?").bind(accountId).all();

export const getRateLimit = async (ctx: TestContext, accountId: string) => ctx.d1.prepare("SELECT * FROM rate_limits WHERE account_id = ?").bind(accountId).first();

export const getUserAccounts = async (ctx: TestContext, userId: string) =>
	ctx.d1
		.prepare(`
      SELECT a.*, am.role
      FROM accounts a
      INNER JOIN account_members am ON a.id = am.account_id
      WHERE am.user_id = ?
    `)
		.bind(userId)
		.all();

export { unwrap as assertResultOk, unwrap_err as assertResultErr };
