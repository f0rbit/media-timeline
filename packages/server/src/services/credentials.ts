import { type Platform, platformCredentials } from "@media/schema";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../infrastructure/context";
import { decrypt, encrypt, uuid } from "../utils";

export type CredentialInput = {
	profileId: string;
	platform: Platform;
	clientId: string;
	clientSecret: string;
	redirectUri?: string;
	metadata?: Record<string, unknown>;
};

export type DecryptedCredentials = {
	id: string;
	profileId: string;
	platform: Platform;
	clientId: string;
	clientSecret: string;
	redirectUri: string | null;
	metadata: Record<string, unknown> | null;
	isVerified: boolean;
};

/**
 * Save or update platform credentials for a profile.
 * The client_secret is encrypted before storage.
 */
export const saveCredentials = async (ctx: AppContext, input: CredentialInput): Promise<{ id: string }> => {
	const { profileId, platform, clientId, clientSecret, redirectUri, metadata } = input;

	const encryptResult = await encrypt(clientSecret, ctx.encryptionKey);
	if (!encryptResult.ok) {
		throw new Error("Failed to encrypt client secret");
	}

	const now = new Date().toISOString();

	const existing = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (existing) {
		await ctx.db
			.update(platformCredentials)
			.set({
				client_id: clientId,
				client_secret_encrypted: encryptResult.value,
				redirect_uri: redirectUri ?? null,
				metadata: metadata ? JSON.stringify(metadata) : null,
				is_verified: false,
				updated_at: now,
			})
			.where(eq(platformCredentials.id, existing.id));

		return { id: existing.id };
	}

	const id = uuid();
	await ctx.db.insert(platformCredentials).values({
		id,
		profile_id: profileId,
		platform,
		client_id: clientId,
		client_secret_encrypted: encryptResult.value,
		redirect_uri: redirectUri ?? null,
		metadata: metadata ? JSON.stringify(metadata) : null,
		is_verified: false,
		created_at: now,
		updated_at: now,
	});

	return { id };
};

/**
 * Get decrypted credentials for a profile and platform.
 * Returns null if no credentials exist.
 */
export const getCredentials = async (ctx: AppContext, profileId: string, platform: Platform): Promise<DecryptedCredentials | null> => {
	const credential = await ctx.db
		.select()
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (!credential) {
		return null;
	}

	const decryptResult = await decrypt(credential.client_secret_encrypted, ctx.encryptionKey);
	if (!decryptResult.ok) {
		throw new Error("Failed to decrypt client secret");
	}

	return {
		id: credential.id,
		profileId: credential.profile_id,
		platform: credential.platform as Platform,
		clientId: credential.client_id,
		clientSecret: decryptResult.value,
		redirectUri: credential.redirect_uri,
		metadata: credential.metadata ? JSON.parse(credential.metadata) : null,
		isVerified: credential.is_verified ?? false,
	};
};

/**
 * Delete credentials for a profile and platform.
 */
export const deleteCredentials = async (ctx: AppContext, profileId: string, platform: Platform): Promise<boolean> => {
	const existing = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (!existing) {
		return false;
	}

	await ctx.db.delete(platformCredentials).where(eq(platformCredentials.id, existing.id));

	return true;
};

/**
 * Mark credentials as verified (called after successful OAuth flow).
 */
export const markCredentialsVerified = async (ctx: AppContext, profileId: string, platform: Platform): Promise<void> => {
	await ctx.db
		.update(platformCredentials)
		.set({
			is_verified: true,
			updated_at: new Date().toISOString(),
		})
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)));
};

/**
 * Check if credentials exist for a profile and platform (without decrypting).
 */
export const hasCredentials = async (ctx: AppContext, profileId: string, platform: Platform): Promise<boolean> => {
	const credential = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	return !!credential;
};
