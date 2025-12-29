// Shared mock auth configuration - single source of truth for dev mode

export const MOCK_USER_ID = "mock-user-001";
export const MOCK_API_KEY = `mt_dev_${btoa(MOCK_USER_ID).slice(0, 24)}`;

/**
 * Detect dev mode - works in both server and client contexts
 */
export function isDevMode(): boolean {
	// In Vite/Astro context
	if (typeof import.meta.env?.DEV === "boolean") {
		return import.meta.env.DEV;
	}
	// Client-side fallback: check hostname
	if (typeof window !== "undefined") {
		return window.location.hostname === "localhost";
	}
	return false;
}
