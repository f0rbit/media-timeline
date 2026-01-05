import { AsyncLocalStorage } from "node:async_hooks";

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
