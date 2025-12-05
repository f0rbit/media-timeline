/// <reference types="@cloudflare/workers-types" />

export type Bindings = {
	DB: D1Database;
	BUCKET: R2Bucket;
	ENCRYPTION_KEY: string;
	ENVIRONMENT: string;
};
