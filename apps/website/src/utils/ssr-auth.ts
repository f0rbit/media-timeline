/**
 * SSR Auth utilities that use direct database access via Cloudflare runtime
 */

import { profiles } from "@media/schema";
import * as schema from "@media/schema/database";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

type D1Database = {
	prepare: (sql: string) => unknown;
};

type CloudflareRuntime = {
	env: {
		DB: D1Database;
		DEVPAD_URL?: string;
	};
};

export type AuthUser = {
	id: string;
	name: string | null;
	email: string | null;
	image_url?: string | null;
};

export type ProfileSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
};

export type SSRAuthResult = {
	authenticated: boolean;
	user: AuthUser | null;
	profiles: ProfileSummary[];
};

/**
 * Get auth status and profiles using direct database access
 */
export async function getSSRAuth(request: Request, runtime: CloudflareRuntime): Promise<SSRAuthResult> {
	// Extract JWT from cookie
	const cookie = request.headers.get("cookie") ?? "";
	const jwtMatch = cookie.match(/devpad_jwt=([^;]+)/);

	if (!jwtMatch) {
		return { authenticated: false, user: null, profiles: [] };
	}

	const jwt = jwtMatch[1];
	const devpadUrl = runtime.env.DEVPAD_URL ?? "https://devpad.tools";

	// Verify JWT with DevPad
	let user: AuthUser | null = null;
	try {
		const res = await fetch(`${devpadUrl}/api/auth/verify`, {
			method: "GET",
			headers: {
				Authorization: `Bearer jwt:${jwt}`,
			},
		});

		if (!res.ok) {
			return { authenticated: false, user: null, profiles: [] };
		}

		const data = (await res.json()) as { authenticated: boolean; user?: AuthUser };
		if (!data.authenticated || !data.user) {
			return { authenticated: false, user: null, profiles: [] };
		}

		user = data.user;
	} catch {
		return { authenticated: false, user: null, profiles: [] };
	}

	// Query profiles directly from D1
	try {
		const db = drizzle(runtime.env.DB as unknown as Parameters<typeof drizzle>[0], { schema });

		const userProfiles = await db
			.select({
				id: profiles.id,
				slug: profiles.slug,
				name: profiles.name,
				description: profiles.description,
				created_at: profiles.created_at,
			})
			.from(profiles)
			.where(eq(profiles.user_id, user.id));

		return {
			authenticated: true,
			user,
			profiles: userProfiles,
		};
	} catch {
		// Still authenticated, just no profiles
		return { authenticated: true, user, profiles: [] };
	}
}
