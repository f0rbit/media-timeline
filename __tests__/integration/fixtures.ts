import type { BlueskyAuthor, BlueskyFeedItem, BlueskyPost, BlueskyRaw, DevpadRaw, DevpadTask, GitHubEvent, GitHubExtendedCommit, GitHubRaw, YouTubeRaw, YouTubeVideo } from "../../src/schema";
import { daysAgo, type DeepPartial, hoursAgo, mergeDeep, minutesAgo, randomSha, uuid } from "../../src/utils";

export type GitHubExtendedCommitInput = {
	sha?: string;
	message?: string;
	date?: string;
	url?: string;
	repo?: string;
	branch?: string;
};

export const makeGitHubExtendedCommit = (overrides: GitHubExtendedCommitInput = {}): GitHubExtendedCommit => {
	const sha = overrides.sha ?? randomSha();
	const repo = overrides.repo ?? "test-user/test-repo";
	return {
		sha,
		message: overrides.message ?? "feat: add new feature",
		date: overrides.date ?? new Date().toISOString(),
		url: overrides.url ?? `https://github.com/${repo}/commit/${sha}`,
		repo,
		branch: overrides.branch ?? "main",
	};
};

export const makeGitHubWatchEvent = (overrides: Partial<GitHubEvent> = {}): GitHubEvent => {
	const base = {
		id: uuid(),
		type: "WatchEvent" as const,
		created_at: new Date().toISOString(),
		repo: { id: 12345, name: "test-user/test-repo", url: "https://api.github.com/repos/test-user/test-repo" },
		payload: { action: "started" },
	};
	return { ...base, ...overrides } as GitHubEvent;
};

export const makeGitHubRaw = (commits: GitHubExtendedCommit[] = [], events: GitHubEvent[] = [], fetchedAt?: string): GitHubRaw => ({
	events,
	commits,
	pull_requests: [],
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const makeBlueskyAuthor = (overrides: DeepPartial<BlueskyAuthor> = {}): BlueskyAuthor =>
	mergeDeep(
		{
			did: `did:plc:${uuid().slice(0, 24)}`,
			handle: "test.bsky.social",
			displayName: "Test User",
			avatar: "https://cdn.bsky.social/avatar.jpg",
		},
		overrides
	);

export const makeBlueskyPost = (overrides: DeepPartial<BlueskyPost> = {}): BlueskyPost =>
	mergeDeep(
		{
			uri: `at://did:plc:abc123/app.bsky.feed.post/${uuid()}`,
			cid: `bafyrei${uuid().replace(/-/g, "").slice(0, 48)}`,
			author: makeBlueskyAuthor(),
			record: {
				text: "Hello from Bluesky!",
				createdAt: new Date().toISOString(),
			},
			replyCount: 0,
			repostCount: 5,
			likeCount: 42,
		},
		overrides
	);

export const makeBlueskyFeedItem = (overrides: DeepPartial<BlueskyFeedItem> = {}): BlueskyFeedItem => mergeDeep({ post: makeBlueskyPost() }, overrides);

export const makeBlueskyRaw = (feed: BlueskyFeedItem[] = [], cursor?: string, fetchedAt?: string): BlueskyRaw => ({
	feed,
	cursor,
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const makeYouTubeVideo = (overrides: DeepPartial<YouTubeVideo> = {}): YouTubeVideo =>
	mergeDeep(
		{
			kind: "youtube#searchResult",
			etag: "some-etag",
			id: { kind: "youtube#video", videoId: uuid().slice(0, 11) },
			snippet: {
				publishedAt: new Date().toISOString(),
				channelId: `UC${uuid().slice(0, 22)}`,
				title: "Test Video Title",
				description: "A test video description",
				thumbnails: {
					default: { url: "https://i.ytimg.com/vi/abc123/default.jpg" },
					medium: { url: "https://i.ytimg.com/vi/abc123/mqdefault.jpg" },
					high: { url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg" },
				},
				channelTitle: "Test Channel",
			},
		},
		overrides
	);

export const makeYouTubeRaw = (items: YouTubeVideo[] = [], nextPageToken?: string, fetchedAt?: string): YouTubeRaw => ({
	items,
	nextPageToken,
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const makeDevpadTask = (overrides: Partial<DevpadTask> = {}): DevpadTask => ({
	id: uuid(),
	title: "Test Task",
	status: "todo",
	priority: "medium",
	project: "default",
	tags: ["test"],
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	...overrides,
});

export const makeDevpadRaw = (tasks: DevpadTask[] = [], fetchedAt?: string): DevpadRaw => ({
	tasks,
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const GITHUB_FIXTURES = {
	singleCommit: (repo = "alice/project", timestamp = hoursAgo(1)) => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ repo, date: timestamp, message: "Initial commit" })]);
	},

	multipleCommitsSameDay: (repo = "alice/project", baseTimestamp = hoursAgo(2)) => {
		return makeGitHubRaw([
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature A" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature B" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "fix: bug fix" }),
		]);
	},

	multipleReposSameDay: (timestamp = hoursAgo(1)) => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ repo: "alice/repo-a", date: timestamp, message: "update repo-a" }), makeGitHubExtendedCommit({ repo: "alice/repo-b", date: timestamp, message: "update repo-b" })]);
	},

	acrossMultipleDays: () => {
		return makeGitHubRaw([
			makeGitHubExtendedCommit({ repo: "alice/project", date: daysAgo(0), message: "today commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: daysAgo(1), message: "yesterday commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: daysAgo(2), message: "two days ago commit" }),
		]);
	},

	withNonPushEvents: () => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ date: hoursAgo(1), message: "a commit" })], [makeGitHubWatchEvent({ created_at: hoursAgo(2) })]);
	},

	empty: () => makeGitHubRaw([]),
};

