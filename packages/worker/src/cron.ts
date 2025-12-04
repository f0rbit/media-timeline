import type { Bindings } from "./bindings";
import { createRawStore, createTimelineStore, rawStoreId } from "./corpus";

type Account = {
	id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
};

type AccountWithUser = Account & { user_id: string };

type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

type RateLimitState = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number;
	circuit_open_until: string | null;
};

export type CronResult = {
	processed_accounts: number;
	updated_users: string[];
	failed_accounts: string[];
	timelines_generated: number;
};

export type ProviderFactory = {
	create(platform: string, token: string): Promise<Record<string, unknown>>;
};

async function decrypt(encrypted: string, key: string): Promise<string> {
	const decoder = new TextDecoder();
	const keyData = new TextEncoder().encode(key.padEnd(32, "0").slice(0, 32));
	const cryptoKey = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["decrypt"]);
	const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
	const iv = combined.slice(0, 12);
	const data = combined.slice(12);
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, data);
	return decoder.decode(decrypted);
}

function canFetch(state: RateLimitState | null): boolean {
	if (!state) return true;

	const now = new Date().toISOString();

	if (state.circuit_open_until && state.circuit_open_until > now) return false;
	if (state.remaining !== null && state.remaining <= 0 && state.reset_at && state.reset_at > now) return false;

	return true;
}

function calculateBackoff(failures: number): number {
	const base = 60 * 1000;
	const maxBackoff = 30 * 60 * 1000;
	return Math.min(base * 2 ** failures, maxBackoff);
}

const defaultProviderFactory: ProviderFactory = {
	async create(platform, token) {
		switch (platform) {
			case "github":
				return fetchGitHub(token);
			case "bluesky":
				return fetchBluesky(token);
			case "youtube":
				return fetchYouTube(token);
			case "devpad":
				return fetchDevpad(token);
			default:
				throw new Error(`Unknown platform: ${platform}`);
		}
	},
};

export async function handleCron(env: Bindings, providerFactory: ProviderFactory = defaultProviderFactory): Promise<CronResult> {
	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const { results: accountsWithUsers } = await env.DB.prepare(`
      SELECT 
        a.id,
        a.platform,
        a.platform_user_id,
        a.access_token_encrypted,
        a.refresh_token_encrypted,
        am.user_id
      FROM accounts a
      INNER JOIN account_members am ON a.id = am.account_id
      WHERE a.is_active = 1
    `).all<AccountWithUser>();

	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}

	const updatedUsers = new Set<string>();

	for (const [userId, accounts] of userAccounts) {
		const results = await Promise.allSettled(
			accounts.map(async account => {
				result.processed_accounts++;
				const snapshot = await processAccount(env, account, providerFactory);
				if (snapshot) {
					updatedUsers.add(userId);
					return snapshot;
				}
				return null;
			})
		);

		for (const res of results) {
			if (res.status === "rejected") {
				console.error("Account processing failed:", res.reason);
			}
		}
	}

	for (const userId of updatedUsers) {
		const accounts = userAccounts.get(userId) ?? [];
		const snapshots = await gatherLatestSnapshots(env, accounts);
		await combineUserTimeline(env, userId, snapshots);
		result.timelines_generated++;
	}

	result.updated_users = Array.from(updatedUsers);
	return result;
}

