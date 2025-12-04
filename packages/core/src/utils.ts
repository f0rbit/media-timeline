// ============================================================================
// Result Type - Functional error handling
// ============================================================================

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => !result.ok;

export const unwrap = <T, E>(result: Result<T, E>): T => {
	if (!result.ok) throw new Error(`Unwrap called on error result: ${JSON.stringify(result.error)}`);
	return result.value;
};

export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => (result.ok ? result.value : defaultValue);

export const unwrapErr = <T, E>(result: Result<T, E>): E => {
	if (result.ok) throw new Error(`unwrapErr called on ok result: ${JSON.stringify(result.value)}`);
	return result.error;
};

export const mapResult = <T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> => (result.ok ? result : err(fn(result.error)));

// ============================================================================
// Base64 Encoding/Decoding
// ============================================================================

export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export const fromBase64 = (str: string): Uint8Array => Uint8Array.from(atob(str), c => c.charCodeAt(0));

// ============================================================================
// Hex Encoding/Decoding
// ============================================================================

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (str: string): Uint8Array => {
	const matches = str.match(/.{1,2}/g);
	if (!matches) return new Uint8Array(0);
	return new Uint8Array(matches.map(byte => Number.parseInt(byte, 16)));
};

// ============================================================================
// Hashing Utilities
// ============================================================================

export const hashSha256 = async (data: string): Promise<Uint8Array> => {
	const encoded = new TextEncoder().encode(data);
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
	return new Uint8Array(hashBuffer);
};

export const hashApiKey = async (key: string): Promise<string> => {
	const hash = await hashSha256(key);
	return toHex(hash);
};

// ============================================================================
// Type Utilities
// ============================================================================

export type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export const mergeDeep = <T extends Record<string, unknown>>(base: T, overrides: DeepPartial<T>): T => {
	const result = { ...base };
	for (const key in overrides) {
		const value = overrides[key as keyof typeof overrides];
		if (value !== undefined && typeof value === "object" && !Array.isArray(value) && value !== null) {
			(result as Record<string, unknown>)[key] = mergeDeep(result[key] as Record<string, unknown>, value as DeepPartial<Record<string, unknown>>);
		} else if (value !== undefined) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
};

// ============================================================================
// Date/Time Utilities
// ============================================================================

export const daysAgo = (days: number): string => {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date.toISOString();
};

export const hoursAgo = (hours: number): string => {
	const date = new Date();
	date.setHours(date.getHours() - hours);
	return date.toISOString();
};

export const minutesAgo = (minutes: number): string => {
	const date = new Date();
	date.setMinutes(date.getMinutes() - minutes);
	return date.toISOString();
};

export const daysFromNow = (days: number): string => {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date.toISOString();
};

export const hoursFromNow = (hours: number): string => {
	const date = new Date();
	date.setHours(date.getHours() + hours);
	return date.toISOString();
};

export const minutesFromNow = (minutes: number): string => {
	const date = new Date();
	date.setMinutes(date.getMinutes() + minutes);
	return date.toISOString();
};

export const extractDateKey = (timestamp: string): string => {
	const date = new Date(timestamp);
	return date.toISOString().split("T")[0] ?? "";
};

// ============================================================================
// ID Generation
// ============================================================================

export const uuid = (): string => crypto.randomUUID();

export const randomSha = (): string => Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
