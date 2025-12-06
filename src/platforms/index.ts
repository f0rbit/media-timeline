// Re-export providers, normalizers, and memory providers
export { GitHubProvider, normalizeGitHub, GitHubMemoryProvider } from "./github";
export { BlueskyProvider, normalizeBluesky, BlueskyMemoryProvider } from "./bluesky";
export { YouTubeProvider, normalizeYouTube, YouTubeMemoryProvider } from "./youtube";
export { DevpadProvider, normalizeDevpad, DevpadMemoryProvider } from "./devpad";

// Re-export types
export * from "./types";

// Factory function for creating providers
import type { Provider } from "./types";
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
