import type { ServiceError as SchemaServiceError } from "@media/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthContext } from "../auth";
import type { AppContext } from "../infrastructure/context";
import type { Result } from "../utils";

export const getContext = <C extends { get: (k: "appContext") => AppContext }>(c: C): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

export type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

export type ServiceError = SchemaServiceError;

type ErrorMapping = {
	status: 400 | 403 | 404 | 409 | 500;
	code: string;
	defaultMessage: string;
};

const ERROR_MAPPINGS: Record<ServiceError["kind"], ErrorMapping> = {
	not_found: { status: 404, code: "NOT_FOUND", defaultMessage: "Resource not found" },
	forbidden: { status: 403, code: "FORBIDDEN", defaultMessage: "Access denied" },
	bad_request: { status: 400, code: "BAD_REQUEST", defaultMessage: "Invalid request" },
	conflict: { status: 409, code: "CONFLICT", defaultMessage: "Resource conflict" },
	validation: { status: 400, code: "VALIDATION_ERROR", defaultMessage: "Validation failed" },
	rate_limited: { status: 500, code: "RATE_LIMITED", defaultMessage: "Rate limited" },
	network_error: { status: 500, code: "NETWORK_ERROR", defaultMessage: "Network error" },
	auth_expired: { status: 403, code: "AUTH_EXPIRED", defaultMessage: "Authentication expired" },
	api_error: { status: 500, code: "API_ERROR", defaultMessage: "API error" },
	encryption_error: { status: 500, code: "ENCRYPTION_ERROR", defaultMessage: "Failed to process encryption" },
	store_error: { status: 500, code: "STORE_ERROR", defaultMessage: "Storage operation failed" },
	parse_error: { status: 500, code: "PARSE_ERROR", defaultMessage: "Failed to parse data" },
	db_error: { status: 500, code: "DB_ERROR", defaultMessage: "Database operation failed" },
};

const buildMessage = (error: ServiceError): string => {
	if ("message" in error && error.message) return error.message;
	if ("resource" in error && error.resource) return `${ERROR_MAPPINGS[error.kind].defaultMessage}: ${error.resource}`;
	return ERROR_MAPPINGS[error.kind].defaultMessage;
};

type ErrorResponseBody = { error: string; message: string; details?: unknown };
type ErrorResponse = {
	status: ErrorMapping["status"];
	body: ErrorResponseBody;
};

const ERROR_NAMES: Record<ErrorMapping["status"], string> = {
	400: "Bad request",
	403: "Forbidden",
	404: "Not found",
	409: "Conflict",
	500: "Internal server error",
};

export const mapServiceErrorToResponse = (error: ServiceError): ErrorResponse => {
	const mapping = ERROR_MAPPINGS[error.kind];
	const body: ErrorResponseBody = {
		error: ERROR_NAMES[mapping.status],
		message: buildMessage(error),
	};

	if ("details" in error && error.details !== undefined) {
		body.details = error.details;
	}

	return { status: mapping.status, body };
};

export const handleResult = <T>(c: Context, result: Result<T, ServiceError>, successStatus: ContentfulStatusCode = 200): Response => {
	if (!result.ok) {
		const { status, body } = mapServiceErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(result.value, successStatus);
};

export const handleResultWith = <T, R>(c: Context, result: Result<T, ServiceError>, mapper: (value: T) => R, successStatus: ContentfulStatusCode = 200): Response => {
	if (!result.ok) {
		const { status, body } = mapServiceErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(mapper(result.value), successStatus);
};

export const handleResultNoContent = <T>(c: Context, result: Result<T, ServiceError>): Response => {
	if (!result.ok) {
		const { status, body } = mapServiceErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.body(null, 204);
};
