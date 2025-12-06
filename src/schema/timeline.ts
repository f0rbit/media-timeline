import { z } from "zod";

export const PlatformSchema = z.enum(["github", "bluesky", "youtube", "devpad"]);
export const TimelineTypeSchema = z.enum(["commit", "post", "video", "task"]);

export const CommitPayloadSchema = z.object({
	type: z.literal("commit"),
	sha: z.string(),
	message: z.string(),
	repo: z.string(),
	branch: z.string().optional(),
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
	reply_count: z.number().optional(),
	repost_count: z.number().optional(),
	like_count: z.number().optional(),
	has_media: z.boolean().optional(),
	is_reply: z.boolean().optional(),
	is_repost: z.boolean().optional(),
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
	tags: z.array(z.string()).optional(),
	due_date: z.string().datetime().optional(),
	completed_at: z.string().datetime().optional(),
});

export const PayloadSchema = z.discriminatedUnion("type", [CommitPayloadSchema, PostPayloadSchema, VideoPayloadSchema, TaskPayloadSchema]);

export const TimelineItemSchema = z.object({
	id: z.string(),
	platform: PlatformSchema,
	type: TimelineTypeSchema,
	timestamp: z.string().datetime(),
	title: z.string(),
	url: z.string().url().optional(),
	payload: PayloadSchema,
});

export const CommitGroupSchema = z.object({
	type: z.literal("commit_group"),
	repo: z.string(),
	date: z.string(),
	commits: z.array(TimelineItemSchema),
	total_additions: z.number().optional(),
	total_deletions: z.number().optional(),
	total_files_changed: z.number().optional(),
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
