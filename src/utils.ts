export { err, ok, type Result } from "@f0rbit/corpus";

import { type Result, err, ok } from "@f0rbit/corpus";

export const to_nullable = <T, E>(result: Result<T, E>): T | null => (result.ok ? result.value : null);
export const to_fallback = <T, E>(result: Result<T, E>, fallback: T): T => (result.ok ? result.value : fallback);
export const null_on = <T, E>(fn: () => Result<T, E>): T | null => to_nullable(fn());
export const fallback_on = <T, E>(fn: () => Result<T, E>, fallback: T): T => to_fallback(fn(), fallback);
export const format_error = <E>(error: E): string => (typeof error === "object" && error !== null ? JSON.stringify(error) : String(error));

export const match = <T, E, R>(result: Result<T, E>, onOk: (value: T) => R, onErr: (error: E) => R): R => {
	if (result.ok) return onOk(result.value);
	return onErr(result.error);
};

export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => (result.ok ? result.value : defaultValue);

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

type MaybePromise<T> = T | Promise<T>;

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

export const pipe = <T, E>(initial: MaybePromise<Result<T, E>>): Pipe<T, E> => createPipe(Promise.resolve(initial));
pipe.ok = <T>(value: T): Pipe<T, never> => pipe(ok(value));
pipe.err = <E>(error: E): Pipe<never, E> => pipe(err(error));
pipe.try = <T, E>(fn: () => Promise<T>, onError: (e: unknown) => E): Pipe<T, E> => pipe(tryCatchAsync(fn, onError));
pipe.fetch = <T, E>(input: string | URL | Request, init: RequestInit | undefined, onError: (e: FetchError) => E, parseBody?: (response: Response) => Promise<T>): Pipe<T, E> => pipe(fetchResult(input, init, onError, parseBody));

// Encryption
const SALT = new TextEncoder().encode("media-timeline-salt");
const IV_LENGTH = 12;
const ITERATIONS = 100000;

export type EncryptionError = { kind: "encryption_failed"; message: string } | { kind: "decryption_failed"; message: string };

const deriveKey = (password: string): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]).then(keyMaterial =>
		crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: SALT,
				iterations: ITERATIONS,
				hash: "SHA-256",
			},
			keyMaterial,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		)
	);

export const encrypt = (plaintext: string, key: string): Promise<Result<string, EncryptionError>> =>
	tryCatchAsync(
		async () => {
			const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
			const derivedKey = await deriveKey(key);
			const encoded = new TextEncoder().encode(plaintext);
			const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derivedKey, encoded);
			const combined = new Uint8Array(iv.length + ciphertext.byteLength);
			combined.set(iv, 0);
			combined.set(new Uint8Array(ciphertext), iv.length);
			return toBase64(combined);
		},
		(e): EncryptionError => ({ kind: "encryption_failed", message: String(e) })
	);

export const decrypt = (ciphertext: string, key: string): Promise<Result<string, EncryptionError>> =>
	pipe(fromBase64(ciphertext))
		.mapErr((): EncryptionError => ({ kind: "decryption_failed", message: "Invalid base64 ciphertext" }))
		.flatMap(combined =>
			tryCatchAsync(
				async () => {
					const iv = combined.slice(0, IV_LENGTH);
					const data = combined.slice(IV_LENGTH);
					const derivedKey = await deriveKey(key);
					const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derivedKey, data);
					return new TextDecoder().decode(decrypted);
				},
				(e): EncryptionError => ({ kind: "decryption_failed", message: String(e) })
			)
		)
		.result();

// Date utilities
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

export const extractDateKey = (timestamp: string): string => new Date(timestamp).toISOString().split("T")[0] ?? "";

// Encoding utilities
export type DecodeError = { kind: "invalid_base64"; input: string } | { kind: "invalid_hex"; input: string };

export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (str: string): Result<Uint8Array, DecodeError> =>
	tryCatch(
		() => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
		(): DecodeError => ({ kind: "invalid_base64", input: str.slice(0, 50) })
	);

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (str: string): Result<Uint8Array, DecodeError> => {
	if (str.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(str)) {
		return err({ kind: "invalid_hex", input: str.slice(0, 50) });
	}
	const matches = str.match(/.{1,2}/g);
	if (!matches) return ok(new Uint8Array(0));
	return ok(new Uint8Array(matches.map(byte => Number.parseInt(byte, 16))));
};

export const hashSha256 = async (data: string): Promise<Uint8Array> => {
	const encoded = new TextEncoder().encode(data);
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
	return new Uint8Array(hashBuffer);
};

export const hashApiKey = async (key: string): Promise<string> => toHex(await hashSha256(key));

// Merge utilities
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

// Array access utilities
export const at = <T>(array: readonly T[], index: number): Result<T, { kind: "index_out_of_bounds"; index: number; length: number }> => {
	if (index < 0 || index >= array.length) {
		return err({ kind: "index_out_of_bounds", index, length: array.length });
	}
	const element = array[index];
	if (element === undefined) {
		return err({ kind: "index_out_of_bounds", index, length: array.length });
	}
	return ok(element);
};

export const first = <T>(array: readonly T[]): Result<T, { kind: "empty_array" }> => {
	if (array.length === 0) {
		return err({ kind: "empty_array" });
	}
	return ok(array[0] as T);
};

export const last = <T>(array: readonly T[]): Result<T, { kind: "empty_array" }> => {
	if (array.length === 0) {
		return err({ kind: "empty_array" });
	}
	return ok(array[array.length - 1] as T);
};

// String utilities
/**
 * Truncate text to a maximum length, taking only the first line and replacing whitespace.
 */
export const truncate = (text: string, maxLength = 72): string => {
	const firstLine = text.split("\n")[0] ?? "";
	const singleLine = firstLine.replace(/\s+/g, " ").trim();
	return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
};

// Other utilities
export const uuid = (): string => crypto.randomUUID();
export const randomSha = (): string => Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// Test utilities
export const unwrap = <T, E>(result: Result<T, E>): T => {
	if (!result.ok) throw new Error(`Unwrap called on error result: ${JSON.stringify(result.error)}`);
	return result.value;
};

export const unwrapErr = <T, E>(result: Result<T, E>): E => {
	if (result.ok) throw new Error(`unwrapErr called on ok result: ${JSON.stringify(result.value)}`);
	return result.error;
};