export const BLUESKY_FIXTURES = {
	singlePost: (timestamp = hoursAgo(1)) =>
		makeBlueskyRaw([
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: { text: "Hello world!", createdAt: timestamp },
				}),
			}),
		]),

	multiplePosts: (count = 3, _baseTimestamp = hoursAgo(1)) => {
		const feed = Array.from({ length: count }, (_, i) =>
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: { text: `Post number ${i + 1}`, createdAt: minutesAgo(i * 30) },
					likeCount: i * 10,
				}),
			})
		);
		return makeBlueskyRaw(feed);
	},

	withImages: () =>
		makeBlueskyRaw([
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: { text: "Check out this image!", createdAt: hoursAgo(1) },
					embed: {
						images: [{ thumb: "https://cdn.bsky.social/thumb.jpg", fullsize: "https://cdn.bsky.social/full.jpg" }],
					},
				}),
			}),
		]),

	withReplies: () =>
		makeBlueskyRaw([
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: {
						text: "This is a reply",
						createdAt: hoursAgo(1),
						reply: {
							parent: { uri: "at://did:plc:parent/app.bsky.feed.post/abc" },
							root: { uri: "at://did:plc:root/app.bsky.feed.post/def" },
						},
					},
				}),
			}),
		]),

	empty: () => makeBlueskyRaw([]),
};

export const YOUTUBE_FIXTURES = {
	singleVideo: (timestamp = hoursAgo(1)) =>
		makeYouTubeRaw([
			makeYouTubeVideo({
				snippet: {
					publishedAt: timestamp,
					channelId: "UCtest123",
					title: "My Video",
					description: "Video description",
					thumbnails: {
						high: { url: "https://i.ytimg.com/vi/test/hqdefault.jpg" },
					},
					channelTitle: "My Channel",
				},
			}),
		]),

	multipleVideos: (count = 3) => {
		const items = Array.from({ length: count }, (_, i) =>
			makeYouTubeVideo({
				snippet: {
					publishedAt: hoursAgo(i * 24),
					channelId: "UCtest123",
					title: `Video ${i + 1}`,
					description: `Description ${i + 1}`,
					thumbnails: { high: { url: `https://i.ytimg.com/vi/vid${i}/hqdefault.jpg` } },
					channelTitle: "My Channel",
				},
			})
		);
		return makeYouTubeRaw(items);
	},

	fromMultipleChannels: () =>
		makeYouTubeRaw([
			makeYouTubeVideo({
				snippet: {
					publishedAt: hoursAgo(1),
					channelId: "UC_channel_A",
					title: "Video from Channel A",
					description: "",
					thumbnails: {},
					channelTitle: "Channel A",
				},
			}),
			makeYouTubeVideo({
				snippet: {
					publishedAt: hoursAgo(2),
					channelId: "UC_channel_B",
					title: "Video from Channel B",
					description: "",
					thumbnails: {},
					channelTitle: "Channel B",
				},
			}),
		]),

	empty: () => makeYouTubeRaw([]),
};

