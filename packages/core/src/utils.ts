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

export type DecodeError = { kind: "invalid_base64"; input: string } | { kind: "invalid_hex"; input: string };

export const mapResult = <T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> => (result.ok ? result : err(fn(result.error)));

export const flatMapResult = <T, E, U>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> => (result.ok ? fn(result.value) : result);

export const mapResultAsync = async <T, E, U>(result: Result<T, E>, fn: (value: T) => Promise<U>): Promise<Result<U, E>> => (result.ok ? ok(await fn(result.value)) : result);

export const flatMapResultAsync = async <T, E, U>(result: Result<T, E>, fn: (value: T) => Promise<Result<U, E>>): Promise<Result<U, E>> => (result.ok ? fn(result.value) : result);

export const mapErrAsync = async <T, E, F>(result: Result<T, E>, fn: (error: E) => Promise<F>): Promise<Result<T, F>> => (result.ok ? result : err(await fn(result.error)));

export const tapResult = <T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> => {
	if (result.ok) fn(result.value);
	return result;
};

export const tapResultAsync = async <T, E>(result: Result<T, E>, fn: (value: T) => Promise<void>): Promise<Result<T, E>> => {
	if (result.ok) await fn(result.value);
	return result;
};

export const tapErr = <T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> => {
	if (!result.ok) fn(result.error);
	return result;
};

export const tapErrAsync = async <T, E>(result: Result<T, E>, fn: (error: E) => Promise<void>): Promise<Result<T, E>> => {
	if (!result.ok) await fn(result.error);
	return result;
};

export type ResultPipe<T, E> = {
	map: <U>(fn: (value: T) => U) => ResultPipe<U, E>;
	flatMap: <U>(fn: (value: T) => Result<U, E>) => ResultPipe<U, E>;
	mapErr: <F>(fn: (error: E) => F) => ResultPipe<T, F>;
	tap: (fn: (value: T) => void) => ResultPipe<T, E>;
	tapErr: (fn: (error: E) => void) => ResultPipe<T, E>;
	unwrap: () => T;
	unwrapOr: (defaultValue: T) => T;
	result: () => Result<T, E>;
};

export const pipeResult = <T, E>(initial: Result<T, E>): ResultPipe<T, E> => ({
	map: <U>(fn: (value: T) => U) => pipeResult(mapResult(initial, fn)) as ResultPipe<U, E>,
	flatMap: <U>(fn: (value: T) => Result<U, E>) => pipeResult(flatMapResult(initial, fn)) as ResultPipe<U, E>,
	mapErr: <F>(fn: (error: E) => F) => pipeResult(mapErr(initial, fn)) as ResultPipe<T, F>,
	tap: (fn: (value: T) => void) => pipeResult(tapResult(initial, fn)),
	tapErr: (fn: (error: E) => void) => pipeResult(tapErr(initial, fn)),
	unwrap: () => unwrap(initial),
	unwrapOr: (defaultValue: T) => unwrapOr(initial, defaultValue),
	result: () => initial,
});

export type ResultPipeAsync<T, E> = {
	map: <U>(fn: (value: T) => U) => ResultPipeAsync<U, E>;
	mapAsync: <U>(fn: (value: T) => Promise<U>) => ResultPipeAsync<U, E>;
	flatMap: <U>(fn: (value: T) => Result<U, E>) => ResultPipeAsync<U, E>;
	flatMapAsync: <U>(fn: (value: T) => Promise<Result<U, E>>) => ResultPipeAsync<U, E>;
	mapErr: <F>(fn: (error: E) => F) => ResultPipeAsync<T, F>;
	tap: (fn: (value: T) => void) => ResultPipeAsync<T, E>;
	tapAsync: (fn: (value: T) => Promise<void>) => ResultPipeAsync<T, E>;
	tapErr: (fn: (error: E) => void) => ResultPipeAsync<T, E>;
	tapErrAsync: (fn: (error: E) => Promise<void>) => ResultPipeAsync<T, E>;
	unwrap: () => Promise<T>;
	unwrapOr: (defaultValue: T) => Promise<T>;
	result: () => Promise<Result<T, E>>;
};

export const pipeResultAsync = <T, E>(initial: Promise<Result<T, E>>): ResultPipeAsync<T, E> => ({
	map: <U>(fn: (value: T) => U) => pipeResultAsync(initial.then(r => mapResult(r, fn))) as ResultPipeAsync<U, E>,
	mapAsync: <U>(fn: (value: T) => Promise<U>) => pipeResultAsync(initial.then(r => mapResultAsync(r, fn))) as ResultPipeAsync<U, E>,
	flatMap: <U>(fn: (value: T) => Result<U, E>) => pipeResultAsync(initial.then(r => flatMapResult(r, fn))) as ResultPipeAsync<U, E>,
	flatMapAsync: <U>(fn: (value: T) => Promise<Result<U, E>>) => pipeResultAsync(initial.then(r => flatMapResultAsync(r, fn))) as ResultPipeAsync<U, E>,
	mapErr: <F>(fn: (error: E) => F) => pipeResultAsync(initial.then(r => mapErr(r, fn))) as ResultPipeAsync<T, F>,
	tap: (fn: (value: T) => void) => pipeResultAsync(initial.then(r => tapResult(r, fn))),
	tapAsync: (fn: (value: T) => Promise<void>) => pipeResultAsync(initial.then(r => tapResultAsync(r, fn))),
	tapErr: (fn: (error: E) => void) => pipeResultAsync(initial.then(r => tapErr(r, fn))),
	tapErrAsync: (fn: (error: E) => Promise<void>) => pipeResultAsync(initial.then(r => tapErrAsync(r, fn))),
	unwrap: () => initial.then(r => unwrap(r)),
	unwrapOr: (defaultValue: T) => initial.then(r => unwrapOr(r, defaultValue)),
	result: () => initial,
});

export const collectResults = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
	const values: T[] = [];
	for (const result of results) {
		if (!result.ok) return result;
		values.push(result.value);
	}
	return ok(values);
};

export const matchResult = <T, E, R>(result: Result<T, E>, onOk: (value: T) => R, onErr: (error: E) => R): R => (result.ok ? onOk(result.value) : onErr(result.error));

// Convert external/unknown Result-like types to our Result type
export const fromExternalResult = <T, E>(result: { ok: boolean; value?: T; error?: unknown }, onErr: E): Result<T, E> => (result.ok ? ok(result.value as T) : err(onErr));

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

export type FetchErrorType = { type: "network"; cause: unknown } | { type: "http"; status: number; statusText: string };

export const fetchResult = async <T, E>(
	input: string | URL | Request,
	init: RequestInit | undefined,
	onError: (e: FetchErrorType) => E,
	parseBody: (response: Response) => Promise<T> = r => r.json() as Promise<T>
): Promise<Result<T, E>> => {
	try {
		const response = await fetch(input, init);
		if (!response.ok) {
			return err(onError({ type: "http", status: response.status, statusText: response.statusText }));
		}
		const body = await parseBody(response);
		return ok(body);
	} catch (e) {
		return err(onError({ type: "network", cause: e }));
	}
};

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
