import type { GitHubFetchResult } from "../../src/platforms/github";
import type {
	BlueskyAuthor,
	BlueskyFeedItem,
	BlueskyPost,
	BlueskyRaw,
	DevpadRaw,
	DevpadTask,
	GitHubEvent,
	GitHubExtendedCommit,
	GitHubRaw,
	GitHubRepoCommitsStore,
	GitHubRepoMeta,
	GitHubRepoPRsStore,
	RedditComment,
	RedditPost,
	TwitterTweet,
	YouTubeRaw,
	YouTubeVideo,
} from "../../src/schema";
import type { GitHubTimelineData } from "../../src/timeline-github";
import { type DeepPartial, days_ago, hours_ago, merge_deep, minutes_ago, random_sha, uuid } from "../../src/utils";

export type GitHubExtendedCommitInput = {
	sha?: string;
	message?: string;
	date?: string;
	url?: string;
	repo?: string;
	branch?: string;
};

export const makeGitHubExtendedCommit = (overrides: GitHubExtendedCommitInput = {}): GitHubExtendedCommit => {
	const sha = overrides.sha ?? random_sha();
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

export const makeGitHubTimelineData = (commits: GitHubExtendedCommit[] = []): GitHubTimelineData => ({
	commits: commits.map(c => ({
		sha: c.sha,
		message: c.message,
		author_name: "Test User",
		author_email: "test@example.com",
		author_date: c.date,
		committer_name: "Test User",
		committer_email: "test@example.com",
		committer_date: c.date,
		url: c.url,
		branch: c.branch,
		_repo: c.repo,
	})),
	prs: [],
});

export const makeBlueskyAuthor = (overrides: DeepPartial<BlueskyAuthor> = {}): BlueskyAuthor =>
	merge_deep(
		{
			did: `did:plc:${uuid().slice(0, 24)}`,
			handle: "test.bsky.social",
			displayName: "Test User",
			avatar: "https://cdn.bsky.social/avatar.jpg",
		},
		overrides
	);

export const makeBlueskyPost = (overrides: DeepPartial<BlueskyPost> = {}): BlueskyPost =>
	merge_deep(
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

export const makeBlueskyFeedItem = (overrides: DeepPartial<BlueskyFeedItem> = {}): BlueskyFeedItem => merge_deep({ post: makeBlueskyPost() }, overrides);

export const makeBlueskyRaw = (feed: BlueskyFeedItem[] = [], cursor?: string, fetchedAt?: string): BlueskyRaw => ({
	feed,
	cursor,
	fetched_at: fetchedAt ?? new Date().toISOString(),
});

export const makeYouTubeVideo = (overrides: DeepPartial<YouTubeVideo> = {}): YouTubeVideo =>
	merge_deep(
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
	singleCommit: (repo = "alice/project", timestamp = hours_ago(1)) => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ repo, date: timestamp, message: "Initial commit" })]);
	},

	multipleCommitsSameDay: (repo = "alice/project", baseTimestamp = hours_ago(2)) => {
		return makeGitHubRaw([
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature A" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature B" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "fix: bug fix" }),
		]);
	},

	multipleReposSameDay: (timestamp = hours_ago(1)) => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ repo: "alice/repo-a", date: timestamp, message: "update repo-a" }), makeGitHubExtendedCommit({ repo: "alice/repo-b", date: timestamp, message: "update repo-b" })]);
	},

	acrossMultipleDays: () => {
		return makeGitHubRaw([
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(0), message: "today commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(1), message: "yesterday commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(2), message: "two days ago commit" }),
		]);
	},

	withNonPushEvents: () => {
		return makeGitHubRaw([makeGitHubExtendedCommit({ date: hours_ago(1), message: "a commit" })], [makeGitHubWatchEvent({ created_at: hours_ago(2) })]);
	},

	empty: () => makeGitHubRaw([]),
};