export const DEVPAD_FIXTURES = {
	singleTask: (timestamp = hoursAgo(1)) => makeDevpadRaw([makeDevpadTask({ updated_at: timestamp })]),

	multipleTasks: (count = 3) => {
		const tasks = Array.from({ length: count }, (_, i) =>
			makeDevpadTask({
				title: `Task ${i + 1}`,
				status: (["todo", "in_progress", "done"] as const)[i % 3],
				priority: (["low", "medium", "high"] as const)[i % 3],
				updated_at: hoursAgo(i),
			})
		);
		return makeDevpadRaw(tasks);
	},

	completedTasks: () =>
		makeDevpadRaw([
			makeDevpadTask({
				title: "Completed task",
				status: "done",
				completed_at: hoursAgo(2),
				updated_at: hoursAgo(2),
			}),
		]),

	withProjects: () =>
		makeDevpadRaw([makeDevpadTask({ title: "Task in Project A", project: "project-a" }), makeDevpadTask({ title: "Task in Project B", project: "project-b" }), makeDevpadTask({ title: "Default project task", project: "default" })]),

	empty: () => makeDevpadRaw([]),
};

export const USERS = {
	alice: {
		id: "user-alice",
		email: "alice@example.com",
		name: "Alice",
	},
	bob: {
		id: "user-bob",
		email: "bob@example.com",
		name: "Bob",
	},
	charlie: {
		id: "user-charlie",
		email: "charlie@example.com",
		name: "Charlie",
	},
	org_admin: {
		id: "user-org-admin",
		email: "admin@org.example.com",
		name: "Org Admin",
	},
};

export const ACCOUNTS = {
	alice_github: {
		id: "acc-alice-github",
		platform: "github" as const,
		platform_user_id: "gh-alice-123",
		platform_username: "alice",
		access_token: "ghp_alice_token",
		is_active: true,
	},
	alice_bluesky: {
		id: "acc-alice-bluesky",
		platform: "bluesky" as const,
		platform_user_id: "did:plc:alice123",
		platform_username: "alice.bsky.social",
		access_token: "bsky_alice_token",
		is_active: true,
	},
	bob_github: {
		id: "acc-bob-github",
		platform: "github" as const,
		platform_user_id: "gh-bob-456",
		platform_username: "bob",
		access_token: "ghp_bob_token",
		is_active: true,
	},
	bob_youtube: {
		id: "acc-bob-youtube",
		platform: "youtube" as const,
		platform_user_id: "yt-bob-789",
		platform_username: "BobChannel",
		access_token: "ya29_bob_token",
		is_active: true,
	},
	shared_org_github: {
		id: "acc-org-github",
		platform: "github" as const,
		platform_user_id: "gh-org-999",
		platform_username: "org-team",
		access_token: "ghp_org_token",
		is_active: true,
	},
	inactive_account: {
		id: "acc-inactive",
		platform: "github" as const,
		platform_user_id: "gh-inactive",
		platform_username: "inactive-user",
		access_token: "ghp_inactive_token",
		is_active: false,
	},
	devpad_account: {
		id: "acc-devpad",
		platform: "devpad" as const,
		platform_user_id: "devpad-123",
		platform_username: "devpad-user",
		access_token: "devpad_token",
		is_active: true,
	},
};

export const API_KEYS = {
	alice_primary: "mtl_alice_primary_key_abc123",
	alice_secondary: "mtl_alice_secondary_key_def456",
	bob_primary: "mtl_bob_primary_key_ghi789",
};

export const makeTimelineItem = (
	overrides: Partial<{
		id: string;
		platform: "github" | "bluesky" | "youtube" | "devpad";
		type: "commit" | "post" | "video" | "task";
		timestamp: string;
		title: string;
		url: string;
		payload: Record<string, unknown>;
	}> = {}
) => ({
	id: uuid(),
	platform: "github" as const,
	type: "commit" as const,
	timestamp: new Date().toISOString(),
	title: "Test item",
	url: "https://example.com",
	payload: { type: "commit", sha: randomSha(), message: "test", repo: "test/repo", branch: "main" },
	...overrides,
});
