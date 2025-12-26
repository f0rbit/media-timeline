// Re-export providers, normalizers, and memory providers
export { GitHubProvider, normalizeGitHub, GitHubMemoryProvider } from "./github";
export { BlueskyProvider, normalizeBluesky, BlueskyMemoryProvider } from "./bluesky";
export { YouTubeProvider, normalizeYouTube, YouTubeMemoryProvider } from "./youtube";
export { DevpadProvider, normalizeDevpad, DevpadMemoryProvider } from "./devpad";

// Re-export types
export * from "./types";
export type { MemoryProviderControls, MemoryProviderState, SimulationConfig } from "./memory-base";
export { createMemoryProviderState, simulateErrors, createMemoryProviderControlMethods } from "./memory-base";

// Factory function for creating providers
import { err, type Result } from "../utils";
import type { Provider, ProviderError, ProviderFactory } from "./types";
import { GitHubProvider, type GitHubProviderConfig } from "./github";
import { BlueskyProvider, type BlueskyProviderConfig } from "./bluesky";
import { YouTubeProvider, type YouTubeProviderConfig } from "./youtube";
import { DevpadProvider } from "./devpad";

export type ProviderConfig = { platform: "github"; config: GitHubProviderConfig } | { platform: "bluesky"; config: BlueskyProviderConfig } | { platform: "youtube"; config: YouTubeProviderConfig } | { platform: "devpad" };

export const createProvider = (params: ProviderConfig): Provider<unknown> => {
	switch (params.platform) {
		case "github":
			return new GitHubProvider(params.config);
		case "bluesky":
			return new BlueskyProvider(params.config);
		case "youtube":
			return new YouTubeProvider(params.config);
		case "devpad":
			return new DevpadProvider();
	}
};

export const defaultProviderFactory: ProviderFactory = {
	async create(platform, platformUserId, token) {
		const provider = providerForPlatform(platform, platformUserId);
		if (!provider) return err({ kind: "unknown_platform", platform });
		return provider.fetch(token) as Promise<Result<Record<string, unknown>, ProviderError>>;
	},
};

const providerForPlatform = (platform: string, platformUserId: string | null): Provider<unknown> | null => {
	switch (platform) {
		case "github":
			return new GitHubProvider({ username: platformUserId ?? undefined });
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
