// Main exports for @media/server package

import { configureErrorLogging } from "@media/schema";
import { createLogger } from "./logger";

const errorLog = createLogger("errors");

// Configure error logging with a custom logger.
// Note: Request context (requestId, userId, path) should be passed explicitly
// via the ctx parameter when calling error functions, as we no longer use
// AsyncLocalStorage for automatic context propagation.
configureErrorLogging({
	logger: ({ error, context }) => {
		errorLog.error(`[${error.kind}] ${error.message || ""}`, {
			error_kind: error.kind,
			...error,
			request_id: context.requestId,
			user_id: context.userId,
			operation: context.operation,
			path: context.path,
			timestamp: context.timestamp,
			stack: context.stack?.split("\n").slice(2, 6).join("\n"),
		});
	},
	// No contextProvider - pass context explicitly when calling error functions
});

export { createApiApp, type ApiAppConfig, type MediaBindings, type AppContext, type ProviderFactory } from "./app";
export { createUnifiedApp, handleScheduled, type UnifiedApp, type ApiHandler, type AstroEnv } from "./worker";
export { type Bindings, createContextFromBindings } from "./bindings";
export { handleCron, type CronResult, type ProviderFactory as CronProviderFactory } from "./cron";
export { defaultProviderFactory } from "./platforms";
export {
	authMiddleware,
	getAuth,
	verifyApiKey,
	verifyJWT,
	verifySessionCookie,
	type AuthContext,
	type DevpadUser,
	type VerifyOptions,
	type VerifyResponse,
} from "./auth";
export { timelineRoutes, connectionRoutes, authRoutes, profileRoutes } from "./routes/index";
export { createDb, type Database } from "./db";
export { hash_api_key } from "./utils";

// Services
export * from "./services";

// Route helpers
export { handleResult, handleResultWith, handleResultNoContent, type ServiceError, type Variables } from "./utils/route-helpers";

// Rate limiting
export {
	type RateLimitState,
	initialState,
	isCircuitOpen,
	shouldFetch,
	updateOnSuccess,
	updateOnFailure,
} from "./rate-limits";

// Request context
export {
	getRequestContext,
	generateRequestId,
	requestContextMiddleware,
	setRequestUserId,
	type RequestContext,
} from "./request-context";