export const GITHUB_TIMELINE_FIXTURES = {
	singleCommit: (repo = "alice/project", timestamp = hours_ago(1)) => {
		return makeGitHubTimelineData([makeGitHubExtendedCommit({ repo, date: timestamp, message: "Initial commit" })]);
	},

	multipleCommitsSameDay: (repo = "alice/project", baseTimestamp = hours_ago(2)) => {
		return makeGitHubTimelineData([
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature A" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "feat: add feature B" }),
			makeGitHubExtendedCommit({ repo, date: baseTimestamp, message: "fix: bug fix" }),
		]);
	},

	multipleReposSameDay: (timestamp = hours_ago(1)) => {
		return makeGitHubTimelineData([makeGitHubExtendedCommit({ repo: "alice/repo-a", date: timestamp, message: "update repo-a" }), makeGitHubExtendedCommit({ repo: "alice/repo-b", date: timestamp, message: "update repo-b" })]);
	},

	acrossMultipleDays: () => {
		return makeGitHubTimelineData([
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(0), message: "today commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(1), message: "yesterday commit" }),
			makeGitHubExtendedCommit({ repo: "alice/project", date: days_ago(2), message: "two days ago commit" }),
		]);
	},

	withNonPushEvents: () => {
		return makeGitHubTimelineData([makeGitHubExtendedCommit({ date: hours_ago(1), message: "a commit" })]);
	},

	empty: () => makeGitHubTimelineData([]),
};

