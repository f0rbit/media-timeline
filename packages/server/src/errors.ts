/**
 * Centralized error types for the application.
 * Use discriminated unions with 'kind' field for type-safe error handling.
 */

import type { ForbiddenError as SchemaForbiddenError, NotFoundError as SchemaNotFoundError } from "@media/schema";

// Base error kinds
export type DecryptionError = { kind: "decryption_failed"; message: string };
export type FetchError = { kind: "fetch_failed"; message: string; status?: number };
export type StoreError = { kind: "store_failed"; store_id: string };
export type PutError = { kind: "put_failed"; message: string };
export type NotFoundError = { kind: "not_found" };
export type ForbiddenError = { kind: "forbidden"; message: string };
export type DatabaseError = { kind: "database_error"; message: string };
export type AuthError = { kind: "auth_expired"; message: string };
export type RateLimitError = { kind: "rate_limited"; retry_after?: Date };
export type ValidationError = { kind: "validation_error"; message: string };
export type InactiveError = { kind: "inactive"; message: string };
export type ProcessFailedError = { kind: "process_failed"; message: string };
export type NotFoundWithMessageError = { kind: "not_found"; message: string };
export type NoRefreshTokenError = { kind: "no_refresh_token"; message: string };
export type NoCredentialsError = { kind: "no_credentials"; message: string };
export type RefreshFailedError = { kind: "refresh_failed"; message: string };
export type EncryptionError = { kind: "encryption_failed"; message: string };

// Composite error types for different domains
export type CronProcessError = DecryptionError | FetchError | StoreError | PutError;

export type ConnectionError = SchemaNotFoundError | SchemaForbiddenError | DatabaseError;

export type ProviderError = AuthError | RateLimitError | FetchError;

export type RefreshError = NotFoundWithMessageError | InactiveError | DecryptionError | ProcessFailedError | NoRefreshTokenError | NoCredentialsError | RefreshFailedError | EncryptionError;

// Helper type guards
export const isRetryable = (error: { kind: string }): boolean => error.kind === "rate_limited" || error.kind === "fetch_failed";
