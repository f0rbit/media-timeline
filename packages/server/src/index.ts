// Main exports for @media/server package

export { createApiApp, type ApiAppConfig, type MediaBindings, type AppContext, type ProviderFactory } from "./app";
export { createUnifiedApp, handleScheduled, type UnifiedApp } from "./worker";
export { type Bindings, createContextFromBindings } from "./bindings";
export { handleCron, type CronResult, type ProviderFactory as CronProviderFactory } from "./cron";
export { defaultProviderFactory } from "./platforms";
export {
	authMiddleware,
	getAuth,
	syncDevpadUser,
	verifyApiKey,
	verifyJWT,
	verifySessionCookie,
	type AuthContext,
	type DevpadUser,
	type SyncError,
	type VerifyOptions,
	type VerifyResponse,
} from "./auth";
export { timelineRoutes, connectionRoutes, authRoutes, profileRoutes } from "./routes";
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