// New format fixtures for GitHubFetchResult (used by GitHubMemoryProvider)
export const makeGitHubRepoMeta = (repo = "alice/project"): GitHubRepoMeta => {
	const [owner, name] = repo.split("/");
	return {
		owner: owner ?? "alice",
		name: name ?? "project",
		full_name: repo,
		default_branch: "main",
		branches: ["main"],
		is_private: false,
		pushed_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
};

export const makeGitHubRepoCommitsStore = (repo = "alice/project", commits: Array<{ sha?: string; message?: string; date?: string }> = []): GitHubRepoCommitsStore => {
	const [owner, name] = repo.split("/");
	const now = new Date().toISOString();
	return {
		owner: owner ?? "alice",
		repo: name ?? "project",
		branches: ["main"],
		commits: commits.map(c => ({
			sha: c.sha ?? random_sha(),
			message: c.message ?? "feat: add new feature",
			author_name: "Test User",
			author_email: "test@example.com",
			author_date: c.date ?? now,
			committer_name: "Test User",
			committer_email: "test@example.com",
			committer_date: c.date ?? now,
			url: `https://github.com/${repo}/commit/${c.sha ?? "abc123"}`,
			branch: "main",
		})),
		total_commits: commits.length,
		fetched_at: now,
	};
};

export const makeGitHubRepoPRsStore = (repo = "alice/project"): GitHubRepoPRsStore => {
	const [owner, name] = repo.split("/");
	return {
		owner: owner ?? "alice",
		repo: name ?? "project",
		pull_requests: [],
		total_prs: 0,
		fetched_at: new Date().toISOString(),
	};
};

export const makeGitHubFetchResult = (repos: Array<{ repo: string; commits: Array<{ sha?: string; message?: string; date?: string }> }>): GitHubFetchResult => {
	const repoMetas = repos.map(r => makeGitHubRepoMeta(r.repo));
	const repoData = new Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>();

	for (const r of repos) {
		repoData.set(r.repo, {
			commits: makeGitHubRepoCommitsStore(r.repo, r.commits),
			prs: makeGitHubRepoPRsStore(r.repo),
		});
	}

	return {
		meta: {
			username: "test-user",
			repositories: repoMetas,
			total_repos_available: repos.length,
			repos_fetched: repos.length,
			fetched_at: new Date().toISOString(),
		},
		repos: repoData,
	};
};

export const GITHUB_V2_FIXTURES = {
	singleCommit: (repo = "alice/project", timestamp = hours_ago(1)) => makeGitHubFetchResult([{ repo, commits: [{ message: "Initial commit", date: timestamp }] }]),

	multipleCommitsSameDay: (repo = "alice/project", baseTimestamp = hours_ago(2)) =>
		makeGitHubFetchResult([
			{
				repo,
				commits: [
					{ message: "feat: add feature A", date: baseTimestamp },
					{ message: "feat: add feature B", date: baseTimestamp },
					{ message: "fix: bug fix", date: baseTimestamp },
				],
			},
		]),

	empty: () => makeGitHubFetchResult([]),
};

export const BLUESKY_FIXTURES = {
	singlePost: (timestamp = hours_ago(1)) =>
		makeBlueskyRaw([
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: { text: "Hello world!", createdAt: timestamp },
				}),
			}),
		]),

	multiplePosts: (count = 3, _baseTimestamp = hours_ago(1)) => {
		const feed = Array.from({ length: count }, (_, i) =>
			makeBlueskyFeedItem({
				post: makeBlueskyPost({
					record: { text: `Post number ${i + 1}`, createdAt: minutes_ago(i * 30) },
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
					record: { text: "Check out this image!", createdAt: hours_ago(1) },
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
						createdAt: hours_ago(1),
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
	singleVideo: (timestamp = hours_ago(1)) =>
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
					publishedAt: hours_ago(i * 24),
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
					publishedAt: hours_ago(1),
					channelId: "UC_channel_A",
					title: "Video from Channel A",
					description: "",
					thumbnails: {},
					channelTitle: "Channel A",
				},
			}),
			makeYouTubeVideo({
				snippet: {
					publishedAt: hours_ago(2),
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
	singleTask: (timestamp = hours_ago(1)) => makeDevpadRaw([makeDevpadTask({ updated_at: timestamp })]),

	multipleTasks: (count = 3) => {
		const tasks = Array.from({ length: count }, (_, i) =>
			makeDevpadTask({
				title: `Task ${i + 1}`,
				status: (["todo", "in_progress", "done"] as const)[i % 3],
				priority: (["low", "medium", "high"] as const)[i % 3],
				updated_at: hours_ago(i),
			})
		);
		return makeDevpadRaw(tasks);
	},

	completedTasks: () =>
		makeDevpadRaw([
			makeDevpadTask({
				title: "Completed task",
				status: "done",
				completed_at: hours_ago(2),
				updated_at: hours_ago(2),
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
	alice_reddit: {
		id: "acc-alice-reddit",
		platform: "reddit" as const,
		platform_user_id: "reddit-alice-123",
		platform_username: "alice_redditor",
		access_token: "reddit_alice_token",
		is_active: true,
	},
	bob_reddit: {
		id: "acc-bob-reddit",
		platform: "reddit" as const,
		platform_user_id: "reddit-bob-456",
		platform_username: "bob_redditor",
		access_token: "reddit_bob_token",
		is_active: true,
	},
	alice_twitter: {
		id: "acc-alice-twitter",
		platform: "twitter" as const,
		platform_user_id: "twitter-alice-123",
		platform_username: "alice_tweeter",
		access_token: "twitter_alice_token",
		is_active: true,
	},
};

export const API_KEYS = {
	alice_primary: "mtl_alice_primary_key_abc123",
	alice_secondary: "mtl_alice_secondary_key_def456",
	bob_primary: "mtl_bob_primary_key_ghi789",
};

export const PROFILES = {
	alice_main: {
		id: "profile-alice-main",
		slug: "main",
		name: "Alice Main Profile",
		description: "My main public profile",
	},
	alice_work: {
		id: "profile-alice-work",
		slug: "work",
		name: "Alice Work Profile",
		description: "Work-related activity only",
	},
	bob_main: {
		id: "profile-bob-main",
		slug: "main",
		name: "Bob Main Profile",
	},
	charlie_main: {
		id: "profile-charlie-main",
		slug: "main",
		name: "Charlie Main Profile",
	},
	org_admin_main: {
		id: "profile-org-admin-main",
		slug: "main",
		name: "Org Admin Profile",
	},
};

export const makeTimelineItem = (
	overrides: Partial<{
		id: string;
		platform: "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";
		type: "commit" | "post" | "video" | "task" | "comment";
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
	payload: { type: "commit", sha: random_sha(), message: "test", repo: "test/repo", branch: "main" },
	...overrides,
});

// Reddit fixtures
export const makeRedditPost = (overrides: Partial<RedditPost> = {}): RedditPost => ({
	id: crypto.randomUUID().slice(0, 7),
	name: `t3_${crypto.randomUUID().slice(0, 7)}`,
	title: "Test Reddit Post",
	selftext: "This is a test post",
	url: "https://reddit.com/r/test/comments/abc123/test_post/",
	permalink: "/r/test/comments/abc123/test_post/",
	subreddit: "test",
	subreddit_prefixed: "r/test",
	author: "testuser",
	created_utc: Date.now() / 1000,
	score: 42,
	upvote_ratio: 0.95,
	num_comments: 5,
	is_self: true,
	is_video: false,
	over_18: false,
	spoiler: false,
	stickied: false,
	locked: false,
	archived: false,
	...overrides,
});

export const makeRedditComment = (overrides: Partial<RedditComment> = {}): RedditComment => ({
	id: crypto.randomUUID().slice(0, 7),
	name: `t1_${crypto.randomUUID().slice(0, 7)}`,
	body: "This is a test comment",
	permalink: "/r/test/comments/abc123/test_post/def456/",
	link_id: "t3_abc123",
	link_title: "Parent Post Title",
	link_permalink: "/r/test/comments/abc123/test_post/",
	subreddit: "test",
	subreddit_prefixed: "r/test",
	author: "testuser",
	created_utc: Date.now() / 1000,
	score: 10,
	is_submitter: false,
	stickied: false,
	edited: false,
	parent_id: "t3_abc123",
	...overrides,
});

export const REDDIT_FIXTURES = {
	singlePost: () => [makeRedditPost()],

	multiplePosts: (count = 3) =>
		Array.from({ length: count }, (_, i) =>
			makeRedditPost({
				title: `Post ${i + 1}`,
				score: i * 10,
				created_utc: Date.now() / 1000 - i * 3600,
			})
		),

	singleComment: () => [makeRedditComment()],

	multipleComments: (count = 3) =>
		Array.from({ length: count }, (_, i) =>
			makeRedditComment({
				body: `Comment ${i + 1}`,
				score: i * 5,
			})
		),

	postsWithSubreddits: () => [makeRedditPost({ subreddit: "programming", title: "Programming post" }), makeRedditPost({ subreddit: "typescript", title: "TypeScript post" }), makeRedditPost({ subreddit: "webdev", title: "Web dev post" })],

	commentsWithSubreddits: () => [makeRedditComment({ subreddit: "programming", body: "Programming comment" }), makeRedditComment({ subreddit: "typescript", body: "TypeScript comment" })],

	nsfwPost: () => [makeRedditPost({ over_18: true, title: "NSFW post" })],

	videoPost: () => [
		makeRedditPost({
			is_video: true,
			is_self: false,
			url: "https://v.redd.it/test123",
			title: "Video post",
		}),
	],

	linkPost: () => [
		makeRedditPost({
			is_self: false,
			selftext: "",
			url: "https://example.com/article",
			title: "Link post",
		}),
	],

	empty: () => [],
};

export const makeTwitterTweet = (overrides: Partial<TwitterTweet> = {}): TwitterTweet => ({
	id: crypto.randomUUID().slice(0, 19).replace(/-/g, ""),
	text: "This is a test tweet",
	created_at: new Date().toISOString(),
	author_id: "123456789",
	public_metrics: {
		retweet_count: 5,
		reply_count: 2,
		like_count: 42,
		quote_count: 1,
	},
	possibly_sensitive: false,
	...overrides,
});

export const TWITTER_FIXTURES = {
	singleTweet: () => [makeTwitterTweet()],

	multipleTweets: (count = 3) =>
		Array.from({ length: count }, (_, i) =>
			makeTwitterTweet({
				text: `Tweet ${i + 1}`,
				public_metrics: {
					retweet_count: i * 2,
					reply_count: i,
					like_count: i * 10,
					quote_count: 0,
				},
				created_at: new Date(Date.now() - i * 3600000).toISOString(),
			})
		),

	withRetweet: () => [
		makeTwitterTweet({
			text: "RT @other: Original tweet content",
			referenced_tweets: [{ type: "retweeted", id: "987654321" }],
		}),
	],

	withReply: () => [
		makeTwitterTweet({
			text: "@someone This is a reply",
			in_reply_to_user_id: "111222333",
			referenced_tweets: [{ type: "replied_to", id: "444555666" }],
		}),
	],

	withMedia: () => [
		makeTwitterTweet({
			attachments: { media_keys: ["media_1"] },
		}),
	],

	sensitive: () => [
		makeTwitterTweet({
			text: "Sensitive content tweet",
			possibly_sensitive: true,
		}),
	],

	empty: () => [],
};
