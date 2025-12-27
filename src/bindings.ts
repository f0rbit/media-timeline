/// <reference types="@cloudflare/workers-types" />

import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import type { AppContext } from "./infrastructure";
import type { ProviderFactory } from "./platforms/types";
import * as schema from "./schema/database";

export type Bindings = {
	DB: D1Database;
	BUCKET: R2Bucket;
	EncryptionKey: string;
	ENVIRONMENT: string;
	REDDIT_CLIENT_ID?: string;
	REDDIT_CLIENT_SECRET?: string;
	TWITTER_CLIENT_ID?: string;
	TWITTER_CLIENT_SECRET?: string;
	APP_URL?: string;
	FRONTEND_URL?: string;
};

type CorpusBackend = {
	d1: { prepare: (sql: string) => unknown };
	r2: {
		get: (key: string) => Promise<{ body: ReadableStream<Uint8Array>; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
		put: (key: string, data: ReadableStream<Uint8Array> | Uint8Array) => Promise<void>;
		delete: (key: string) => Promise<void>;
		head: (key: string) => Promise<{ key: string } | null>;
	};
};

const toCorpusBackend = (env: Bindings): CorpusBackend => ({
	d1: env.DB as unknown as CorpusBackend["d1"],
	r2: env.BUCKET as unknown as CorpusBackend["r2"],
});

export const createContextFromBindings = (env: Bindings, providerFactory: ProviderFactory): AppContext => ({
	db: drizzle(env.DB, { schema }),
	backend: create_cloudflare_backend(toCorpusBackend(env)),
	providerFactory,
	encryptionKey: env.EncryptionKey,
});
