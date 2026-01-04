/// <reference types="@cloudflare/workers-types" />

import { createApiApp } from "./app";
import { type Bindings, createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import { defaultProviderFactory } from "./platforms";

// Type for internal API handler that Astro can use for SSR requests
export type ApiHandler = {
	fetch: (request: Request) => Promise<Response>;
};

type AstroHandler = {
	fetch: (request: Request, env: AstroEnv, ctx: ExecutionContext) => Promise<Response>;
};

// Extended bindings that Astro receives, including internal API handler
export type AstroEnv = Bindings & {
	API_HANDLER: ApiHandler;
};

const API_PREFIX = "/media/api";
const HEALTH_PATH = "/media/health";

export const createUnifiedApp = (env: Bindings, astroHandler: AstroHandler) => {
	const mediaApp = createApiApp(env, {
		basePath: "/media",
		providerFactory: defaultProviderFactory,
	});

	// Create internal API handler for SSR requests
	const apiHandler: ApiHandler = {
		fetch: async (request: Request) => {
			const url = new URL(request.url);
			const path = url.pathname;

			// Rewrite URL to remove /media prefix for internal routing
			if (path.startsWith("/media")) {
				url.pathname = path.replace(/^\/media/, "");
				const rewrittenRequest = new Request(url.toString(), request);
				return mediaApp.fetch(rewrittenRequest, env, {} as ExecutionContext);
			}

			return mediaApp.fetch(request, env, {} as ExecutionContext);
		},
	};

	return {
		async fetch(request: Request, _env: Bindings, ctx: ExecutionContext): Promise<Response> {
			const url = new URL(request.url);
			const path = url.pathname;

			// Route API requests directly to Hono
			if (path.startsWith(API_PREFIX) || path === HEALTH_PATH) {
				const rewrittenUrl = new URL(request.url);
				rewrittenUrl.pathname = path.replace(/^\/media/, "");
				const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
				return mediaApp.fetch(rewrittenRequest, env, ctx);
			}

			// Pass API handler to Astro for internal SSR requests
			const envWithApi: AstroEnv = { ...env, API_HANDLER: apiHandler };
			return astroHandler.fetch(request, envWithApi, ctx);
		},
	};
};

export const handleScheduled = async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> => {
	const appCtx = createContextFromBindings(env, defaultProviderFactory);
	ctx.waitUntil(handleCron(appCtx));
};

export type UnifiedApp = ReturnType<typeof createUnifiedApp>;
