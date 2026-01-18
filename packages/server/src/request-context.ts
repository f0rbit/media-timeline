import type { Context, MiddlewareHandler } from "hono";

export type RequestContext = {
	requestId: string;
	userId?: string;
	path?: string;
	method?: string;
};

// Request context key for Hono's context storage
const REQUEST_CONTEXT_KEY = "requestContext";

export const generateRequestId = (): string => {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Middleware that sets up request context in Hono's context storage.
 * Access via getRequestContext(c) in route handlers.
 */
export const requestContextMiddleware = (): MiddlewareHandler => {
	return async (c, next) => {
		const context: RequestContext = {
			requestId: c.req.header("x-request-id") || generateRequestId(),
			path: c.req.path,
			method: c.req.method,
		};

		c.header("x-request-id", context.requestId);
		c.set(REQUEST_CONTEXT_KEY, context);

		return next();
	};
};

/**
 * Get the request context from Hono's context.
 * Must be called within a request handler where c is available.
 */
export const getRequestContext = (c: Context): RequestContext | undefined => {
	return c.get(REQUEST_CONTEXT_KEY);
};

/**
 * Set the user ID on the request context.
 * Must be called within a request handler where c is available.
 */
export const setRequestUserId = (c: Context, userId: string) => {
	const ctx = getRequestContext(c);
	if (ctx) {
		ctx.userId = userId;
	}
};
