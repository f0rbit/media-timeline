import { Database } from "bun:sqlite";
import * as schema from "@media/schema/database";
import type { AppContext } from "@media/server/infrastructure/context";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createTestCorpus } from "./corpus";
import { createTestProviders, defaultTestProviderFactory } from "./providers";
import type { TestContext, TestEnv } from "./types";

export type { TestContext, TestEnv };

const ENCRYPTION_KEY = "test-encryption-key-32-bytes-long!";

export const createTestContext = (): TestContext => {
	const db = new Database(":memory:");
	const drizzleDb = drizzle(db, { schema });

	migrate(drizzleDb, { migrationsFolder: "./migrations" });

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

	return { db, drizzle: drizzleDb, providers, env, corpus, appContext, cleanup };
};
