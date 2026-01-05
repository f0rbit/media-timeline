import type { Platform } from "@media/schema";
import type { NormalizeFunction } from "../platforms/registry";

// Re-export from platform-specific files
export { normalizeGitHub } from "../platforms/github/timeline";
export { normalizeReddit } from "../platforms/reddit/timeline";
export { normalizeTwitter } from "../platforms/twitter/timeline";

// Import for the normalizers record
import { normalizeGitHub } from "../platforms/github/timeline";
import { normalizeReddit } from "../platforms/reddit/timeline";
import { normalizeTwitter } from "../platforms/twitter/timeline";
import type { GitHubTimelineData } from "../platforms/github/timeline";
import type { RedditTimelineData } from "../platforms/reddit/timeline";
import type { TwitterTimelineData } from "../platforms/twitter/timeline";

export const normalizers: Record<Platform, NormalizeFunction> = {
	github: data => normalizeGitHub(data as GitHubTimelineData),
	reddit: (data, username) => normalizeReddit(data as RedditTimelineData, username ?? ""),
	twitter: data => normalizeTwitter(data as TwitterTimelineData),
	bluesky: () => [],
	youtube: () => [],
	devpad: () => [],
};
