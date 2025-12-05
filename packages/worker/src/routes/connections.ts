import { encrypt, match, ok, pipe } from "@media-timeline/core";
import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { authMiddleware } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", authMiddleware);

type AccountRow = {
	account_id: string;
	platform: string;
	platform_username: string | null;
	is_active: number;
	last_fetched_at: string | null;
	role: string;
	created_at: string;
};

type MembershipRow = {
	role: string;
};

type CreateConnectionBody = {
	platform: string;
	platform_user_id?: string;
	platform_username?: string;
	access_token: string;
	refresh_token?: string;
	token_expires_at?: string;
};

type AddMemberBody = {
	user_id: string;
};

app.get("/", async c => {
	const auth = c.get("auth");

	const { results } = await c.env.DB.prepare(`
      SELECT 
        a.id as account_id,
        a.platform,
        a.platform_username,
        a.is_active,
        a.last_fetched_at,
        am.role,
        am.created_at
      FROM account_members am
      INNER JOIN accounts a ON am.account_id = a.id
      WHERE am.user_id = ?
    `)
		.bind(auth.user_id)
		.all<AccountRow>();

	return c.json({ accounts: results });
});

app.post("/", async c => {
	const auth = c.get("auth");
	const body = await c.req.json<CreateConnectionBody>();

	if (!body.platform || !body.access_token) {
		return c.json({ error: "Bad request", message: "platform and access_token required" }, 400);
	}

	const now = new Date().toISOString();
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	const result = await pipe(encrypt(body.access_token, c.env.ENCRYPTION_KEY))
		.flatMap(encryptedAccessToken =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, c.env.ENCRYPTION_KEY))
						.map(encryptedRefreshToken => ({ encryptedAccessToken, encryptedRefreshToken: encryptedRefreshToken as string | null }))
						.result()
				: Promise.resolve(ok({ encryptedAccessToken, encryptedRefreshToken: null as string | null }))
		)
		.tap(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			await c.env.DB.batch([
				c.env.DB.prepare(`
        INSERT INTO accounts (id, platform, platform_user_id, platform_username, access_token_encrypted, refresh_token_encrypted, token_expires_at, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(accountId, body.platform, body.platform_user_id ?? null, body.platform_username ?? null, encryptedAccessToken, encryptedRefreshToken, body.token_expires_at ?? null, now, now),
				c.env.DB.prepare(`
        INSERT INTO account_members (id, user_id, account_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).bind(memberId, auth.user_id, accountId, now),
			]);
		})
		.result();

	return match(
		result,
		() => c.json({ account_id: accountId, role: "owner" }, 201) as Response,
		() => c.json({ error: "Internal error", message: "Failed to encrypt token" }, 500) as Response
	);
});

app.delete("/:account_id", async c => {
	const auth = c.get("auth");
	const accountId = c.req.param("account_id");

	const membership = await c.env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<MembershipRow>();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can delete accounts" }, 403);
	}

	const now = new Date().toISOString();
	await c.env.DB.prepare("UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?").bind(now, accountId).run();

	return c.json({ deleted: true });
});

app.post("/:account_id/members", async c => {
	const auth = c.get("auth");
	const accountId = c.req.param("account_id");
	const body = await c.req.json<AddMemberBody>();

	if (!body.user_id) {
		return c.json({ error: "Bad request", message: "user_id required" }, 400);
	}

	const membership = await c.env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<MembershipRow>();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
	}

	const existingMember = await c.env.DB.prepare("SELECT id FROM account_members WHERE user_id = ? AND account_id = ?").bind(body.user_id, accountId).first<{ id: string }>();

	if (existingMember) {
		return c.json({ error: "Conflict", message: "User is already a member" }, 409);
	}

	const memberId = crypto.randomUUID();
	const now = new Date().toISOString();

	await c.env.DB.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(memberId, body.user_id, accountId, "member", now).run();

	return c.json({ member_id: memberId, role: "member" }, 201);
});

export { app as connectionRoutes };
