import { err, type Result } from "@f0rbit/corpus";

export type BaseError = { kind: string; message?: string };
export type NotFoundError = BaseError & { kind: "not_found"; resource: string; id?: string };
export type ForbiddenError = BaseError & { kind: "forbidden"; reason?: string };
export type ValidationError = BaseError & { kind: "validation"; errors: Record<string, string[]> };
export type RateLimitedError = BaseError & { kind: "rate_limited"; retry_after?: number };
export type StoreError = BaseError & { kind: "store_error"; operation: string };
export type NetworkError = BaseError & { kind: "network_error"; cause?: Error };
export type AuthExpiredError = BaseError & { kind: "auth_expired" };
export type ApiError = BaseError & { kind: "api_error"; status: number };
export type ParseError = BaseError & { kind: "parse_error" };
export type EncryptionError = BaseError & { kind: "encryption_error"; operation: "encrypt" | "decrypt" };
export type DatabaseError = BaseError & { kind: "db_error" };
export type ConflictError = BaseError & { kind: "conflict"; resource?: string };
export type BadRequestError = BaseError & { kind: "bad_request"; details?: unknown };

export type ServiceError = NotFoundError | ForbiddenError | ValidationError | RateLimitedError | StoreError | NetworkError | AuthExpiredError | ApiError | ParseError | EncryptionError | DatabaseError | ConflictError | BadRequestError;
export type ProviderError = RateLimitedError | AuthExpiredError | NetworkError | ApiError | ParseError;
export type CronError = StoreError | NetworkError | AuthExpiredError | EncryptionError;

export type ErrorContext = { timestamp: string; stack?: string; requestId?: string; userId?: string; operation?: string; [key: string]: unknown };
export type ErrorLogEntry = { error: ServiceError; context: ErrorContext };
type ErrorLogFn = (entry: ErrorLogEntry) => void;

const defaultLogger: ErrorLogFn = ({ error, context }) => {
	console.error(`[${context.timestamp}] [${error.kind}]`, error.message || error.kind, { ...error, stack: context.stack?.split("\n").slice(2, 5).join("\n"), ...context });
};

let errorLogger: ErrorLogFn = defaultLogger;
let contextProvider: (() => Partial<ErrorContext>) | null = null;

export const configureErrorLogging = (config: { logger?: ErrorLogFn; contextProvider?: () => Partial<ErrorContext> }) => {
	if (config.logger) errorLogger = config.logger;
	if (config.contextProvider) contextProvider = config.contextProvider;
};

const logAndReturn = <E extends ServiceError>(error: E, ctx?: Record<string, unknown>): Result<never, E> => {
	const context: ErrorContext = { timestamp: new Date().toISOString(), stack: new Error().stack, ...contextProvider?.(), ...ctx };
	errorLogger({ error, context });
	return err(error);
};

const hasKind = (e: unknown, kind: string): boolean => typeof e === "object" && e !== null && "kind" in e && (e as { kind: string }).kind === kind;

export const isNotFoundError = (e: unknown): e is NotFoundError => hasKind(e, "not_found");
export const isForbiddenError = (e: unknown): e is ForbiddenError => hasKind(e, "forbidden");
export const isValidationError = (e: unknown): e is ValidationError => hasKind(e, "validation");
export const isRateLimitedError = (e: unknown): e is RateLimitedError => hasKind(e, "rate_limited");
export const isStoreError = (e: unknown): e is StoreError => hasKind(e, "store_error");
export const isNetworkError = (e: unknown): e is NetworkError => hasKind(e, "network_error");
export const isAuthExpiredError = (e: unknown): e is AuthExpiredError => hasKind(e, "auth_expired");
export const isApiError = (e: unknown): e is ApiError => hasKind(e, "api_error");
export const isParseError = (e: unknown): e is ParseError => hasKind(e, "parse_error");
export const isEncryptionError = (e: unknown): e is EncryptionError => hasKind(e, "encryption_error");
export const isDatabaseError = (e: unknown): e is DatabaseError => hasKind(e, "db_error");
export const isConflictError = (e: unknown): e is ConflictError => hasKind(e, "conflict");
export const isBadRequestError = (e: unknown): e is BadRequestError => hasKind(e, "bad_request");
export const isServiceError = (e: unknown): e is ServiceError =>
	isNotFoundError(e) ||
	isForbiddenError(e) ||
	isValidationError(e) ||
	isRateLimitedError(e) ||
	isStoreError(e) ||
	isNetworkError(e) ||
	isAuthExpiredError(e) ||
	isApiError(e) ||
	isParseError(e) ||
	isEncryptionError(e) ||
	isDatabaseError(e) ||
	isConflictError(e) ||
	isBadRequestError(e);
