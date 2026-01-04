import type { FetchError, Result } from "@f0rbit/corpus";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AuthContext } from "../auth";
import type { Bindings } from "../bindings";
import type { AppContext } from "../infrastructure";
import {
	type OAuthCallbackConfig,
	createOAuthCallback,
	decodeOAuthState,
	encodeOAuthState,
	exchangeCodeForTokens,
	fetchOAuthUserProfile,
	getFrontendUrl,
	redirectWithError,
	redirectWithSuccess,
	upsertOAuthAccount,
	validateOAuthQueryKeyAndProfile,
} from "../oauth-helpers";
import { getCredentials, markCredentialsVerified } from "../services/credentials";
import { pipe } from "../utils";

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

const getContext = (c: { get: (k: "appContext") => AppContext }): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

type OAuthTokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

const redditOAuthConfig: OAuthCallbackConfig = {
	platform: "reddit",
	tokenUrl: "https://www.reddit.com/api/v1/access_token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenHeaders: { "User-Agent": "media-timeline/2.0.0" },
	tokenBody: (code, redirectUri) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://oauth.reddit.com/api/v1/me", {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: string; name: string };
		return { id: data.id, username: data.name };
	},
	getSecrets: env => ({ clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }),
};

const twitterOAuthConfig: OAuthCallbackConfig<{ code_verifier: string }> = {
	platform: "twitter",
	tokenUrl: "https://api.twitter.com/2/oauth2/token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenBody: (code, redirectUri, state) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: state.code_verifier,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.twitter.com/2/users/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { data: { id: string; username: string } };
		return { id: data.data.id, username: data.data.username };
	},
	getSecrets: env => ({ clientId: env.TWITTER_CLIENT_ID, clientSecret: env.TWITTER_CLIENT_SECRET }),
	stateKeys: ["code_verifier"],
};

const githubOAuthConfig: OAuthCallbackConfig = {
	platform: "github",
	tokenUrl: "https://github.com/login/oauth/access_token",
	tokenAuthHeader: () => "",
	tokenHeaders: { Accept: "application/json" },
	tokenBody: (code, redirectUri) =>
		new URLSearchParams({
			client_id: "",
			client_secret: "",
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: number; login: string };
		return { id: String(data.id), username: data.login };
	},
	getSecrets: env => ({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }),
};

export const refreshRedditToken = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
			"https://www.reddit.com/api/v1/access_token",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
					"User-Agent": "media-timeline/2.0.0",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				}),
			},
			e => e
		)
		.result();

export const refreshTwitterToken = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
			"https://api.twitter.com/2/oauth2/token",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: clientId,
				}),
			},
			e => e
		)
		.result();

