#!/usr/bin/env bun
/**
 * Seed script for local development
 * Run with: bun run scripts/seed-local.ts
 *
 * This creates a test user with an API key you can use for testing
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dir, "../.wrangler/state/v3/d1/miniflare-D1DatabaseObject");

async function hashApiKey(key: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(key);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function encrypt(text: string, key: string): Promise<string> {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(key.padEnd(32, "0").slice(0, 32));
	const cryptoKey = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoder.encode(text));
	const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return btoa(String.fromCharCode(...combined));
}

async function main() {
	// Find the D1 database file
	const { readdirSync } = await import("node:fs");

	let files: string[];
	try {
		files = readdirSync(DB_PATH);
	} catch {
		console.error('Local D1 database not found. Run "wrangler dev" first to create it.');
		console.error(`Expected path: ${DB_PATH}`);
		process.exit(1);
	}

	const dbFile = files.find(f => f.endsWith(".sqlite"));

	if (!dbFile) {
		console.error("No SQLite file found in D1 directory");
		process.exit(1);
	}

	const db = new Database(join(DB_PATH, dbFile));

	// Read encryption key from .dev.vars
	const devVars = await Bun.file(join(import.meta.dir, "../.dev.vars")).text();
	const encryptionKey = devVars.match(/ENCRYPTION_KEY=(.+)/)?.[1] ?? "test-key-32-chars-placeholder!!";

	const now = new Date().toISOString();
	const userId = "user_local_test";
	const apiKey = `mt_test_${crypto.randomUUID().replace(/-/g, "")}`;
	const apiKeyHash = await hashApiKey(apiKey);

	// Create test user
	db.run(
		`
    INSERT OR REPLACE INTO users (id, email, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
		[userId, "test@localhost", "Local Test User", now, now]
	);

	// Create API key
	db.run(
		`
    INSERT OR REPLACE INTO api_keys (id, user_id, key_hash, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
		[crypto.randomUUID(), userId, apiKeyHash, "Local Development Key", now]
	);

	console.log("\n=== Local Development Seed Complete ===\n");
	console.log("Test User:");
	console.log(`  ID: ${userId}`);
	console.log(`  Email: test@localhost`);
	console.log("");
	console.log("API Key (save this!):");
	console.log(`  ${apiKey}`);
	console.log("");
	console.log("Test with:");
	console.log(`  curl -H "Authorization: Bearer ${apiKey}" http://localhost:8787/api/v1/connections`);
	console.log("");

	// Optionally create a GitHub account connection
	const createGitHubAccount = process.argv.includes("--with-github");

	if (createGitHubAccount) {
		const ghToken = process.env.GITHUB_TOKEN;
		if (!ghToken) {
			console.log("To add GitHub account, set GITHUB_TOKEN env var and run with --with-github");
		} else {
			const accountId = "acc_github_local";
			const encryptedToken = await encrypt(ghToken, encryptionKey);

			db.run(
				`
        INSERT OR REPLACE INTO accounts (id, platform, platform_username, access_token_encrypted, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `,
				[accountId, "github", "local-user", encryptedToken, now, now]
			);

			db.run(
				`
        INSERT OR REPLACE INTO account_members (id, user_id, account_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `,
				[crypto.randomUUID(), userId, accountId, now]
			);

			console.log("GitHub Account:");
			console.log(`  ID: ${accountId}`);
			console.log(`  Token: (encrypted)`);
			console.log("");
		}
	}

	db.close();
}

main().catch(console.error);
