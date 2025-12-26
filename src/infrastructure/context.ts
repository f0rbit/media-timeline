import type { Backend } from "@f0rbit/corpus/cloudflare";
import type { ProviderFactory } from "../cron";
import type { Database } from "../db";

export type DrizzleDB = Database;

export type AppContext = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
};
