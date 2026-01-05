import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";

export type RequestContext = {
	requestId: string;
	userId?: string;
	path?: string;
	method?: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => {
	return requestContextStorage.getStore();
};

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T => {
	return requestContextStorage.run(context, fn);
};

export const generateRequestId = (): string => {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

export const requestContextMiddleware = (): MiddlewareHandler => {
	return async (c, next) => {
		const context: RequestContext = {
			requestId: c.req.header("x-request-id") || generateRequestId(),
			path: c.req.path,
			method: c.req.method,
		};

		c.header("x-request-id", context.requestId);

		return runWithRequestContext(context, () => next());
	};
};

export const setRequestUserId = (userId: string) => {
	const ctx = getRequestContext();
	if (ctx) {
		ctx.userId = userId;
	}
};
