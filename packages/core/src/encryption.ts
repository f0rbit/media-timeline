const SALT = new TextEncoder().encode("media-timeline-salt");
const IV_LENGTH = 12;
const ITERATIONS = 100000;

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const fromBase64 = (str: string): Uint8Array => Uint8Array.from(atob(str), c => c.charCodeAt(0));

const deriveKey = async (password: string): Promise<CryptoKey> => {
	const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);

	return crypto.subtle.deriveKey(
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
	);
};

export const encrypt = async (plaintext: string, key: string): Promise<string> => {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const derivedKey = await deriveKey(key);
	const encoded = new TextEncoder().encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derivedKey, encoded);

	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), iv.length);

	return toBase64(combined);
};

export const decrypt = async (ciphertext: string, key: string): Promise<string> => {
	const combined = fromBase64(ciphertext);
	const iv = combined.slice(0, IV_LENGTH);
	const data = combined.slice(IV_LENGTH);

	const derivedKey = await deriveKey(key);

	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derivedKey, data);

	return new TextDecoder().decode(decrypted);
};
