import { z } from "zod";
import { PlatformSchema } from "./platforms";

export { PlatformSchema };
export const TimelineTypeSchema = z.enum(["commit", "post", "video", "task", "pull_request", "comment"]);

export const CommitPayloadSchema = z.object({
	type: z.literal("commit"),
	sha: z.string(),
	message: z.string(),
	repo: z.string(),
	branch: z.string(),
	additions: z.number().optional(),
	deletions: z.number().optional(),
	files_changed: z.number().optional(),
});

export const PostPayloadSchema = z.object({
	type: z.literal("post"),
	content: z.string(),
	author_handle: z.string(),
	author_name: z.string().optional(),
	author_avatar: z.string().url().optional(),
	reply_count: z.number().default(0),
	repost_count: z.number().default(0),
	like_count: z.number().default(0),
	has_media: z.boolean().default(false),
	is_reply: z.boolean().default(false),
	is_repost: z.boolean().default(false),
	subreddit: z.string().optional(),
});

export const VideoPayloadSchema = z.object({
	type: z.literal("video"),
	channel_id: z.string(),
	channel_title: z.string(),
	description: z.string().optional(),
	thumbnail_url: z.string().url().optional(),
	duration: z.string().optional(),
	view_count: z.number().optional(),
	like_count: z.number().optional(),
});

export const TaskPayloadSchema = z.object({
	type: z.literal("task"),
	status: z.enum(["todo", "in_progress", "done", "archived"]),
	priority: z.enum(["low", "medium", "high"]).optional(),
	project: z.string().optional(),
	tags: z.array(z.string()).default([]),
	due_date: z.string().datetime().optional(),
	completed_at: z.string().datetime().optional(),
});

// Commit info embedded in PR payload (for display)
export const PRCommitSchema = z.object({
	sha: z.string(),
	message: z.string(),
	url: z.string(),
});

export const PullRequestPayloadSchema = z.object({
	type: z.literal("pull_request"),
	repo: z.string(),
	number: z.number(),
	title: z.string(),
	state: z.enum(["open", "closed", "merged"]),
	action: z.string(),
	head_ref: z.string(),
	base_ref: z.string(),
	additions: z.number().optional(),
	deletions: z.number().optional(),
	changed_files: z.number().optional(),
	// SHAs of commits that belong to this PR (for deduplication)
	commit_shas: z.array(z.string()).default([]),
	merge_commit_sha: z.string().nullable().optional(),
	// Commits that belong to this PR (populated during timeline processing)
	commits: z.array(PRCommitSchema).default([]),
});

// Comment payload (for Reddit comments)
export const CommentPayloadSchema = z.object({
	type: z.literal("comment"),
	content: z.string(),
	author_handle: z.string(),
	parent_title: z.string(), // title of the post being commented on
	parent_url: z.string(),
	subreddit: z.string(),
	score: z.number(),
	is_op: z.boolean().default(false),
});

export const PayloadSchema = z.discriminatedUnion("type", [CommitPayloadSchema, PostPayloadSchema, VideoPayloadSchema, TaskPayloadSchema, PullRequestPayloadSchema, CommentPayloadSchema]);

export const TimelineItemSchema = z.object({
	id: z.string(),
	platform: PlatformSchema,
	type: TimelineTypeSchema,
	timestamp: z.string().datetime(),
	title: z.string(),
	url: z.string().url(),
	payload: PayloadSchema,
});

export const CommitGroupSchema = z.object({
	type: z.literal("commit_group"),
	repo: z.string(),
	branch: z.string(),
	date: z.string(),
	commits: z.array(TimelineItemSchema),
	total_additions: z.number().default(0),
	total_deletions: z.number().default(0),
	total_files_changed: z.number().default(0),
});

export const DateGroupSchema = z.object({
	date: z.string(),
	items: z.array(z.union([TimelineItemSchema, CommitGroupSchema])),
});

export const TimelineSchema = z.object({
	user_id: z.string(),
	generated_at: z.string().datetime(),
	groups: z.array(DateGroupSchema),
});

export type { Platform } from "./platforms";
export type TimelineType = z.infer<typeof TimelineTypeSchema>;
export type CommitPayload = z.infer<typeof CommitPayloadSchema>;
export type PostPayload = z.infer<typeof PostPayloadSchema>;
export type VideoPayload = z.infer<typeof VideoPayloadSchema>;
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;
export type PRCommit = z.infer<typeof PRCommitSchema>;
export type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;
export type CommentPayload = z.infer<typeof CommentPayloadSchema>;
export type Payload = z.infer<typeof PayloadSchema>;
export type TimelineItem = z.infer<typeof TimelineItemSchema>;
export type CommitGroup = z.infer<typeof CommitGroupSchema>;
export type DateGroup = z.infer<typeof DateGroupSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
