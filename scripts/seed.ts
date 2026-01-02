#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as schema from "@media/schema/database";
import { hash_api_key } from "@media/server";
import { drizzle } from "drizzle-orm/bun-sqlite";

const LOCAL_DIR = "./local";
const DB_PATH = `${LOCAL_DIR}/sqlite.db`;
const CORPUS_PATH = `${LOCAL_DIR}/corpus`;

const DEV_USER_ID = "mock-user-001";
const DEV_API_KEY = `mt_dev_${Buffer.from(DEV_USER_ID).toString("base64").slice(0, 24)}`;

const ensureDirectories = async (): Promise<void> => {
	await mkdir(LOCAL_DIR, { recursive: true });
	await mkdir(CORPUS_PATH, { recursive: true });
};

type DrizzleDB = ReturnType<typeof drizzle>;

const seedDevUser = async (db: DrizzleDB): Promise<typeof schema.users.$inferSelect> => {
	const now = new Date().toISOString();

	await db
		.insert(schema.users)
		.values({
			id: DEV_USER_ID,
			email: "dev@localhost.test",
			name: "Dev User",
			created_at: now,
			updated_at: now,
		})
		.onConflictDoNothing();

	const users = await db.select().from(schema.users).limit(1);
	const user = users[0];
	if (!user) throw new Error("Failed to seed user");
	console.log(`  User seeded: ${user.name} (${user.id})`);
	return user;
};

const seedApiKey = async (db: DrizzleDB, userId: string): Promise<void> => {
	const keyHash = await hash_api_key(DEV_API_KEY);
	const now = new Date().toISOString();

	await db
		.insert(schema.apiKeys)
		.values({
			id: crypto.randomUUID(),
			user_id: userId,
			key_hash: keyHash,
			name: "dev-key",
			created_at: now,
		})
		.onConflictDoNothing();

	console.log(`  API key seeded: ${DEV_API_KEY}`);
};

const seedProfile = async (db: DrizzleDB, userId: string): Promise<typeof schema.profiles.$inferSelect> => {
	const now = new Date().toISOString();
	const profileId = crypto.randomUUID();

	await db
		.insert(schema.profiles)
		.values({
			id: profileId,
			user_id: userId,
			slug: "default",
			name: "Default Profile",
			description: "Development profile for testing",
			created_at: now,
			updated_at: now,
		})
		.onConflictDoNothing();

	const profiles = await db.select().from(schema.profiles).limit(1);
	const profile = profiles[0];
	if (!profile) throw new Error("Failed to seed profile");
	console.log(`  Profile seeded: ${profile.name} (${profile.slug})`);
	return profile;
};

const main = async (): Promise<void> => {
	console.log("Seeding database...\n");

	await ensureDirectories();

	if (!existsSync(DB_PATH)) {
		console.error("Database not found at", DB_PATH);
		console.error('Run "bun run db:migrate:local" first to create the schema.');
		process.exit(1);
	}

	const sqlite = new Database(DB_PATH);
	const db = drizzle(sqlite, { schema });

	const user = await seedDevUser(db);
	await seedApiKey(db, user.id);
	await seedProfile(db, user.id);

	sqlite.close();

	console.log("\nDatabase seeded successfully!");
	console.log(`\nDatabase: ${DB_PATH}`);
	console.log(`Corpus: ${CORPUS_PATH}`);
	console.log("\nDev credentials:");
	console.log(`  User ID:  ${DEV_USER_ID}`);
	console.log(`  API Key:  ${DEV_API_KEY}`);
	console.log("\nSet in browser console:");
	console.log(`  localStorage.setItem('apiKey', '${DEV_API_KEY}')`);
};

main().catch(error => {
	console.error("Seed failed:", error);
	process.exit(1);
});
