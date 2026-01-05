import type { MiddlewareHandler } from "hono";
import { generateRequestId, getRequestContext, runWithRequestContext, type RequestContext } from "../request-context";

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
		(ctx as RequestContext).userId = userId;
	}
};

export { getRequestContext } from "../request-context";
