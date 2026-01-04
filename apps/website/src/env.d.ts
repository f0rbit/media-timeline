/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface ImportMetaEnv {
	readonly PUBLIC_API_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

// API Handler type for internal SSR routing
type ApiHandler = {
	fetch: (request: Request) => Promise<Response>;
};

// Runtime environment available in Astro SSR context
type RuntimeEnv = {
	// Internal API handler for SSR requests (injected by unified worker)
	API_HANDLER?: ApiHandler;

	// Cloudflare assets binding
	ASSETS: { fetch: (req: Request | string) => Promise<Response> };

	// Environment variables
	ENVIRONMENT: string;
	ENCRYPTION_KEY: string;
	API_URL: string;
	FRONTEND_URL: string;
	DEVPAD_URL?: string;

	// OAuth secrets
	REDDIT_CLIENT_ID?: string;
	REDDIT_CLIENT_SECRET?: string;
	TWITTER_CLIENT_ID?: string;
	TWITTER_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;

	// Allow additional properties
	[key: string]: unknown;
};

// Astro App namespace declarations
declare namespace App {
	interface Locals {
		runtime: {
			env: RuntimeEnv;
			cf: CfProperties;
			ctx: ExecutionContext;
			caches: CacheStorage;
		};
	}
}
