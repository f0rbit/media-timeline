#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import type { Backend } from "@f0rbit/corpus";
import { create_file_backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "../src/auth";
import type { Database as DrizzleDB } from "../src/db";
import { type ProviderFactory, defaultProviderFactory } from "../src/platforms";
import { authRoutes, connectionRoutes, timelineRoutes, profileRoutes } from "../src/routes";
import * as schema from "../src/schema/database";
import { hash_api_key } from "../src/utils";

type AppContext = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
};

const ENCRYPTION_KEY = "dev-encryption-key-32-bytes-ok!";
const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = `mt_dev_${Buffer.from(MOCK_USER_ID).toString("base64").slice(0, 24)}`;

/**
 * Run Drizzle migrations from the migrations folder
 */
function runMigrations(sqliteDb: Database) {
	// Create migrations tracking table
	sqliteDb.exec(`
		CREATE TABLE IF NOT EXISTS __drizzle_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
	`);

	// Get applied migrations
	const applied = new Set((sqliteDb.query("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[]).map(row => row.hash));

	// Read and apply pending migrations
	const migrationsDir = "./migrations";
	const migrationFiles = readdirSync(migrationsDir)
		.filter(f => f.endsWith(".sql"))
		.sort();

	for (const file of migrationFiles) {
		const hash = file.replace(".sql", "");
		if (applied.has(hash)) continue;

		console.log(`   Applying migration: ${file}`);
		const sql = readFileSync(`${migrationsDir}/${file}`, "utf-8");

		// Split by statement breakpoint and execute each statement
		const statements = sql
			.split("--> statement-breakpoint")
			.map(s => s.trim())
			.filter(Boolean);
		for (const statement of statements) {
			sqliteDb.exec(statement);
		}

		// Record migration
		sqliteDb.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hash}', ${Date.now()})`);
	}
}

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

async function startDevServer() {
	console.log("\n🚀 Starting Media Timeline Dev Server (file-based)\n");

	mkdirSync("local/corpus", { recursive: true });

	const sqliteDb = new Database("local/dev.db");

	console.log("📋 Running Drizzle migrations...");
	runMigrations(sqliteDb);
	console.log("✅ Migrations complete\n");

	const db = drizzle(sqliteDb, { schema });
	const dbWithBatch = Object.assign(db, {
		batch: async <T extends readonly unknown[]>(queries: T): Promise<T> => {
			for (const query of queries) {
				await query;
			}
			return queries;
		},
	});

	const backend = create_file_backend({ base_path: "./local/corpus" });

	const appContext: AppContext = {
		db: dbWithBatch as unknown as AppContext["db"],
		backend: backend as unknown as AppContext["backend"],
		providerFactory: defaultProviderFactory,
		encryptionKey: ENCRYPTION_KEY,
	};

	const existingUser = db.select().from(schema.users).where(eq(schema.users.id, MOCK_USER_ID)).get();
	if (!existingUser) {
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

		const keyHash = await hash_api_key(MOCK_API_KEY);
		db.insert(schema.apiKeys)
			.values({
				id: crypto.randomUUID(),
				user_id: MOCK_USER_ID,
				key_hash: keyHash,
				name: "dev-key",
				created_at: now,
			})
			.run();

		console.log("👤 Mock user created:");
		console.log(`   User ID:  ${MOCK_USER_ID}`);
		console.log(`   API Key:  ${MOCK_API_KEY}`);
	} else {
		console.log("👤 Using existing dev user:");
		console.log(`   User ID:  ${MOCK_USER_ID}`);
		console.log(`   API Key:  ${MOCK_API_KEY}`);
	}

	const app = new Hono<{ Variables: Variables }>();

	app.use(
		"*",
		cors({
			origin: ["http://localhost:4321", "http://localhost:3000"],
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		})
	);

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	// Set up mock env bindings for routes that need them (like OAuth)
	app.use("/api/*", async (c, next) => {
		// biome-ignore lint: env bindings for dev server
		(c as any).env = {
			REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || "",
			REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET || "",
			TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID || "",
			TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET || "",
			APP_URL: "http://localhost:8787",
			FRONTEND_URL: "http://localhost:4321",
			EncryptionKey: ENCRYPTION_KEY,
		};
		c.set("appContext", appContext);
		await next();
	});

	// Auth middleware - skip for /api/auth/* (OAuth routes handle their own auth)
	app.use("/api/*", async (c, next) => {
		if (c.req.path.startsWith("/api/auth")) {
			console.log(`[dev-server] Skipping auth for OAuth route: ${c.req.path}`);
			return next();
		}
		// biome-ignore lint: type cast needed for dev server compatibility
		return authMiddleware(c as any, next);
	});

	// Routes
	app.route("/api/auth", authRoutes);
	app.route("/api/v1/timeline", timelineRoutes);
	app.route("/api/v1/connections", connectionRoutes);
	app.route("/api/v1/profiles", profileRoutes);

	app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

	app.onError((err, c) => {
		console.error("Unhandled error:", err);
		return c.json({ error: "Internal server error", message: err.message }, 500);
	});

	const port = 8787;

	console.log("");
	console.log("📦 SQLite database at local/dev.db");
	console.log("📦 Corpus storage at local/corpus/");
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
