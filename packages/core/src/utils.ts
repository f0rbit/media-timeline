// ============================================================================
// Result Type - Streamlined Functional Error Handling
// ============================================================================

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ============================================================================
// Core Operations
// ============================================================================

export const match = <T, E, R>(result: Result<T, E>, onOk: (value: T) => R, onErr: (error: E) => R): R => {
	if (result.ok) {
		return onOk(result.value);
	}
	return onErr(result.error);
};

export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => (result.ok ? result.value : defaultValue);

export const collect = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
	const values: T[] = [];
	for (const r of results) {
		if (!r.ok) return err(r.error);
		values.push(r.value);
	}
	return ok(values);
};

// ============================================================================
// Try/Catch Wrappers
// ============================================================================

export const tryCatch = <T, E>(fn: () => T, onError: (e: unknown) => E): Result<T, E> => {
	try {
		return ok(fn());
	} catch (e) {
		return err(onError(e));
	}
};

export const tryCatchAsync = async <T, E>(fn: () => Promise<T>, onError: (e: unknown) => E): Promise<Result<T, E>> => {
	try {
		return ok(await fn());
	} catch (e) {
		return err(onError(e));
	}
};

// ============================================================================
// Fetch Helper
// ============================================================================

export type FetchError = { type: "network"; cause: unknown } | { type: "http"; status: number; statusText: string };

export const fetchResult = async <T, E>(input: string | URL | Request, init: RequestInit | undefined, onError: (e: FetchError) => E, parseBody: (response: Response) => Promise<T> = r => r.json() as Promise<T>): Promise<Result<T, E>> => {
	try {
		const response = await fetch(input, init);
		if (!response.ok) {
			return err(onError({ type: "http", status: response.status, statusText: response.statusText }));
		}
		return ok(await parseBody(response));
	} catch (e) {
		return err(onError({ type: "network", cause: e }));
	}
};

// ============================================================================
// Unified Pipe Builder
// ============================================================================

type MaybePromise<T> = T | Promise<T>;

/**
 * A unified pipe that works with both Result<T,E> and Promise<Result<T,E>>.
 * All methods return a pipe over Promise<Result<T,E>> for consistency.
 */
export type Pipe<T, E> = {
	map: <U>(fn: (value: T) => U) => Pipe<U, E>;
	mapAsync: <U>(fn: (value: T) => Promise<U>) => Pipe<U, E>;
	flatMap: <U>(fn: (value: T) => MaybePromise<Result<U, E>>) => Pipe<U, E>;
	mapErr: <F>(fn: (error: E) => F) => Pipe<T, F>;
	tap: (fn: (value: T) => MaybePromise<void>) => Pipe<T, E>;
	tapErr: (fn: (error: E) => MaybePromise<void>) => Pipe<T, E>;
	unwrapOr: (defaultValue: T) => Promise<T>;
	result: () => Promise<Result<T, E>>;
};

const createPipe = <T, E>(promised: Promise<Result<T, E>>): Pipe<T, E> => ({
	map: <U>(fn: (value: T) => U): Pipe<U, E> =>
		createPipe(
			promised.then((r): Result<U, E> => {
				if (r.ok) return ok(fn(r.value));
				return err(r.error);
			})
		),

	mapAsync: <U>(fn: (value: T) => Promise<U>): Pipe<U, E> =>
		createPipe(
			promised.then(async (r): Promise<Result<U, E>> => {
				if (r.ok) return ok(await fn(r.value));
				return err(r.error);
			})
		),

	flatMap: <U>(fn: (value: T) => MaybePromise<Result<U, E>>): Pipe<U, E> =>
		createPipe(
			promised.then((r): MaybePromise<Result<U, E>> => {
				if (r.ok) return fn(r.value);
				return err(r.error);
			})
		),

	mapErr: <F>(fn: (error: E) => F): Pipe<T, F> =>
		createPipe(
			promised.then((r): Result<T, F> => {
				if (r.ok) return ok(r.value);
				return err(fn(r.error));
			})
		),

	tap: (fn: (value: T) => MaybePromise<void>): Pipe<T, E> =>
		createPipe(
			promised.then(async (r): Promise<Result<T, E>> => {
				if (r.ok) await fn(r.value);
				return r;
			})
		),

	tapErr: (fn: (error: E) => MaybePromise<void>): Pipe<T, E> =>
		createPipe(
			promised.then(async (r): Promise<Result<T, E>> => {
				if (!r.ok) await fn(r.error);
				return r;
			})
		),

	unwrapOr: (defaultValue: T): Promise<T> => promised.then(r => (r.ok ? r.value : defaultValue)),

	result: (): Promise<Result<T, E>> => promised,
});

/**
 * Start a pipe from a Result or Promise<Result>.
 * Unifies sync and async Result handling into a single fluent API.
 */
export const pipe = <T, E>(initial: MaybePromise<Result<T, E>>): Pipe<T, E> => createPipe(Promise.resolve(initial));

/** Start a pipe from a value (wraps in ok) */
pipe.ok = <T>(value: T): Pipe<T, never> => pipe(ok(value));

/** Start a pipe from an error (wraps in err) */
pipe.err = <E>(error: E): Pipe<never, E> => pipe(err(error));

/** Start a pipe from a promise that might throw */
pipe.try = <T, E>(fn: () => Promise<T>, onError: (e: unknown) => E): Pipe<T, E> => pipe(tryCatchAsync(fn, onError));

/** Start a pipe from a fetch operation */
pipe.fetch = <T, E>(input: string | URL | Request, init: RequestInit | undefined, onError: (e: FetchError) => E, parseBody?: (response: Response) => Promise<T>): Pipe<T, E> => pipe(fetchResult(input, init, onError, parseBody));

// ============================================================================
// Decode Error Type
// ============================================================================

export type DecodeError = { kind: "invalid_base64"; input: string } | { kind: "invalid_hex"; input: string };

// ============================================================================
// Base64 Encoding/Decoding
// ============================================================================

export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export const fromBase64 = (str: string): Result<Uint8Array, DecodeError> =>
	tryCatch(
		() => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
		(): DecodeError => ({ kind: "invalid_base64", input: str.slice(0, 50) })
	);

// ============================================================================
// Hex Encoding/Decoding
// ============================================================================

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (str: string): Result<Uint8Array, DecodeError> => {
	if (str.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(str)) {
		return err({ kind: "invalid_hex", input: str.slice(0, 50) });
	}
	const matches = str.match(/.{1,2}/g);
	if (!matches) return ok(new Uint8Array(0));
	return ok(new Uint8Array(matches.map(byte => Number.parseInt(byte, 16))));
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

// ============================================================================
// Testing Utilities
// ============================================================================

/** Unwrap a Result, throwing if it's an error. Useful for tests. */
export const unwrap = <T, E>(result: Result<T, E>): T => {
	if (!result.ok) throw new Error(`Unwrap called on error result: ${JSON.stringify(result.error)}`);
	return result.value;
};

/** Unwrap an error from a Result, throwing if it's ok. Useful for tests. */
export const unwrapErr = <T, E>(result: Result<T, E>): E => {
	if (result.ok) throw new Error(`unwrapErr called on ok result: ${JSON.stringify(result.value)}`);
	return result.error;
};
