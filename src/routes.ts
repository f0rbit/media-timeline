import { type CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "./auth";
import type { Bindings } from "./bindings";
import type { AppContext } from "./infrastructure";
import { accountMembers, accounts, accountSettings, DateGroupSchema } from "./schema";
import { createRawStore, createTimelineStore, RawDataSchema, type CorpusError } from "./storage";
import { encrypt, err, match, ok, pipe, type Result } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

const TimelineDataSchema = z.object({
	groups: z.array(DateGroupSchema),
});

const SnapshotMetaSchema = z
	.object({
		version: z.union([z.string(), z.number()]),
		created_at: z.union([z.string(), z.date()]),
	})
	.passthrough();

const TimelineSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: TimelineDataSchema,
});

const RawSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: RawDataSchema,
});

type TimelineSnapshot = z.infer<typeof TimelineSnapshotSchema>;
type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

type TimelineRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };
type RawRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };

const CreateConnectionBodySchema = z.object({
	platform: z.enum(["github", "bluesky", "youtube", "devpad"]),
	access_token: z.string().min(1),
	refresh_token: z.string().optional(),
	platform_user_id: z.string().optional(),
	platform_username: z.string().optional(),
	token_expires_at: z.string().optional(),
});

const AddMemberBodySchema = z.object({
	user_id: z.string().min(1),
});

const UpdateConnectionStatusSchema = z.object({
	is_active: z.boolean(),
});

const UpdateSettingsBodySchema = z.object({
	settings: z.record(z.string(), z.unknown()),
});

export const timelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

timelineRoutes.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user timelines" }, 403);
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	// Fetch GitHub usernames for repo owner stripping
	const githubAccounts = await ctx.db
		.select({ platform_username: accounts.platform_username })
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, userId), eq(accounts.platform, "github"), eq(accounts.is_active, true)));

	const githubUsernames = githubAccounts.map(a => a.platform_username).filter((u): u is string => u !== null);

	const result = await pipe(createTimelineStore(ctx.backend, userId))
		.mapErr((e): TimelineRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, TimelineRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
		})
		.flatMap((raw): Result<TimelineSnapshot, TimelineRouteError> => {
			const parsed = TimelineSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => {
			const filteredGroups = snapshot.data.groups.filter(group => {
				if (from && group.date < from) return false;
				if (to && group.date > to) return false;
				return true;
			});
			return {
				meta: { ...snapshot.meta, github_usernames: githubUsernames },
				data: { ...snapshot.data, groups: filteredGroups },
			};
		})
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			if (error.kind === "store_not_found") {
				return c.json({ error: "Internal error", message: "Failed to create timeline store" }, 500) as Response;
			}
			if (error.kind === "validation_error") {
				return c.json({ error: "Internal error", message: "Invalid timeline data format" }, 500) as Response;
			}
			if (error.kind === "not_found") {
				return c.json({ error: "Not found", message: "No timeline data available" }, 404) as Response;
			}
			return c.json({ error: "Internal error", message: "Unexpected error" }, 500) as Response;
		}
	);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user data" }, 403);
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return c.json({ error: "Bad request", message: "account_id query parameter required" }, 400);
	}

	const result = await pipe(createRawStore(ctx.backend, platform, accountId))
		.mapErr((e): RawRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
		})
		.flatMap((raw): Result<RawSnapshot, RawRouteError> => {
			const parsed = RawSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => ({ meta: snapshot.meta, data: snapshot.data }))
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			if (error.kind === "store_not_found") {
				return c.json({ error: "Internal error", message: "Failed to create raw store" }, 500) as Response;
			}
			if (error.kind === "validation_error") {
				return c.json({ error: "Internal error", message: "Invalid raw data format" }, 500) as Response;
			}
			if (error.kind === "not_found") {
				return c.json({ error: "Not found", message: "No raw data available for this account" }, 404) as Response;
			}
			return c.json({ error: "Internal error", message: "Unexpected error" }, 500) as Response;
		}
	);
});

export const connectionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

connectionRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const includeSettings = c.req.query("include_settings") === "true";

	const results = await ctx.db
		.select({
			account_id: accounts.id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			is_active: accounts.is_active,
			last_fetched_at: accounts.last_fetched_at,
			role: accountMembers.role,
			created_at: accountMembers.created_at,
		})
		.from(accountMembers)
		.innerJoin(accounts, eq(accountMembers.account_id, accounts.id))
		.where(eq(accountMembers.user_id, auth.user_id));

	if (!includeSettings) {
		return c.json({ accounts: results });
	}

	const accountsWithSettings = await Promise.all(
		results.map(async account => {
			const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, account.account_id));

			const settingsMap = settings.reduce(
				(acc, s) => {
					acc[s.setting_key] = JSON.parse(s.setting_value);
					return acc;
				},
				{} as Record<string, unknown>
			);

			return { ...account, settings: settingsMap };
		})
	);

	return c.json({ accounts: accountsWithSettings });
});

connectionRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const parseResult = CreateConnectionBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const now = new Date().toISOString();
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	const result = await pipe(encrypt(body.access_token, ctx.encryptionKey))
		.flatMap(encryptedAccessToken =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, ctx.encryptionKey))
						.map(encryptedRefreshToken => ({ encryptedAccessToken, encryptedRefreshToken: encryptedRefreshToken as string | null }))
						.result()
				: Promise.resolve(ok({ encryptedAccessToken, encryptedRefreshToken: null as string | null }))
		)
		.tap(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			await ctx.db.batch([
				ctx.db.insert(accounts).values({
					id: accountId,
					platform: body.platform,
					platform_user_id: body.platform_user_id ?? null,
					platform_username: body.platform_username ?? null,
					access_token_encrypted: encryptedAccessToken,
					refresh_token_encrypted: encryptedRefreshToken,
					token_expires_at: body.token_expires_at ?? null,
					is_active: true,
					created_at: now,
					updated_at: now,
				}),
				ctx.db.insert(accountMembers).values({
					id: memberId,
					user_id: auth.user_id,
					account_id: accountId,
					role: "owner",
					created_at: now,
				}),
			]);
		})
		.result();

	return match(
		result,
		() => c.json({ account_id: accountId, role: "owner" }, 201) as Response,
		() => c.json({ error: "Internal error", message: "Failed to encrypt token" }, 500) as Response
	);
});

connectionRoutes.delete("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can delete accounts" }, 403);
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: false, updated_at: now }).where(eq(accounts.id, accountId));

	return c.json({ deleted: true });
});

connectionRoutes.post("/:account_id/members", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = AddMemberBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
	}

	const existingMember = await ctx.db
		.select({ id: accountMembers.id })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, body.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (existingMember) {
		return c.json({ error: "Conflict", message: "User is already a member" }, 409);
	}

	const memberId = crypto.randomUUID();
	const now = new Date().toISOString();

	await ctx.db.insert(accountMembers).values({
		id: memberId,
		user_id: body.user_id,
		account_id: accountId,
		role: "member",
		created_at: now,
	});

	return c.json({ member_id: memberId, role: "member" }, 201);
});

connectionRoutes.post("/:account_id/refresh", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	console.log("[refresh] Refresh endpoint hit with account_id:", accountId);
	console.log("[refresh] User:", auth.user_id);

	const accountWithUser = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			is_active: accounts.is_active,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
		.get();

	console.log(
		"[refresh] Account data from DB:",
		accountWithUser
			? {
					id: accountWithUser.id,
					platform: accountWithUser.platform,
					platform_user_id: accountWithUser.platform_user_id,
					is_active: accountWithUser.is_active,
					user_id: accountWithUser.user_id,
					hasAccessToken: !!accountWithUser.access_token_encrypted,
					hasRefreshToken: !!accountWithUser.refresh_token_encrypted,
				}
			: "null"
	);

	if (!accountWithUser) {
		console.log("[refresh] Account not found in DB");
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (!accountWithUser.is_active) {
		console.log("[refresh] Account is not active");
		return c.json({ error: "Bad request", message: "Account is not active" }, 400);
	}

	console.log("[refresh] Before calling processAccount");
	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const snapshot = await processAccount(ctx, accountWithUser);

	console.log("[refresh] processAccount result:", snapshot ? "snapshot created" : "null");

	if (snapshot) {
		console.log("[refresh] Generating timeline for user:", auth.user_id);
		const allUserAccounts = await ctx.db
			.select({
				id: accounts.id,
				platform: accounts.platform,
				platform_user_id: accounts.platform_user_id,
				access_token_encrypted: accounts.access_token_encrypted,
				refresh_token_encrypted: accounts.refresh_token_encrypted,
				user_id: accountMembers.user_id,
			})
			.from(accounts)
			.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
			.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

		const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
		console.log("[refresh] Gathered snapshots:", snapshots.length);
		await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
		console.log("[refresh] Timeline generated");

		return c.json({ status: "refreshed", account_id: accountId });
	}

	return c.json({ status: "skipped", message: "Rate limited or no changes" });
});

