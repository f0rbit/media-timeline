import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";
import type { accountMembers, accounts, apiKeys, rateLimits, users } from "./database";

import type {
	BlueSkyAuthorSchema,
	BlueSkyFeedItemSchema,
	BlueSkyPostSchema,
	BlueSkyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubCommitSchema,
	GitHubEventSchema,
	GitHubPushEventSchema,
	GitHubRawSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms";
import type { CommitGroupSchema, CommitPayloadSchema, DateGroupSchema, PayloadSchema, PlatformSchema, PostPayloadSchema, TaskPayloadSchema, TimelineItemSchema, TimelineSchema, TimelineTypeSchema, VideoPayloadSchema } from "./timeline";

export type Platform = z.infer<typeof PlatformSchema>;
export type TimelineType = z.infer<typeof TimelineTypeSchema>;

export type CommitPayload = z.infer<typeof CommitPayloadSchema>;
export type PostPayload = z.infer<typeof PostPayloadSchema>;
export type VideoPayload = z.infer<typeof VideoPayloadSchema>;
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;
export type Payload = z.infer<typeof PayloadSchema>;

export type TimelineItem = z.infer<typeof TimelineItemSchema>;
export type CommitGroup = z.infer<typeof CommitGroupSchema>;
export type DateGroup = z.infer<typeof DateGroupSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;

export type GitHubCommit = z.infer<typeof GitHubCommitSchema>;
export type GitHubPushEvent = z.infer<typeof GitHubPushEventSchema>;
export type GitHubEvent = z.infer<typeof GitHubEventSchema>;
export type GitHubRaw = z.infer<typeof GitHubRawSchema>;

export type BlueSkyAuthor = z.infer<typeof BlueSkyAuthorSchema>;
export type BlueSkyPost = z.infer<typeof BlueSkyPostSchema>;
export type BlueSkyFeedItem = z.infer<typeof BlueSkyFeedItemSchema>;
export type BlueSkyRaw = z.infer<typeof BlueSkyRawSchema>;

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
