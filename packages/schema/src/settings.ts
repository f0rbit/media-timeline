import { z } from "zod";

export const GitHubSettingsSchema = z.object({
	hidden_repos: z.array(z.string()).default([]),
});

export const BlueskySettingsSchema = z.object({
	include_replies: z.boolean().default(true),
	include_reposts: z.boolean().default(false),
});

export const YouTubeSettingsSchema = z.object({
	include_watch_history: z.boolean().default(true),
	include_liked: z.boolean().default(false),
});

export const DevpadSettingsSchema = z.object({
	hidden_projects: z.array(z.string()).default([]),
});

export const PlatformSettingsSchemaMap = {
	github: GitHubSettingsSchema,
	bluesky: BlueskySettingsSchema,
	youtube: YouTubeSettingsSchema,
	devpad: DevpadSettingsSchema,
} as const;

export type GitHubSettings = z.infer<typeof GitHubSettingsSchema>;
export type BlueskySettings = z.infer<typeof BlueskySettingsSchema>;
export type YouTubeSettings = z.infer<typeof YouTubeSettingsSchema>;
export type DevpadSettings = z.infer<typeof DevpadSettingsSchema>;
export type PlatformSettings = GitHubSettings | BlueskySettings | YouTubeSettings | DevpadSettings;
