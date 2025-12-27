import { z } from "zod";

const FetchedAtSchema = z.object({
	fetched_at: z.string().datetime(),
});

export const GitHubRepoSchema = z.object({
	id: z.number(),
	name: z.string(),
	url: z.string(),
});

export const GitHubBaseEventSchema = z.object({
	id: z.string(),
	type: z.string(),
	created_at: z.string(),
	repo: GitHubRepoSchema,
	payload: z.record(z.unknown()),
});

export const GitHubEventSchema = GitHubBaseEventSchema;

// Extended commit schema for data fetched from Commits API
export const GitHubExtendedCommitSchema = z.object({
	sha: z.string(),
	message: z.string(),
	date: z.string(),
	url: z.string(),
	repo: z.string(),
	branch: z.string(),
});

// Pull request schema for data extracted from PullRequestEvents
export const GitHubPullRequestSchema = z.object({
	id: z.number(),
	number: z.number(),
	title: z.string(),
	state: z.enum(["open", "closed", "merged"]),
	action: z.string(),
	url: z.string(),
	repo: z.string(),
	created_at: z.string(),
	merged_at: z.string().optional(),
	head_ref: z.string(),
	base_ref: z.string(),
	// Commit SHAs associated with this PR (fetched from pulls.listCommits)
	commit_shas: z.array(z.string()).default([]),
	// The merge commit SHA (for deduplication of merge commits)
	merge_commit_sha: z.string().optional(),
});

export const GitHubRawSchema = FetchedAtSchema.extend({
	events: z.array(GitHubEventSchema),
	commits: z.array(GitHubExtendedCommitSchema).default([]),
	pull_requests: z.array(GitHubPullRequestSchema).default([]),
});

export const BlueskyAuthorSchema = z.object({
	did: z.string(),
	handle: z.string(),
	displayName: z.string().optional(),
	avatar: z.string().url().optional(),
});

export const BlueskyPostSchema = z.object({
	uri: z.string(),
	cid: z.string(),
	author: BlueskyAuthorSchema,
	record: z.object({
		text: z.string(),
		createdAt: z.string(),
		reply: z
			.object({
				parent: z.object({ uri: z.string() }),
				root: z.object({ uri: z.string() }),
			})
			.optional(),
	}),
	replyCount: z.number().default(0),
	repostCount: z.number().default(0),
	likeCount: z.number().default(0),
	embed: z
		.object({
			images: z
				.array(
					z.object({
						thumb: z.string(),
						fullsize: z.string(),
					})
				)
				.optional(),
		})
		.optional(),
});

export const BlueskyFeedItemSchema = z.object({
	post: BlueskyPostSchema,
	reason: z
		.object({
			$type: z.string(),
			by: BlueskyAuthorSchema.optional(),
		})
		.optional(),
});

export const BlueskyRawSchema = FetchedAtSchema.extend({
	feed: z.array(BlueskyFeedItemSchema),
	cursor: z.string().optional(),
});

export const YouTubeThumbnailSchema = z.object({
	url: z.string().url(),
	width: z.number().optional(),
	height: z.number().optional(),
});

export const YouTubeVideoSchema = z.object({
	kind: z.string(),
	etag: z.string(),
	id: z.object({
		kind: z.string(),
		videoId: z.string(),
	}),
	snippet: z.object({
		publishedAt: z.string(),
		channelId: z.string(),
		title: z.string(),
		description: z.string(),
		thumbnails: z.object({
			default: YouTubeThumbnailSchema.optional(),
			medium: YouTubeThumbnailSchema.optional(),
			high: YouTubeThumbnailSchema.optional(),
		}),
		channelTitle: z.string(),
	}),
});

export const YouTubeRawSchema = FetchedAtSchema.extend({
	items: z.array(YouTubeVideoSchema),
	nextPageToken: z.string().optional(),
	pageInfo: z
		.object({
			totalResults: z.number(),
			resultsPerPage: z.number(),
		})
		.optional(),
});

export const DevpadTaskSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.enum(["todo", "in_progress", "done", "archived"]),
	priority: z.enum(["low", "medium", "high"]).optional(),
	project: z.string().optional(),
	tags: z.array(z.string()).default([]),
	created_at: z.string(),
	updated_at: z.string(),
	due_date: z.string().optional(),
	completed_at: z.string().optional(),
});

export const DevpadRawSchema = FetchedAtSchema.extend({
	tasks: z.array(DevpadTaskSchema),
});
