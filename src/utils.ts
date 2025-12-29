export { err, ok, type Result } from "@f0rbit/corpus";
export {
	match,
	to_nullable,
	unwrap,
	unwrap_err,
	try_catch,
	try_catch_async,
	fetch_result,
	pipe,
	at,
	first,
	last,
	merge_deep,
	type Pipe,
	type FetchError,
	type DeepPartial,
} from "@f0rbit/corpus";

import { type FetchError, type Result, err, ok, pipe, try_catch, try_catch_async } from "@f0rbit/corpus";

// Encryption
const SALT = new TextEncoder().encode("media-timeline-salt");
const IV_LENGTH = 12;
const ITERATIONS = 100000;

export type EncryptionError = { kind: "encryption_failed"; message: string } | { kind: "decryption_failed"; message: string };

const derive_key = (password: string): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]).then(key_material =>
		crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: SALT,
				iterations: ITERATIONS,
				hash: "SHA-256",
			},
			key_material,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		)
	);

export const encrypt = (plaintext: string, key: string): Promise<Result<string, EncryptionError>> =>
	try_catch_async(
		async () => {
			const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
			const derived_key = await derive_key(key);
			const encoded = new TextEncoder().encode(plaintext);
			const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derived_key, encoded);
			const combined = new Uint8Array(iv.length + ciphertext.byteLength);
			combined.set(iv, 0);
			combined.set(new Uint8Array(ciphertext), iv.length);
			return to_base64(combined);
		},
		(e): EncryptionError => ({ kind: "encryption_failed", message: String(e) })
	);

export const decrypt = (ciphertext: string, key: string): Promise<Result<string, EncryptionError>> =>
	pipe(from_base64(ciphertext))
		.map_err((): EncryptionError => ({ kind: "decryption_failed", message: "Invalid base64 ciphertext" }))
		.flat_map(combined =>
			try_catch_async(
				async () => {
					const iv = combined.slice(0, IV_LENGTH);
					const data = combined.slice(IV_LENGTH);
					const derived_key = await derive_key(key);
					const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derived_key, data);
					return new TextDecoder().decode(decrypted);
				},
				(e): EncryptionError => ({ kind: "decryption_failed", message: String(e) })
			)
		)
		.result();

// Date utilities
export const days_ago = (days: number): string => {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date.toISOString();
};

export const hours_ago = (hours: number): string => {
	const date = new Date();
	date.setHours(date.getHours() - hours);
	return date.toISOString();
};

export const minutes_ago = (minutes: number): string => {
	const date = new Date();
	date.setMinutes(date.getMinutes() - minutes);
	return date.toISOString();
};

export const extract_date_key = (timestamp: string): string => new Date(timestamp).toISOString().split("T")[0] ?? "";

// Encoding utilities
export type DecodeError = { kind: "invalid_base64"; input: string } | { kind: "invalid_hex"; input: string };

export const to_base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const from_base64 = (str: string): Result<Uint8Array, DecodeError> =>
	try_catch(
		() => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
		(): DecodeError => ({ kind: "invalid_base64", input: str.slice(0, 50) })
	);

export const to_hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const from_hex = (str: string): Result<Uint8Array, DecodeError> => {
	if (str.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(str)) {
		return err({ kind: "invalid_hex", input: str.slice(0, 50) });
	}
	const matches = str.match(/.{1,2}/g);
	if (!matches) return ok(new Uint8Array(0));
	return ok(new Uint8Array(matches.map(byte => Number.parseInt(byte, 16))));
};

export const hash_sha256 = async (data: string): Promise<Uint8Array> => {
	const encoded = new TextEncoder().encode(data);
	const hash_buffer = await crypto.subtle.digest("SHA-256", encoded);
	return new Uint8Array(hash_buffer);
};

export const hash_api_key = async (key: string): Promise<string> => to_hex(await hash_sha256(key));

// String utilities
export const truncate = (text: string, max_length = 72): string => {
	const first_line = text.split("\n")[0] ?? "";
	const single_line = first_line.replace(/\s+/g, " ").trim();
	return single_line.length <= max_length ? single_line : `${single_line.slice(0, max_length - 3)}...`;
};

// Other utilities
export const uuid = (): string => crypto.randomUUID();
export const random_sha = (): string => Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
