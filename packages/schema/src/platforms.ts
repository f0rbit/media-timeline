import { z } from "zod";

const FetchedAtSchema = z.object({
	fetched_at: z.string().datetime(),
});

export const GitHubCommitSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author: z.object({
		name: z.string(),
		email: z.string(),
	}),
	url: z.string().url(),
});

export const GitHubPushEventSchema = z.object({
	id: z.string(),
	type: z.literal("PushEvent"),
	created_at: z.string(),
	repo: z.object({
		id: z.number(),
		name: z.string(),
		url: z.string(),
	}),
	payload: z.object({
		ref: z.string(),
		commits: z.array(GitHubCommitSchema),
	}),
});

export const GitHubEventSchema = z.discriminatedUnion("type", [
	GitHubPushEventSchema,
	z.object({
		id: z.string(),
		type: z.literal("CreateEvent"),
		created_at: z.string(),
		repo: z.object({ id: z.number(), name: z.string(), url: z.string() }),
		payload: z.object({ ref: z.string().nullable(), ref_type: z.string() }),
	}),
	z.object({
		id: z.string(),
		type: z.literal("WatchEvent"),
		created_at: z.string(),
		repo: z.object({ id: z.number(), name: z.string(), url: z.string() }),
		payload: z.object({ action: z.string() }),
	}),
	z.object({
		id: z.string(),
		type: z.literal("IssuesEvent"),
		created_at: z.string(),
		repo: z.object({ id: z.number(), name: z.string(), url: z.string() }),
		payload: z.object({ action: z.string(), issue: z.object({ number: z.number(), title: z.string() }) }),
	}),
	z.object({
		id: z.string(),
		type: z.literal("PullRequestEvent"),
		created_at: z.string(),
		repo: z.object({ id: z.number(), name: z.string(), url: z.string() }),
		payload: z.object({ action: z.string(), pull_request: z.object({ number: z.number(), title: z.string() }) }),
	}),
]);

export const GitHubRawSchema = FetchedAtSchema.extend({
	events: z.array(GitHubEventSchema),
});

export const BlueSkyAuthorSchema = z.object({
	did: z.string(),
	handle: z.string(),
	displayName: z.string().optional(),
	avatar: z.string().url().optional(),
});

export const BlueSkyPostSchema = z.object({
	uri: z.string(),
	cid: z.string(),
	author: BlueSkyAuthorSchema,
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
	replyCount: z.number().optional(),
	repostCount: z.number().optional(),
	likeCount: z.number().optional(),
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

export const BlueSkyFeedItemSchema = z.object({
	post: BlueSkyPostSchema,
	reason: z
		.object({
			$type: z.string(),
			by: BlueSkyAuthorSchema.optional(),
		})
		.optional(),
});

export const BlueSkyRawSchema = FetchedAtSchema.extend({
	feed: z.array(BlueSkyFeedItemSchema),
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
	tags: z.array(z.string()).optional(),
	created_at: z.string(),
	updated_at: z.string(),
	due_date: z.string().optional(),
	completed_at: z.string().optional(),
});

export const DevpadRawSchema = FetchedAtSchema.extend({
	tasks: z.array(DevpadTaskSchema),
});
