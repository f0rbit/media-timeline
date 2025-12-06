/// <reference types="@cloudflare/workers-types" />

export type Bindings = {
	DB: D1Database;
	BUCKET: R2Bucket;
	EncryptionKey: string;
	ENVIRONMENT: string;
};