export const isRetryableError = (e: unknown): boolean => isRateLimitedError(e) || isNetworkError(e);

export const notFound = (resource: string, id?: string, ctx?: Record<string, unknown>): Result<never, NotFoundError> => logAndReturn({ kind: "not_found", resource, ...(id && { id }) }, ctx);
export const forbidden = (reason?: string, ctx?: Record<string, unknown>): Result<never, ForbiddenError> => logAndReturn({ kind: "forbidden", ...(reason && { reason, message: reason }) }, ctx);
export const validation = (errors: Record<string, string[]>, ctx?: Record<string, unknown>): Result<never, ValidationError> => logAndReturn({ kind: "validation", errors }, ctx);
export const rateLimited = (retry_after?: number, ctx?: Record<string, unknown>): Result<never, RateLimitedError> => logAndReturn({ kind: "rate_limited", ...(retry_after !== undefined && { retry_after }) }, ctx);
export const storeError = (operation: string, message?: string, ctx?: Record<string, unknown>): Result<never, StoreError> => logAndReturn({ kind: "store_error", operation, ...(message && { message }) }, ctx);
export const networkError = (cause?: Error, message?: string, ctx?: Record<string, unknown>): Result<never, NetworkError> => logAndReturn({ kind: "network_error", ...(cause && { cause }), ...(message && { message }) }, ctx);
export const authExpired = (message?: string, ctx?: Record<string, unknown>): Result<never, AuthExpiredError> => logAndReturn({ kind: "auth_expired", ...(message && { message }) }, ctx);
export const apiError = (status: number, message?: string, ctx?: Record<string, unknown>): Result<never, ApiError> => logAndReturn({ kind: "api_error", status, ...(message && { message }) }, ctx);
export const parseError = (message?: string, ctx?: Record<string, unknown>): Result<never, ParseError> => logAndReturn({ kind: "parse_error", ...(message && { message }) }, ctx);
export const encryptionError = (operation: "encrypt" | "decrypt", message?: string, ctx?: Record<string, unknown>): Result<never, EncryptionError> => logAndReturn({ kind: "encryption_error", operation, ...(message && { message }) }, ctx);
export const dbError = (message?: string, ctx?: Record<string, unknown>): Result<never, DatabaseError> => logAndReturn({ kind: "db_error", ...(message && { message }) }, ctx);
export const conflict = (resource?: string, message?: string, ctx?: Record<string, unknown>): Result<never, ConflictError> => logAndReturn({ kind: "conflict", ...(resource && { resource }), ...(message && { message }) }, ctx);
export const badRequest = (message?: string, details?: unknown, ctx?: Record<string, unknown>): Result<never, BadRequestError> =>
	logAndReturn({ kind: "bad_request", ...(message && { message }), ...(details !== undefined && { details }) }, ctx);

export const errors = {
	notFound,
	forbidden,
	validation,
	rateLimited,
	storeError,
	networkError,
	authExpired,
	apiError,
	parseError,
	encryptionError,
	dbError,
	conflict,
	badRequest,
	is: {
		notFound: isNotFoundError,
		forbidden: isForbiddenError,
		validation: isValidationError,
		rateLimited: isRateLimitedError,
		storeError: isStoreError,
		networkError: isNetworkError,
		authExpired: isAuthExpiredError,
		apiError: isApiError,
		parseError: isParseError,
		encryptionError: isEncryptionError,
		dbError: isDatabaseError,
		conflict: isConflictError,
		badRequest: isBadRequestError,
		serviceError: isServiceError,
		retryable: isRetryableError,
	},
} as const;
