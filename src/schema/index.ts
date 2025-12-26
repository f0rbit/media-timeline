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
	GitHubCommitSchema,
	GitHubEventSchema,
	GitHubPushEventSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms";

export {
	CommitGroupSchema,
	CommitPayloadSchema,
	DateGroupSchema,
	PayloadSchema,
	PlatformSchema,
	PostPayloadSchema,
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
	TaskPayload,
	Timeline,
	TimelineItem,
	TimelineType,
	VideoPayload,
} from "./timeline";

export { accountMembers, accounts, apiKeys, rateLimits, users } from "./database";

import {
	BlueskyAuthorSchema,
	BlueskyFeedItemSchema,
	BlueskyPostSchema,
	BlueskyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubBaseEventSchema,
	GitHubCommitSchema,
	GitHubEventSchema,
	GitHubPushEventSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms";

import { accountMembers, accounts, apiKeys, rateLimits, users } from "./database";

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;
export type GitHubCommit = z.infer<typeof GitHubCommitSchema>;
export type GitHubBaseEvent = z.infer<typeof GitHubBaseEventSchema>;
export type GitHubPushEvent = z.infer<typeof GitHubPushEventSchema>;
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

export type CorpusPath = `raw/github/${string}` | `raw/bluesky/${string}` | `raw/youtube/${string}` | `raw/devpad/${string}` | `timeline/${string}`;