connectionRoutes.post("/refresh-all", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	console.log("[refresh-all] Refresh-all endpoint hit for user:", auth.user_id);

	const userAccounts = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

	console.log(
		"[refresh-all] Found accounts:",
		userAccounts.map(a => ({
			id: a.id,
			platform: a.platform,
			platform_user_id: a.platform_user_id,
		}))
	);

	if (userAccounts.length === 0) {
		console.log("[refresh-all] No accounts found");
		return c.json({ status: "completed", succeeded: 0, failed: 0, total: 0 });
	}

	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	let succeeded = 0;
	let failed = 0;

	for (const account of userAccounts) {
		console.log("[refresh-all] Processing account:", { id: account.id, platform: account.platform });
		try {
			const snapshot = await processAccount(ctx, account);
			console.log("[refresh-all] Account result:", { id: account.id, success: !!snapshot });
			if (snapshot) {
				succeeded++;
			}
		} catch (e) {
			console.error(`[refresh-all] Failed to refresh account ${account.id}:`, e);
			failed++;
		}
	}

	if (succeeded > 0) {
		console.log("[refresh-all] Generating timeline for user:", auth.user_id);
		const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
		console.log("[refresh-all] Gathered snapshots:", snapshots.length);
		await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
		console.log("[refresh-all] Timeline generated");
	}

	console.log("[refresh-all] Final result:", { succeeded, failed, total: userAccounts.length });

	return c.json({
		status: "completed",
		succeeded,
		failed,
		total: userAccounts.length,
	});
});

connectionRoutes.patch("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = UpdateConnectionStatusSchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: body.is_active, updated_at: now }).where(eq(accounts.id, accountId));

	const updated = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId)).get();

	return c.json({ success: true, connection: updated });
});

connectionRoutes.get("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const membership = await ctx.db
		.select()
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, accountId));

	const settingsMap = settings.reduce(
		(acc, s) => {
			acc[s.setting_key] = JSON.parse(s.setting_value);
			return acc;
		},
		{} as Record<string, unknown>
	);

	return c.json({ settings: settingsMap });
});

connectionRoutes.put("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = UpdateSettingsBodySchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can update settings" }, 403);
	}

	const now = new Date().toISOString();

	for (const [key, value] of Object.entries(body.settings)) {
		const existing = await ctx.db
			.select()
			.from(accountSettings)
			.where(and(eq(accountSettings.account_id, accountId), eq(accountSettings.setting_key, key)))
			.get();

		if (existing) {
			await ctx.db
				.update(accountSettings)
				.set({ setting_value: JSON.stringify(value), updated_at: now })
				.where(eq(accountSettings.id, existing.id));
		} else {
			await ctx.db.insert(accountSettings).values({
				id: crypto.randomUUID(),
				account_id: accountId,
				setting_key: key,
				setting_value: JSON.stringify(value),
				created_at: now,
				updated_at: now,
			});
		}
	}

	return c.json({ updated: true });
});

type GitHubRepoInfo = {
	name: string;
	commit_count: number;
};

const extractReposFromGitHubData = (data: unknown): GitHubRepoInfo[] => {
	const events = (data as Record<string, unknown>)?.events ?? [];
	if (!Array.isArray(events)) return [];

	const repoMap = new Map<string, number>();

	for (const event of events) {
		const e = event as Record<string, unknown>;
		if (e.type === "PushEvent" && (e.repo as Record<string, unknown>)?.name) {
			const repoName = (e.repo as Record<string, unknown>).name as string;
			const current = repoMap.get(repoName) ?? 0;
			const payload = e.payload as Record<string, unknown> | undefined;
			const commits = Array.isArray(payload?.commits) ? payload.commits.length : 1;
			repoMap.set(repoName, current + commits);
		}
	}

	return Array.from(repoMap.entries())
		.map(([name, commit_count]) => ({ name, commit_count }))
		.sort((a, b) => b.commit_count - a.commit_count);
};

connectionRoutes.get("/:account_id/repos", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const account = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
		.get();

	if (!account) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (account.platform !== "github") {
		return c.json({ error: "Bad request", message: "Not a GitHub account" }, 400);
	}

	const rawStoreResult = createRawStore(ctx.backend, "github", accountId);
	if (!rawStoreResult.ok) {
		return c.json({ repos: [] });
	}

	const latest = await rawStoreResult.value.store.get_latest();
	if (!latest.ok) {
		return c.json({ repos: [] });
	}

	const repos = extractReposFromGitHubData(latest.value.data);

	return c.json({ repos });
});
