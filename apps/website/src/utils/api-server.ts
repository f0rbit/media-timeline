// Server-side API client for Astro SSR/SSG
// This runs during build and SSR, not in browser

import { MOCK_API_KEY, isDevMode } from "./mock-auth";

const API_BASE_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

type ProfileSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
};

type ProfilesResponse = {
	profiles: ProfileSummary[];
};

export type { ProfileSummary };

/**
 * Fetch profiles from API server-side
 * In dev mode, uses mock auth. In production, would use cookies/session.
 */
export async function fetchProfilesServer(): Promise<ProfileSummary[]> {
	try {
		// In dev mode, use mock auth
		const apiKey = isDevMode() ? MOCK_API_KEY : null;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(`${API_BASE_URL}/api/v1/profiles`, { headers });

		if (!response.ok) {
			console.error("[api-server] Failed to fetch profiles:", response.status);
			return [];
		}

		const data: ProfilesResponse = await response.json();
		return data.profiles;
	} catch (error) {
		console.error("[api-server] Error fetching profiles:", error);
		return [];
	}
}
