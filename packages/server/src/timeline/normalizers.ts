import type { Platform, TimelineItem } from "@media/schema";

export type NormalizeFunction<T = unknown> = (data: T, username?: string) => TimelineItem[];

// Re-export from platform-specific files
export { normalizeGitHub } from "../platforms/github/timeline";
export { normalizeReddit } from "../platforms/reddit/timeline";
export { normalizeTwitter } from "../platforms/twitter/timeline";

// Import for the normalizers record
import { normalizeGitHub } from "../platforms/github/timeline";
import type { GitHubTimelineData } from "../platforms/github/timeline";
import { normalizeReddit } from "../platforms/reddit/timeline";
import type { RedditTimelineData } from "../platforms/reddit/timeline";
import { normalizeTwitter } from "../platforms/twitter/timeline";
import type { TwitterTimelineData } from "../platforms/twitter/timeline";

export const normalizers: Record<Platform, NormalizeFunction> = {
	github: data => normalizeGitHub(data as GitHubTimelineData),
	reddit: (data, username) => normalizeReddit(data as RedditTimelineData, username ?? ""),
	twitter: data => normalizeTwitter(data as TwitterTimelineData),
	bluesky: () => [],
	youtube: () => [],
	devpad: () => [],
};
