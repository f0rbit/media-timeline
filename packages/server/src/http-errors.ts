import type { Context } from "hono";

type ErrorResponse = {
	error: string;
	message: string;
	details?: unknown;
};

export const notFound = (c: Context, message: string) => c.json<ErrorResponse>({ error: "Not found", message }, 404);

export const forbidden = (c: Context, message: string) => c.json<ErrorResponse>({ error: "Forbidden", message }, 403);

export const badRequest = (c: Context, message: string, details?: unknown) => {
	const response: ErrorResponse = { error: "Bad request", message };
	if (details !== undefined) response.details = details;
	return c.json<ErrorResponse>(response, 400);
};

export const unauthorized = (c: Context, message: string) => c.json<ErrorResponse>({ error: "Unauthorized", message }, 401);

export const serverError = (c: Context, message: string) => c.json<ErrorResponse>({ error: "Internal server error", message }, 500);