const base64UrlEncode = (buffer: Uint8Array): string => {
	return btoa(String.fromCharCode(...buffer))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

const generateCodeVerifier = (): string => {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return base64UrlEncode(new Uint8Array(hash));
};

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

authRoutes.get("/reddit", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "reddit");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	// Check for BYO credentials first
	const byoCredentials = await getCredentials(ctx, profile_id, "reddit");

	// Use BYO credentials if available, otherwise fall back to env
	const clientId = byoCredentials?.clientId ?? c.env.REDDIT_CLIENT_ID;

	if (!clientId) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_no_credentials`);
	}

	const redirectUri = `${c.env.API_URL || "http://localhost:8787"}/media/api/auth/reddit/callback`;

	// Include byo flag in state so callback knows to use BYO credentials
	const state = encodeOAuthState(user_id, profile_id, {
		byo: !!byoCredentials,
	});

	const authUrl = new URL("https://www.reddit.com/api/v1/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("duration", "permanent");
	authUrl.searchParams.set("scope", "identity,history,read");

	return c.redirect(authUrl.toString());
});

authRoutes.get("/reddit/callback", async c => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");

	const code = c.req.query("code");
	const error = c.req.query("error");
	const stateParam = c.req.query("state");

	if (error) {
		console.error("[reddit-oauth] Authorization denied:", error);
		return redirectWithError(c, "reddit", "auth_denied");
	}

	if (!code) {
		return redirectWithError(c, "reddit", "no_code");
	}

	// Decode state to check for BYO flag
	const stateResult = decodeOAuthState<{ byo?: boolean }>(c, stateParam, "reddit");
	if (!stateResult.ok) return stateResult.error;
	const stateData = stateResult.value;

	// Get credentials - BYO or env
	let clientId: string | undefined;
	let clientSecret: string | undefined;

	if (stateData.byo) {
		const byoCredentials = await getCredentials(ctx, stateData.profile_id, "reddit");
		if (!byoCredentials) {
			return redirectWithError(c, "reddit", "credentials_not_found");
		}
		clientId = byoCredentials.clientId;
		clientSecret = byoCredentials.clientSecret;
	} else {
		clientId = c.env.REDDIT_CLIENT_ID;
		clientSecret = c.env.REDDIT_CLIENT_SECRET;
	}

	if (!clientId || !clientSecret) {
		return redirectWithError(c, "reddit", "not_configured");
	}

	const redirectUri = `${c.env.API_URL || "http://localhost:8787"}/media/api/auth/reddit/callback`;

	// Exchange code for tokens
	const tokenResult = await exchangeCodeForTokens(code, redirectUri, clientId, clientSecret, redditOAuthConfig as OAuthCallbackConfig<{ byo?: boolean }>, stateData);

	if (!tokenResult.ok) {
		console.error("[reddit-oauth] Token exchange failed:", tokenResult.error.message);
		return redirectWithError(c, "reddit", "token_failed");
	}

	// Fetch user info
	const userResult = await fetchOAuthUserProfile(tokenResult.value.access_token, redditOAuthConfig as OAuthCallbackConfig<{ byo?: boolean }>);
	if (!userResult.ok) {
		console.error("[reddit-oauth] User fetch failed:", userResult.error.message);
		return redirectWithError(c, "reddit", "user_failed");
	}

	// Save account
	const saveResult = await upsertOAuthAccount(ctx.db, ctx.encryptionKey, stateData.profile_id, "reddit", userResult.value, tokenResult.value);

	if (!saveResult.ok) {
		console.error("[reddit-oauth] Save failed:", saveResult.error.message);
		return redirectWithError(c, "reddit", "save_failed");
	}

	// If BYO credentials were used, mark them as verified
	if (stateData.byo) {
		await markCredentialsVerified(ctx, stateData.profile_id, "reddit");
	}

	return redirectWithSuccess(c, "reddit");
});

authRoutes.get("/twitter", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "twitter");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.env.TWITTER_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Twitter OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.API_URL || "http://localhost:8787"}/media/api/auth/twitter/callback`;

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = encodeOAuthState(user_id, profile_id, { code_verifier: codeVerifier });

	const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "tweet.read users.read offline.access");
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	return c.redirect(authUrl.toString());
});

authRoutes.get("/twitter/callback", createOAuthCallback(twitterOAuthConfig));

authRoutes.get("/github", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "github");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.env.GITHUB_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "GitHub OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.API_URL || "http://localhost:8787"}/media/api/auth/github/callback`;
	const state = encodeOAuthState(user_id, profile_id);

	const authUrl = new URL("https://github.com/login/oauth/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "read:user repo");
	authUrl.searchParams.set("state", state);

	return c.redirect(authUrl.toString());
});

authRoutes.get("/github/callback", async c => {
	const ctx = getContext(c);
	if (!ctx) throw new Error("AppContext not set");

	const clientId = c.env.GITHUB_CLIENT_ID;
	const clientSecret = c.env.GITHUB_CLIENT_SECRET;

	const configWithSecrets: OAuthCallbackConfig = {
		...githubOAuthConfig,
		tokenBody: (code, redirectUri) =>
			new URLSearchParams({
				client_id: clientId || "",
				client_secret: clientSecret || "",
				code,
				redirect_uri: redirectUri,
			}),
	};

	return createOAuthCallback(configWithSecrets)(c);
});

authRoutes.get("/login", c => {
	const origin = new URL(c.req.url).origin;
	const isPreview = !origin.includes("devpad.tools");
	const devpadUrl = c.env.DEVPAD_URL || "https://devpad.tools";

	const params = new URLSearchParams({
		return_to: `${origin}/media/api/auth/callback`,
		...(isPreview && { mode: "jwt" }),
	});

	return c.redirect(`${devpadUrl}/api/auth/login?${params}`);
});

authRoutes.get("/callback", c => {
	const token = c.req.query("token");
	if (!token) {
		return c.redirect("/?error=no_token");
	}

	setCookie(c, "devpad_jwt", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 7,
	});

	return c.redirect("/dashboard");
});

authRoutes.get("/logout", c => {
	deleteCookie(c, "devpad_jwt");
	deleteCookie(c, "devpad_session");
	deleteCookie(c, "session");
	return c.redirect("/");
});
