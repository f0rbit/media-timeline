import { fromBase64, pipe, type Result, toBase64, tryCatchAsync } from "./utils";

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
