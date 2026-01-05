import type { Database } from "bun:sqlite";
import type * as schema from "@media/schema/database";
import type { AppContext } from "@media/server/infrastructure/context";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import type { TestCorpus } from "./corpus";
import type { TestProviders } from "./providers";

export type TestEnv = {
	ENCRYPTION_KEY: string;
	ENVIRONMENT: string;
};

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export type TestContext = {
	db: Database;
	drizzle: DrizzleDB;
	providers: TestProviders;
	env: TestEnv;
	corpus: TestCorpus;
	appContext: AppContext;
	cleanup(): void;
};
