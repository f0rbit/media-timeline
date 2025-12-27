import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";

export {
	BlueskyAuthorSchema,
	BlueskyFeedItemSchema,
	BlueskyPostSchema,
	BlueskyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubBaseEventSchema,
	GitHubEventSchema,
	GitHubExtendedCommitSchema,
	GitHubPullRequestSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms";

export {
	GitHubRepoMetaSchema,
	GitHubMetaStoreSchema,
	type GitHubRepoMeta,
	type GitHubMetaStore,
} from "./github-meta";

export {
	GitHubRepoCommitSchema,
	GitHubRepoCommitsStoreSchema,
	type GitHubRepoCommit,
	type GitHubRepoCommitsStore,
} from "./github-commits";

export {
	GitHubRepoPRSchema,
	GitHubRepoPRsStoreSchema,
	type GitHubRepoPR,
	type GitHubRepoPRsStore,
} from "./github-prs";

export {
	CommitGroupSchema,
	CommitPayloadSchema,
	DateGroupSchema,
	PayloadSchema,
	PlatformSchema,
	PostPayloadSchema,
	PullRequestPayloadSchema,
	TaskPayloadSchema,
	TimelineItemSchema,
	TimelineSchema,
	TimelineTypeSchema,
	VideoPayloadSchema,
} from "./timeline";

export type {
	CommitGroup,
	CommitPayload,
	DateGroup,
	Payload,
	Platform,
	PostPayload,
	PullRequestPayload,
	TaskPayload,
	Timeline,
	TimelineItem,
	TimelineType,
	VideoPayload,
} from "./timeline";

export { accountMembers, accounts, apiKeys, rateLimits, users, accountSettings } from "./database";

export {
	GitHubSettingsSchema,
	BlueskySettingsSchema,
	YouTubeSettingsSchema,
	DevpadSettingsSchema,
	PlatformSettingsSchemaMap,
	type GitHubSettings,
	type BlueskySettings,
	type YouTubeSettings,
	type DevpadSettings,
	type PlatformSettings,
} from "./settings";

import {
	BlueskyAuthorSchema,
	BlueskyFeedItemSchema,
	BlueskyPostSchema,
	BlueskyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubBaseEventSchema,
	GitHubEventSchema,
	GitHubExtendedCommitSchema,
	GitHubPullRequestSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms";

import { accountMembers, accounts, apiKeys, rateLimits, users, accountSettings } from "./database";

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;
export type GitHubExtendedCommit = z.infer<typeof GitHubExtendedCommitSchema>;
export type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>;
export type GitHubBaseEvent = z.infer<typeof GitHubBaseEventSchema>;
export type GitHubEvent = z.infer<typeof GitHubEventSchema>;
export type GitHubRaw = z.infer<typeof GitHubRawSchema>;

export type BlueskyAuthor = z.infer<typeof BlueskyAuthorSchema>;
export type BlueskyPost = z.infer<typeof BlueskyPostSchema>;
export type BlueskyFeedItem = z.infer<typeof BlueskyFeedItemSchema>;
export type BlueskyRaw = z.infer<typeof BlueskyRawSchema>;

export type YouTubeThumbnail = z.infer<typeof YouTubeThumbnailSchema>;
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;
export type YouTubeRaw = z.infer<typeof YouTubeRawSchema>;

export type DevpadTask = z.infer<typeof DevpadTaskSchema>;
export type DevpadRaw = z.infer<typeof DevpadRawSchema>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type AccountMember = InferSelectModel<typeof accountMembers>;
export type NewAccountMember = InferInsertModel<typeof accountMembers>;

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type RateLimit = InferSelectModel<typeof rateLimits>;
export type NewRateLimit = InferInsertModel<typeof rateLimits>;

export type AccountSetting = InferSelectModel<typeof accountSettings>;
export type NewAccountSetting = InferInsertModel<typeof accountSettings>;

export type CorpusPath = `raw/github/${string}` | `raw/bluesky/${string}` | `raw/youtube/${string}` | `raw/devpad/${string}` | `timeline/${string}`;
