import type { Platform } from "@media-timeline/schema";

export type { Platform };
export type ItemType = "commit" | "post" | "video" | "task";

export type CommitPayload = {
	type: "commit";
	repo: string;
	sha: string;
	message: string;
	additions?: number;
	deletions?: number;
};

export type PostPayload = {
	type: "post";
	text: string;
	likes?: number;
	reposts?: number;
	images?: string[];
};

export type VideoPayload = {
	type: "video";
	channel: string;
	thumbnail?: string;
	duration?: string;
	views?: number;
};

export type TaskPayload = {
	type: "task";
	project: string;
	status: string;
	priority?: string;
};

export type Payload = CommitPayload | PostPayload | VideoPayload | TaskPayload;

export type TimelineItem = {
	id: string;
	platform: Platform;
	type: ItemType;
	timestamp: string;
	title: string;
	url?: string;
	payload: Payload;
};

export type CommitGroup = {
	id: string;
	platform: "github";
	type: "commit_group";
	timestamp: string;
	repo: string;
	commits: Array<{ sha: string; message: string; timestamp: string }>;
	total_additions: number;
	total_deletions: number;
};

export type TimelineEntry = TimelineItem | CommitGroup;

export type DateGroup = {
	date: string;
	entries: TimelineEntry[];
};

export type GitHubCommit = {
	sha: string;
	message: string;
	author: { name: string; email: string };
	url: string;
};

export type GitHubPushEvent = {
	id: string;
	type: "PushEvent";
	created_at: string;
	repo: { id: number; name: string; url: string };
	payload: { ref: string; commits: GitHubCommit[] };
};

export type GitHubEvent = GitHubPushEvent | { id: string; type: string; created_at: string; repo: { id: number; name: string; url: string }; payload: unknown };

export type GitHubRaw = {
	events: GitHubEvent[];
	fetched_at: string;
};

export type BlueskyAuthor = {
	did: string;
	handle: string;
	displayName?: string;
	avatar?: string;
};

export type BlueskyPost = {
	uri: string;
	cid: string;
	author: BlueskyAuthor;
	record: {
		text: string;
		createdAt: string;
		reply?: { parent: { uri: string }; root: { uri: string } };
	};
	replyCount?: number;
	repostCount?: number;
	likeCount?: number;
	embed?: { images?: Array<{ thumb: string; fullsize: string }> };
};

export type BlueskyFeedItem = {
	post: BlueskyPost;
	reason?: { $type: string; by?: BlueskyAuthor };
};

export type BlueskyRaw = {
	feed: BlueskyFeedItem[];
	cursor?: string;
	fetched_at: string;
};

export type YouTubeVideo = {
	id: { videoId: string };
	snippet: {
		publishedAt: string;
		channelId: string;
		title: string;
		description: string;
		thumbnails: {
			default?: { url: string };
			medium?: { url: string };
			high?: { url: string };
		};
		channelTitle: string;
	};
};

export type YouTubeRaw = {
	items: YouTubeVideo[];
	nextPageToken?: string;
	fetched_at: string;
};

export type DevpadTask = {
	id: string;
	title: string;
	status: "todo" | "in_progress" | "done" | "archived";
	priority?: "low" | "medium" | "high";
	project?: string;
	tags?: string[];
	created_at: string;
	updated_at: string;
	due_date?: string;
	completed_at?: string;
};

export type DevpadRaw = {
	tasks: DevpadTask[];
	fetched_at: string;
};
