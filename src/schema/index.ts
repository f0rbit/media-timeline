import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";

export { accountMembers, accountSettings, accounts, apiKeys, rateLimits, users } from "./database";
export {
	type GitHubRepoCommit,
	GitHubRepoCommitSchema,
	type GitHubRepoCommitsStore,
	GitHubRepoCommitsStoreSchema,
} from "./github-commits";
export {
	type GitHubMetaStore,
	GitHubMetaStoreSchema,
	type GitHubRepoMeta,
	GitHubRepoMetaSchema,
} from "./github-meta";

export {
	type GitHubRepoPR,
	GitHubRepoPRSchema,
	type GitHubRepoPRsStore,
	GitHubRepoPRsStoreSchema,
} from "./github-prs";
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
	type RedditComment,
	RedditCommentSchema,
	type RedditCommentsStore,
	RedditCommentsStoreSchema,
} from "./reddit-comments";

export {
	type RedditMetaStore,
	RedditMetaStoreSchema,
} from "./reddit-meta";
export {
	type RedditPost,
	RedditPostSchema,
	type RedditPostsStore,
	RedditPostsStoreSchema,
} from "./reddit-posts";
export {
	type TweetMedia,
	TweetMediaSchema,
	type TweetMetrics,
	TweetMetricsSchema,
	type TweetUrl,
	TweetUrlSchema,
	type TwitterTweet,
	TwitterTweetSchema,
	type TwitterTweetsStore,
	TwitterTweetsStoreSchema,
} from "./twitter-tweets";
export {
	type TwitterMetaStore,
	TwitterMetaStoreSchema,
	type TwitterUserMetrics,
	TwitterUserMetricsSchema,
} from "./twitter-meta";
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
	Platform,
	PostPayload,
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
	PlatformSchema,
	PostPayloadSchema,
	PullRequestPayloadSchema,
	TaskPayloadSchema,
	TimelineItemSchema,
	TimelineSchema,
	TimelineTypeSchema,
	VideoPayloadSchema,
} from "./timeline";

import type { accountMembers, accountSettings, accounts, apiKeys, rateLimits, users } from "./database";
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
} from "./platforms";

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
