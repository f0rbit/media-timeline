import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthContext } from "../auth";
import type { AppContext } from "../infrastructure";
import type { Result } from "../utils";

export type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

export type ServiceError =
	| { kind: "not_found"; resource: string }
	| { kind: "forbidden"; message: string }
	| { kind: "bad_request"; message: string; details?: unknown }
	| { kind: "conflict"; message: string }
	| { kind: "inactive"; message: string }
	| { kind: "decryption_failed"; message: string }
	| { kind: "encryption_failed"; message: string }
	| { kind: "store_error"; message?: string }
	| { kind: "parse_error"; message?: string }
	| { kind: "db_error"; message: string }
	| { kind: "profile_not_found" }
	| { kind: "no_accounts" }
	| { kind: "timeline_generation_failed"; message: string };

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
	inactive: { status: 400, code: "INACTIVE", defaultMessage: "Resource is inactive" },
	decryption_failed: { status: 500, code: "DECRYPTION_ERROR", defaultMessage: "Failed to decrypt" },
	encryption_failed: { status: 500, code: "ENCRYPTION_ERROR", defaultMessage: "Failed to encrypt" },
	store_error: { status: 500, code: "STORE_ERROR", defaultMessage: "Storage operation failed" },
	parse_error: { status: 500, code: "PARSE_ERROR", defaultMessage: "Failed to parse data" },
	db_error: { status: 500, code: "DB_ERROR", defaultMessage: "Database operation failed" },
	profile_not_found: { status: 404, code: "NOT_FOUND", defaultMessage: "Profile not found" },
	no_accounts: { status: 400, code: "NO_ACCOUNTS", defaultMessage: "No accounts configured" },
	timeline_generation_failed: { status: 500, code: "TIMELINE_ERROR", defaultMessage: "Timeline generation failed" },
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
