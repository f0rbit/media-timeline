// Re-export providers, normalizers, and memory providers
export { GitHubProvider, type GitHubFetchResult, type GitHubProviderConfig } from "./github";
export { GitHubMemoryProvider, type GitHubMemoryConfig } from "./github-memory";
export { BlueskyProvider, normalizeBluesky, BlueskyMemoryProvider, type BlueskyProviderConfig } from "./bluesky";
export { YouTubeProvider, normalizeYouTube, YouTubeMemoryProvider, type YouTubeProviderConfig } from "./youtube";
export { DevpadProvider, normalizeDevpad, DevpadMemoryProvider } from "./devpad";
export * from "./reddit";
export * from "./reddit-memory";

// Re-export types
export * from "./types";
export type { MemoryProviderControls, MemoryProviderState, SimulationConfig } from "./memory-base";
export { createMemoryProviderState, simulateErrors, createMemoryProviderControlMethods } from "./memory-base";

// Re-export GitHub normalizers
// normalizeGitHubLegacy is for the old GitHubRaw format (tests, legacy snapshots)
// cron.ts uses normalizeGitHub from timeline-github for new multi-store format
export { normalizeGitHubLegacy as normalizeGitHub } from "../timeline-github";

// Factory function for creating providers (non-GitHub only)
import { err, type Result } from "../utils";
import type { Provider, ProviderError, ProviderFactory } from "./types";
import { BlueskyProvider } from "./bluesky";
import { YouTubeProvider } from "./youtube";
import { DevpadProvider } from "./devpad";

export const defaultProviderFactory: ProviderFactory = {
	async create(platform, platformUserId, token) {
		const provider = providerForPlatform(platform, platformUserId);
		if (!provider) return err({ kind: "unknown_platform", platform });
		return provider.fetch(token) as Promise<Result<Record<string, unknown>, ProviderError>>;
	},
};

const providerForPlatform = (platform: string, platformUserId: string | null): Provider<unknown> | null => {
	switch (platform) {
		case "bluesky":
			return new BlueskyProvider({ actor: platformUserId ?? "" });
		case "youtube":
			return new YouTubeProvider({ playlist_id: platformUserId ?? "" });
		case "devpad":
			return new DevpadProvider();
		default:
			return null;
	}
};
