// Re-export providers, normalizers, and memory providers

// Re-export GitHub normalizers
// normalizeGitHubLegacy is for the old GitHubRaw format (tests, legacy snapshots)
// cron.ts uses normalizeGitHub from timeline-github for new multi-store format
export { normalizeGitHubLegacy as normalizeGitHub } from "../timeline-github";
export { BlueskyMemoryProvider, BlueskyProvider, type BlueskyProviderConfig, normalizeBluesky } from "./bluesky";
export { DevpadMemoryProvider, DevpadProvider, normalizeDevpad } from "./devpad";
export { type GitHubFetchResult, GitHubProvider, type GitHubProviderConfig } from "./github";
export { type GitHubMemoryConfig, GitHubMemoryProvider } from "./github-memory";
export type { MemoryProviderControls, MemoryProviderState, SimulationConfig } from "./memory-base";
export { BaseMemoryProvider, createMemoryProviderControlMethods, createMemoryProviderState, simulateErrors } from "./memory-base";
export * from "./reddit";
export * from "./reddit-memory";
export * from "./twitter";
export * from "./twitter-memory";
// Re-export types
export * from "./types";
export { normalizeYouTube, YouTubeMemoryProvider, YouTubeProvider, type YouTubeProviderConfig } from "./youtube";

// Factory function for creating providers (non-GitHub only)
import { type Result, err } from "../utils";
import { BlueskyProvider } from "./bluesky";
import { DevpadProvider } from "./devpad";
import type { Provider, ProviderError, ProviderFactory } from "./types";
import { YouTubeProvider } from "./youtube";

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
