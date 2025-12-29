export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

export type TimelineType = "commit" | "post" | "video" | "task" | "pull_request" | "comment";

export type CommitPayload = {
	type: "commit";
	sha: string;
	message: string;
	repo: string;
	branch: string;
	additions?: number;
	deletions?: number;
	files_changed?: number;
};

export type PostPayload = {
	type: "post";
	content: string;
	author_handle: string;
	author_name?: string;
	author_avatar?: string;
	reply_count: number;
	repost_count: number;
	like_count: number;
	has_media: boolean;
	is_reply: boolean;
	is_repost: boolean;
	subreddit?: string;
};

export type VideoPayload = {
	type: "video";
	channel_id: string;
	channel_title: string;
	description?: string;
	thumbnail_url?: string;
	duration?: string;
	view_count?: number;
	like_count?: number;
};

export type TaskPayload = {
	type: "task";
	status: "todo" | "in_progress" | "done" | "archived";
	priority?: "low" | "medium" | "high";
	project?: string;
	tags: string[];
	due_date?: string;
	completed_at?: string;
};

export type PRCommit = {
	sha: string;
	message: string;
	url: string;
};

export type PullRequestPayload = {
	type: "pull_request";
	repo: string;
	number: number;
	title: string;
	state: "open" | "closed" | "merged";
	action: string;
	head_ref: string;
	base_ref: string;
	additions?: number;
	deletions?: number;
	changed_files?: number;
	commit_shas: string[];
	merge_commit_sha?: string | null;
	commits: PRCommit[];
};

export type CommentPayload = {
	type: "comment";
	content: string;
	author_handle: string;
	parent_title: string;
	parent_url: string;
	subreddit: string;
	score: number;
	is_op: boolean;
};

export type Payload = CommitPayload | PostPayload | VideoPayload | TaskPayload | PullRequestPayload | CommentPayload;

export type TimelineItem = {
	id: string;
	platform: Platform;
	type: TimelineType;
	timestamp: string;
	title: string;
	url: string;
	payload: Payload;
};

export type CommitGroup = {
	type: "commit_group";
	repo: string;
	branch: string;
	date: string;
	commits: TimelineItem[];
	total_additions: number;
	total_deletions: number;
	total_files_changed: number;
};

export type DateGroup = {
	date: string;
	items: (TimelineItem | CommitGroup)[];
};

export type Timeline = {
	user_id: string;
	generated_at: string;
	groups: DateGroup[];
};

export type GitHubSettings = {
	hidden_repos: string[];
};

export type BlueskySettings = {
	include_replies: boolean;
	include_reposts: boolean;
};

export type YouTubeSettings = {
	include_watch_history: boolean;
	include_liked: boolean;
};

export type DevpadSettings = {
	hidden_projects: string[];
};

export type PlatformSettings = GitHubSettings | BlueskySettings | YouTubeSettings | DevpadSettings;

export type GitHubRepo = {
	full_name: string;
	name: string;
	owner: string;
	is_private: boolean;
	default_branch: string;
	pushed_at: string | null;
};
