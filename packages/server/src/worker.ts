/// <reference types="@cloudflare/workers-types" />

import { createApiApp } from "./app";
import { type Bindings, createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import { defaultProviderFactory } from "./platforms";

type AstroHandler = {
	fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => Promise<Response>;
};

const API_PREFIX = "/media/api";
const HEALTH_PATH = "/media/health";

export const createUnifiedApp = (env: Bindings, astroHandler: AstroHandler) => {
	const mediaApp = createApiApp(env, {
		basePath: "/media",
		providerFactory: defaultProviderFactory,
	});

	return {
		async fetch(request: Request, _env: Bindings, ctx: ExecutionContext): Promise<Response> {
			const url = new URL(request.url);
			const path = url.pathname;

			if (path.startsWith(API_PREFIX) || path === HEALTH_PATH) {
				const rewrittenUrl = new URL(request.url);
				rewrittenUrl.pathname = path.replace(/^\/media/, "");
				const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
				return mediaApp.fetch(rewrittenRequest, env, ctx);
			}

			return astroHandler.fetch(request, env, ctx);
		},
	};
};

export const handleScheduled = async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> => {
	const appCtx = createContextFromBindings(env, defaultProviderFactory);
	ctx.waitUntil(handleCron(appCtx));
};

export type UnifiedApp = ReturnType<typeof createUnifiedApp>;
