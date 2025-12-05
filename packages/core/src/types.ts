export type {
	BlueskyAuthor,
	BlueskyFeedItem,
	BlueskyPost,
	BlueskyRaw,
	CommitGroup,
	CommitPayload,
	DateGroup,
	DevpadRaw,
	DevpadTask,
	GitHubCommit,
	GitHubEvent,
	GitHubPushEvent,
	GitHubRaw,
	Payload,
	Platform,
	PostPayload,
	TaskPayload,
	TimelineItem,
	VideoPayload,
	YouTubeRaw,
	YouTubeVideo,
} from "@media-timeline/schema";

export type ItemType = "commit" | "post" | "video" | "task";

export type TimelineEntry = import("@media-timeline/schema").TimelineItem | import("@media-timeline/schema").CommitGroup;
