import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";

export * from "./branded";
export * from "./errors";
export {
	accountSettings,
	accounts,
	apiKeys,
	platformCredentials,
	profileFilters,
	profiles,
	rateLimits,
	users,
	type Profile,
	type ProfileFilter,
	type NewProfile,
	type NewProfileFilter,
	type PlatformCredential,
	type NewPlatformCredential,
} from "./database";

export {
	GitHubRepoCommitSchema,
	GitHubRepoCommitsStoreSchema,
	GitHubRepoMetaSchema,
	GitHubMetaStoreSchema,
	GitHubRepoPRSchema,
	GitHubRepoPRsStoreSchema,
	RedditCommentSchema,
	RedditCommentsStoreSchema,
	RedditMetaStoreSchema,
	RedditPostSchema,
	RedditPostsStoreSchema,
	TwitterUserMetricsSchema,
	TwitterMetaStoreSchema,
	TweetMetricsSchema,
	TweetMediaSchema,
	TweetUrlSchema,
	TwitterTweetSchema,
	TwitterTweetsStoreSchema,
	type GitHubRepoCommit,
	type GitHubRepoCommitsStore,
	type GitHubRepoMeta,
	type GitHubMetaStore,
	type GitHubRepoPR,
	type GitHubRepoPRsStore,
	type RedditComment,
	type RedditCommentsStore,
	type RedditMetaStore,
	type RedditPost,
	type RedditPostsStore,
	type TwitterUserMetrics,
	type TwitterMetaStore,
	type TweetMetrics,
	type TweetMedia,
	type TweetUrl,
	type TwitterTweet,
	type TwitterTweetsStore,
} from "./platforms/index";

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
	isMultiStorePlatform,
	MULTI_STORE_PLATFORMS,
	PLATFORMS,
	PlatformSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms.ts";
export type { MultiStorePlatform, Platform } from "./platforms.ts";

export {
	type BlueskySettings,
	BlueskySettingsSchema,
	type DevpadSettings,
	DevpadSettingsSchema,
	type GitHubSettings,
	GitHubSettingsSchema,
	type PlatformSettings,
	PlatformSettingsSchemaMap,
	type YouTubeSettings,
	YouTubeSettingsSchema,
} from "./settings";

export type {
	CommentPayload,
	CommitGroup,
	CommitPayload,
	DateGroup,
	Payload,
	PostPayload,
	PRCommit,
	PullRequestPayload,
	TaskPayload,
	Timeline,
	TimelineItem,
	TimelineType,
	VideoPayload,
} from "./timeline";

export {
	CommentPayloadSchema,
	CommitGroupSchema,
	CommitPayloadSchema,
	DateGroupSchema,
	PayloadSchema,
	PostPayloadSchema,
	PullRequestPayloadSchema,
	TaskPayloadSchema,
	TimelineItemSchema,
	TimelineSchema,
	TimelineTypeSchema,
	VideoPayloadSchema,
} from "./timeline";

export {
	AddFilterSchema,
	CreateProfileSchema,
	FilterKeySchema,
	FilterTypeSchema,
	SlugSchema,
	UpdateProfileSchema,
	type AddFilterInput,
	type CreateProfileInput,
	type FilterKey,
	type FilterType,
	type UpdateProfileInput,
} from "./profiles";

import type { accountSettings, accounts, apiKeys, rateLimits, users } from "./database";
import type {
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
} from "./platforms.ts";

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

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type RateLimit = InferSelectModel<typeof rateLimits>;
export type NewRateLimit = InferInsertModel<typeof rateLimits>;

export type AccountSetting = InferSelectModel<typeof accountSettings>;
export type NewAccountSetting = InferInsertModel<typeof accountSettings>;

export type CorpusPath = `media/raw/github/${string}` | `media/raw/bluesky/${string}` | `media/raw/youtube/${string}` | `media/raw/devpad/${string}` | `media/timeline/${string}`;
