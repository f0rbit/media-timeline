import {
	type BlueskyAuthor,
	type BlueskyFeedItem,
	type BlueskyPost,
	type BlueskyRaw,
	type DeepPartial,
	type DevpadRaw,
	type DevpadTask,
	daysAgo,
	type GitHubCommit,
	type GitHubEvent,
	type GitHubPushEvent,
	type GitHubRaw,
	hoursAgo,
	mergeDeep,
	minutesAgo,
	randomSha,
	uuid,
	type YouTubeRaw,
	type YouTubeVideo,
} from "@media-timeline/core";

export const makeGitHubCommit = (overrides: DeepPartial<GitHubCommit> = {}): GitHubCommit =>
	mergeDeep(
		{
			sha: randomSha(),
			message: "feat: add new feature",
			author: { name: "Test User", email: "test@example.com" },
			url: "https://api.github.com/repos/test/repo/commits/abc123",
		},
		overrides
	);

export const makeGitHubPushEvent = (overrides: DeepPartial<GitHubPushEvent> = {}): GitHubPushEvent =>
	mergeDeep(
		{
			id: uuid(),
			type: "PushEvent" as const,
			created_at: new Date().toISOString(),
			repo: { id: 12345, name: "test-user/test-repo", url: "https://api.github.com/repos/test-user/test-repo" },
			payload: { ref: "refs/heads/main", commits: [makeGitHubCommit()] },
		},
		overrides
	);

export const makeGitHubWatchEvent = (overrides: Partial<GitHubEvent> = {}): GitHubEvent => ({
	id: uuid(),
	type: "WatchEvent",
	created_at: new Date().toISOString(),
	repo: { id: 12345, name: "test-user/test-repo", url: "https://api.github.com/repos/test-user/test-repo" },
	payload: { action: "started" },
	...overrides,
});

export const makeGitHubRaw = (events: GitHubEvent[] = [], fetchedAt?: string): GitHubRaw => ({
	events,
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
			id: { videoId: uuid().slice(0, 11) },
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

export const makeDevpadTask = (overrides: DeepPartial<DevpadTask> = {}): DevpadTask =>
	mergeDeep(
		{
			id: uuid(),
			title: "Test Task",
			status: "todo" as const,
			priority: "medium" as const,
			project: "default",
			tags: ["test"],
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		},
		overrides
	);

export const makeDevpadRaw = (tasks: DevpadTask[] = [], fetchedAt?: string): DevpadRaw => ({
	tasks,
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const GITHUB_FIXTURES = {
	singleCommit: (repo = "alice/project", timestamp = hoursAgo(1)) => {
		const sha = randomSha();
		return makeGitHubRaw([
			makeGitHubPushEvent({
				created_at: timestamp,
				repo: { id: 1, name: repo, url: `https://api.github.com/repos/${repo}` },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ sha, message: "Initial commit" })],
				},
			}),
		]);
	},

	multipleCommitsSameDay: (repo = "alice/project", baseTimestamp = hoursAgo(2)) => {
		const commits = [makeGitHubCommit({ sha: randomSha(), message: "feat: add feature A" }), makeGitHubCommit({ sha: randomSha(), message: "feat: add feature B" }), makeGitHubCommit({ sha: randomSha(), message: "fix: bug fix" })];
		return makeGitHubRaw([
			makeGitHubPushEvent({
				created_at: baseTimestamp,
				repo: { id: 1, name: repo, url: `https://api.github.com/repos/${repo}` },
				payload: { ref: "refs/heads/main", commits },
			}),
		]);
	},

	multipleReposSameDay: (timestamp = hoursAgo(1)) => {
		const events = [
			makeGitHubPushEvent({
				created_at: timestamp,
				repo: { id: 1, name: "alice/repo-a", url: "https://api.github.com/repos/alice/repo-a" },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "update repo-a" })],
				},
			}),
			makeGitHubPushEvent({
				created_at: timestamp,
				repo: { id: 2, name: "alice/repo-b", url: "https://api.github.com/repos/alice/repo-b" },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "update repo-b" })],
				},
			}),
		];
		return makeGitHubRaw(events);
	},

	acrossMultipleDays: () => {
		const events = [
			makeGitHubPushEvent({
				created_at: daysAgo(0),
				repo: { id: 1, name: "alice/project", url: "https://api.github.com/repos/alice/project" },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "today commit" })],
				},
			}),
			makeGitHubPushEvent({
				created_at: daysAgo(1),
				repo: { id: 1, name: "alice/project", url: "https://api.github.com/repos/alice/project" },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "yesterday commit" })],
				},
			}),
			makeGitHubPushEvent({
				created_at: daysAgo(2),
				repo: { id: 1, name: "alice/project", url: "https://api.github.com/repos/alice/project" },
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "two days ago commit" })],
				},
			}),
		];
		return makeGitHubRaw(events);
	},

	withNonPushEvents: () => {
		const events: GitHubEvent[] = [
			makeGitHubPushEvent({
				created_at: hoursAgo(1),
				payload: {
					ref: "refs/heads/main",
					commits: [makeGitHubCommit({ message: "a commit" })],
				},
			}),
			makeGitHubWatchEvent({ created_at: hoursAgo(2) }),
		];
		return makeGitHubRaw(events);
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
		url?: string;
		payload: Record<string, unknown>;
	}> = {}
) => ({
	id: uuid(),
	platform: "github" as const,
	type: "commit" as const,
	timestamp: new Date().toISOString(),
	title: "Test item",
	url: "https://example.com",
	payload: { type: "commit", sha: randomSha(), message: "test", repo: "test/repo" },
	...overrides,
});
