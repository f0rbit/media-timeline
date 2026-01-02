#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { Backend } from "@f0rbit/corpus";
import { create_file_backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "../src/auth";
import type { Database as DrizzleDB } from "../src/db";
import { type ProviderFactory, defaultProviderFactory } from "../src/platforms";
import { authRoutes, connectionRoutes, profileRoutes, timelineRoutes } from "../src/routes";
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

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

async function startDevServer() {
	console.log("\n🚀 Starting Media Timeline Dev Server (file-based)\n");

	mkdirSync("local/corpus", { recursive: true });

	const sqliteDb = new Database("local/dev.db");
	const db = drizzle(sqliteDb, { schema });

	console.log("📋 Running Drizzle migrations...");
	migrate(db, { migrationsFolder: "./migrations" });
	console.log("✅ Migrations complete\n");

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

	const mediaApp = new Hono<{ Variables: Variables }>();

	mediaApp.use("/api/*", async (c, next) => {
		// biome-ignore lint: env bindings for dev server
		(c as any).env = {
			REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || "",
			REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET || "",
			TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID || "",
			TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET || "",
			GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "",
			GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "",
			API_URL: "http://localhost:8787",
			FRONTEND_URL: "http://localhost:4321",
			ENCRYPTION_KEY: ENCRYPTION_KEY,
		};
		c.set("appContext", appContext);
		await next();
	});

	mediaApp.use("/api/*", async (c, next) => {
		if (c.req.path.startsWith("/media/api/auth")) {
			console.log(`[dev-server] Skipping auth for OAuth route: ${c.req.path}`);
			return next();
		}
		// biome-ignore lint: type cast needed for dev server compatibility
		return authMiddleware(c as any, next);
	});

	mediaApp.route("/api/auth", authRoutes);
	mediaApp.route("/api/v1/timeline", timelineRoutes);
	mediaApp.route("/api/v1/connections", connectionRoutes);
	mediaApp.route("/api/v1/profiles", profileRoutes);

	app.route("/media", mediaApp);

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