async function processAccount(env: Bindings, account: AccountWithUser, providerFactory: ProviderFactory): Promise<RawSnapshot | null> {
	const rateLimitRow = await env.DB.prepare("SELECT remaining, reset_at, consecutive_failures, circuit_open_until FROM rate_limits WHERE account_id = ?").bind(account.id).first<RateLimitState>();

	if (!canFetch(rateLimitRow)) {
		return null;
	}

	const token = await decrypt(account.access_token_encrypted, env.ENCRYPTION_KEY);

	try {
		const rawData = await providerFactory.create(account.platform, token);
		const { store } = createRawStore(account.platform, account.id, env);

		const putResult = await store.put(rawData, {
			tags: [`platform:${account.platform}`, `account:${account.id}`],
		});

		if (!putResult.ok) {
			console.error("Failed to store raw data:", putResult.error);
			return null;
		}

		const now = new Date().toISOString();
		await env.DB.prepare(`
        INSERT INTO rate_limits (id, account_id, consecutive_failures, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT (account_id) DO UPDATE SET consecutive_failures = 0, updated_at = ?
      `)
			.bind(crypto.randomUUID(), account.id, now, now)
			.run();

		await env.DB.prepare("UPDATE accounts SET last_fetched_at = ?, updated_at = ? WHERE id = ?").bind(now, now, account.id).run();

		return {
			account_id: account.id,
			platform: account.platform,
			version: putResult.value.version,
			data: rawData,
		};
	} catch (error) {
		const failures = (rateLimitRow?.consecutive_failures ?? 0) + 1;
		const backoffMs = calculateBackoff(failures);
		const circuitOpenUntil = new Date(Date.now() + backoffMs).toISOString();
		const now = new Date().toISOString();

		await env.DB.prepare(`
        INSERT INTO rate_limits (id, account_id, consecutive_failures, last_failure_at, circuit_open_until, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (account_id) DO UPDATE SET
          consecutive_failures = ?,
          last_failure_at = ?,
          circuit_open_until = ?,
          updated_at = ?
      `)
			.bind(crypto.randomUUID(), account.id, failures, now, circuitOpenUntil, now, failures, now, circuitOpenUntil, now)
			.run();

		console.error(`Fetch failed for account ${account.id}:`, error);
		return null;
	}
}

async function fetchGitHub(token: string): Promise<Record<string, unknown>> {
	const response = await fetch("https://api.github.com/users/me/events?per_page=100", {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
	const events = await response.json();
	return { events, fetched_at: new Date().toISOString() };
}

async function fetchBluesky(token: string): Promise<Record<string, unknown>> {
	const response = await fetch("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?limit=100", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) throw new Error(`Bluesky API error: ${response.status}`);
	const data = (await response.json()) as Record<string, unknown>;
	return { ...data, fetched_at: new Date().toISOString() };
}

async function fetchYouTube(token: string): Promise<Record<string, unknown>> {
	const response = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=50", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
	const data = (await response.json()) as Record<string, unknown>;
	return { ...data, fetched_at: new Date().toISOString() };
}

async function fetchDevpad(token: string): Promise<Record<string, unknown>> {
	const response = await fetch("https://api.devpad.io/tasks", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) throw new Error(`Devpad API error: ${response.status}`);
	const tasks = await response.json();
	return { tasks, fetched_at: new Date().toISOString() };
}

async function gatherLatestSnapshots(env: Bindings, accounts: AccountWithUser[]): Promise<RawSnapshot[]> {
	const snapshots: RawSnapshot[] = [];

	for (const account of accounts) {
		const { store } = createRawStore(account.platform, account.id, env);
		const result = await store.get_latest();

		if (result.ok) {
			snapshots.push({
				account_id: account.id,
				platform: account.platform,
				version: result.value.meta.version,
				data: result.value.data,
			});
		}
	}

	return snapshots;
}

async function combineUserTimeline(env: Bindings, userId: string, snapshots: RawSnapshot[]): Promise<void> {
	if (snapshots.length === 0) return;

	const items = snapshots.flatMap(snapshot => normalizeSnapshot(snapshot));
	const commitItems = items.filter(isCommitItem);
	const nonCommitItems = items.filter(item => !isCommitItem(item));
	const grouped = groupByRepo(commitItems);
	const allEntries: Array<TimelineItem | CommitGroup> = [...grouped, ...nonCommitItems];
	const dateGroups = groupByDate(allEntries);

	const timeline = {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};

	const { store } = createTimelineStore(userId, env);

	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));

	await store.put(timeline, { parents });
}

type TimelineItem = {
	id: string;
	platform: string;
	type: string;
	timestamp: string;
	title: string;
	url?: string;
	payload: Record<string, unknown>;
};

type CommitGroup = {
	type: "commit_group";
	repo: string;
	date: string;
	commits: TimelineItem[];
	total_additions?: number;
	total_deletions?: number;
};

type GitHubEvent = {
	id: string;
	type: string;
	created_at: string;
	repo: { name: string };
	payload?: { commits?: Array<{ sha: string; message: string }> };
};

type BlueSkyFeedItem = {
	post: {
		uri: string;
		record: { text: string; createdAt: string };
		author: { handle: string };
	};
};

type YouTubeItem = {
	id: { videoId: string };
	snippet: { publishedAt: string; title: string; channelTitle: string };
};

