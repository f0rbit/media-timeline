import type { Backend } from "@f0rbit/corpus";
import type { Platform } from "@media/schema";

export type LoadFunction<T = unknown> = (backend: Backend, accountId: string) => Promise<T>;

// Re-export from platform-specific files
export { loadGitHubData, type GitHubTimelineData, type CommitWithRepo, type PRWithRepo } from "../platforms/github/timeline";
export { loadRedditData, type RedditTimelineData } from "../platforms/reddit/timeline";
export { loadTwitterData, type TwitterTimelineData } from "../platforms/twitter/timeline";

// Import for the loaders record
import { loadGitHubData } from "../platforms/github/timeline";
import { loadRedditData } from "../platforms/reddit/timeline";
import { loadTwitterData } from "../platforms/twitter/timeline";

export const loaders: Record<Platform, LoadFunction> = {
	github: loadGitHubData,
	reddit: loadRedditData,
	twitter: loadTwitterData,
	bluesky: async () => ({}),
	youtube: async () => ({}),
	devpad: async () => ({}),
};

// Backwards compatible aliases
export const loadGitHubDataForAccount = loadGitHubData;
export const loadRedditDataForAccount = loadRedditData;
export const loadTwitterDataForAccount = loadTwitterData;
