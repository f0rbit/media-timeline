import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type ErrorResponseBody = { error: string; message: string; details?: unknown };

const ERROR_NAMES: Record<number, string> = {
	400: "Bad request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not found",
	409: "Conflict",
	500: "Internal server error",
};

const httpError = (c: Context, status: ContentfulStatusCode, message: string, details?: unknown): Response => {
	const body: ErrorResponseBody = { error: ERROR_NAMES[status] ?? "Error", message };
	if (details !== undefined) body.details = details;
	return c.json(body, status);
};

export const badRequest = (c: Context, message: string, details?: unknown) => httpError(c, 400, message, details);
export const unauthorized = (c: Context, message: string) => httpError(c, 401, message);
export const forbidden = (c: Context, message: string) => httpError(c, 403, message);
export const notFound = (c: Context, message: string) => httpError(c, 404, message);
export const conflict = (c: Context, message: string) => httpError(c, 409, message);
export const serverError = (c: Context, message: string) => httpError(c, 500, message);