type DevpadTask = {
	id: string;
	title: string;
	status: string;
	updated_at: string;
	project?: string;
};

function normalizeSnapshot(snapshot: RawSnapshot): TimelineItem[] {
	switch (snapshot.platform) {
		case "github":
			return normalizeGitHub(snapshot.data);
		case "bluesky":
			return normalizeBluesky(snapshot.data);
		case "youtube":
			return normalizeYouTube(snapshot.data);
		case "devpad":
			return normalizeDevpad(snapshot.data);
		default:
			return [];
	}
}

function normalizeGitHub(data: unknown): TimelineItem[] {
	const raw = data as { events: GitHubEvent[] };
	if (!raw.events) return [];

	return raw.events
		.filter(e => e.type === "PushEvent")
		.flatMap(event =>
			(event.payload?.commits ?? []).map(commit => ({
				id: `github:${commit.sha}`,
				platform: "github",
				type: "commit",
				timestamp: event.created_at,
				title: commit.message.split("\n")[0] ?? "",
				url: `https://github.com/${event.repo.name}/commit/${commit.sha}`,
				payload: {
					type: "commit",
					sha: commit.sha,
					message: commit.message,
					repo: event.repo.name,
				},
			}))
		);
}

function normalizeBluesky(data: unknown): TimelineItem[] {
	const raw = data as { feed?: BlueSkyFeedItem[] };
	if (!raw.feed) return [];

	return raw.feed.map(item => ({
		id: `bluesky:${item.post.uri}`,
		platform: "bluesky",
		type: "post",
		timestamp: item.post.record.createdAt,
		title: item.post.record.text.slice(0, 100),
		url: `https://bsky.app/profile/${item.post.author.handle}/post/${item.post.uri.split("/").pop()}`,
		payload: {
			type: "post",
			content: item.post.record.text,
			author_handle: item.post.author.handle,
		},
	}));
}

function normalizeYouTube(data: unknown): TimelineItem[] {
	const raw = data as { items?: YouTubeItem[] };
	if (!raw.items) return [];

	return raw.items.map(item => ({
		id: `youtube:${item.id.videoId}`,
		platform: "youtube",
		type: "video",
		timestamp: item.snippet.publishedAt,
		title: item.snippet.title,
		url: `https://youtube.com/watch?v=${item.id.videoId}`,
		payload: {
			type: "video",
			channel_id: item.snippet.channelTitle,
			channel_title: item.snippet.channelTitle,
		},
	}));
}

function normalizeDevpad(data: unknown): TimelineItem[] {
	const raw = data as { tasks?: DevpadTask[] };
	if (!raw.tasks) return [];

	return raw.tasks.map(task => ({
		id: `devpad:${task.id}`,
		platform: "devpad",
		type: "task",
		timestamp: task.updated_at,
		title: task.title,
		payload: {
			type: "task",
			status: task.status,
			project: task.project,
		},
	}));
}

function isCommitItem(item: TimelineItem): boolean {
	return item.type === "commit";
}

function groupByRepo(commits: TimelineItem[]): CommitGroup[] {
	const groups = new Map<string, TimelineItem[]>();

	for (const commit of commits) {
		const payload = commit.payload as { repo: string };
		const date = commit.timestamp.split("T")[0] ?? "";
		const key = `${payload.repo}:${date}`;
		const existing = groups.get(key) ?? [];
		existing.push(commit);
		groups.set(key, existing);
	}

	return Array.from(groups.entries()).map(([key, commits]) => {
		const parts = key.split(":");
		const repo = parts[0] ?? "";
		const date = parts[1] ?? "";
		return {
			type: "commit_group" as const,
			repo,
			date,
			commits,
		};
	});
}

type DateGroup = {
	date: string;
	items: Array<TimelineItem | CommitGroup>;
};

function groupByDate(items: Array<TimelineItem | CommitGroup>): DateGroup[] {
	const groups = new Map<string, Array<TimelineItem | CommitGroup>>();

	for (const item of items) {
		const date = "date" in item ? item.date : (item.timestamp.split("T")[0] ?? "");
		const existing = groups.get(date) ?? [];
		existing.push(item);
		groups.set(date, existing);
	}

	return Array.from(groups.entries())
		.map(([date, items]) => ({ date, items }))
		.sort((a, b) => b.date.localeCompare(a.date));
}
