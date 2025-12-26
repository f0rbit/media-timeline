#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { create_memory_backend } from "@f0rbit/corpus";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "../src/auth";
import { connectionRoutes, timelineRoutes } from "../src/routes";
import * as schema from "../src/schema/database";
import { hashApiKey } from "../src/utils";
import type { Database as DrizzleDB } from "../src/db";
import type { Backend } from "@f0rbit/corpus";
import { defaultProviderFactory, type ProviderFactory } from "../src/platforms";

type AppContext = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
};

const ENCRYPTION_KEY = "dev-encryption-key-32-bytes-ok!";
const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = "mt_dev_" + Buffer.from(MOCK_USER_ID).toString("base64").slice(0, 24);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
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

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

async function startDevServer() {
	console.log("\n🚀 Starting Media Timeline Dev Server (in-memory)\n");

	const sqliteDb = new Database(":memory:");
	sqliteDb.exec(SCHEMA);

	const db = drizzle(sqliteDb, { schema });
	const dbWithBatch = Object.assign(db, {
		batch: async <T extends readonly unknown[]>(queries: T): Promise<T> => {
			for (const query of queries) {
				await query;
			}
			return queries;
		},
	});

	const backend = create_memory_backend();

	const appContext: AppContext = {
		db: dbWithBatch as unknown as AppContext["db"],
		backend: backend as unknown as AppContext["backend"],
		providerFactory: defaultProviderFactory,
		encryptionKey: ENCRYPTION_KEY,
	};

	const now = new Date().toISOString();

	db.insert(schema.users)
		.values({
			id: MOCK_USER_ID,
			email: "dev@localhost",
			name: "Dev User",
			created_at: now,
			updated_at: now,
		})
		.run();

	const keyHash = await hashApiKey(MOCK_API_KEY);
	db.insert(schema.apiKeys)
		.values({
			id: crypto.randomUUID(),
			user_id: MOCK_USER_ID,
			key_hash: keyHash,
			name: "dev-key",
			created_at: now,
		})
		.run();

	const app = new Hono<{ Variables: Variables }>();

	app.use(
		"*",
		cors({
			origin: ["http://localhost:4321", "http://localhost:3000"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		})
	);

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	app.use("/api/*", async (c, next) => {
		c.set("appContext", appContext);
		await next();
	});

	app.use("/api/*", authMiddleware);
	app.route("/api/v1/timeline", timelineRoutes);
	app.route("/api/v1/connections", connectionRoutes);

	app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

	app.onError((err, c) => {
		console.error("Unhandled error:", err);
		return c.json({ error: "Internal server error", message: err.message }, 500);
	});

	const port = 8787;

	console.log("📦 In-memory SQLite database initialized");
	console.log("📦 In-memory corpus backend initialized");
	console.log("");
	console.log("👤 Mock user created:");
	console.log(`   User ID:  ${MOCK_USER_ID}`);
	console.log(`   API Key:  ${MOCK_API_KEY}`);
	console.log("");
	console.log(`🌐 Server running at http://localhost:${port}`);
	console.log(`   Health:   http://localhost:${port}/health`);
	console.log("");
	console.log("💡 Use this API key in the UI or set it in your browser console:");
	console.log(`   localStorage.setItem('apiKey', '${MOCK_API_KEY}')`);
	console.log("");

	Bun.serve({
		port,
		fetch: app.fetch,
	});
}

startDevServer().catch(console.error);
