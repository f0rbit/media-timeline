import { Octokit } from "octokit";
import { GitHubRawSchema, type GitHubRaw, type GitHubEvent, type GitHubPushEvent, type TimelineItem, type CommitPayload } from "../schema";
import { ok, err, type Result } from "../utils";
import { toProviderError, type Provider, type ProviderError, type FetchResult } from "./types";
import { createMemoryProviderState, simulateErrors, type MemoryProviderState, type MemoryProviderControls } from "./memory-base";

// === TYPES ===

export type GitHubProviderConfig = {
	username?: string;
};

export type GitHubMemoryConfig = {
	events?: GitHubEvent[];
};

// === HELPERS ===

const parseRateLimitReset = (resetTimestamp: number | undefined): number => {
	if (!resetTimestamp) return 60;
	return Math.max(0, resetTimestamp - Math.floor(Date.now() / 1000));
};

// === PROVIDER (real API using Octokit) ===

export class GitHubProvider implements Provider<GitHubRaw> {
	readonly platform = "github";
	private config: GitHubProviderConfig;

	constructor(config: GitHubProviderConfig = {}) {
		this.config = config;
	}

	async fetch(token: string): Promise<FetchResult<GitHubRaw>> {
		console.log("[GitHubProvider.fetch] Starting with Octokit");
		console.log("[GitHubProvider.fetch] Token present:", !!token);
		console.log("[GitHubProvider.fetch] Config username:", this.config.username ?? "will auto-discover");

		try {
			const octokit = new Octokit({
				auth: token,
				userAgent: "media-timeline/1.0.0",
			});

			let username = this.config.username;
			if (!username) {
				console.log("[GitHubProvider.fetch] Fetching authenticated user info...");
				const { data: user } = await octokit.rest.users.getAuthenticated();
				username = user.login;
				console.log("[GitHubProvider.fetch] Authenticated as:", username);
			}

			console.log("[GitHubProvider.fetch] Fetching events for user:", username);
			const { data: events } = await octokit.rest.activity.listEventsForAuthenticatedUser({
				username,
				per_page: 100,
			});

			console.log("[GitHubProvider.fetch] Fetched events count:", events.length);
			console.log(
				"[GitHubProvider.fetch] Event types:",
				events.map(e => e.type)
			);

			const transformedEvents = events.map(event => ({
				id: event.id,
				type: event.type ?? "Unknown",
				created_at: event.created_at ?? new Date().toISOString(),
				repo: {
					id: event.repo.id,
					name: event.repo.name,
					url: event.repo.url,
				},
				payload: event.payload as Record<string, unknown>,
			}));

			const rawData = {
				events: transformedEvents,
				fetched_at: new Date().toISOString(),
			};

			console.log("[GitHubProvider.fetch] Raw data preview:", JSON.stringify(rawData).slice(0, 500));

			const result = GitHubRawSchema.safeParse(rawData);
			if (!result.success) {
				console.log("[GitHubProvider.fetch] Schema validation failed:", result.error.message);
				console.log("[GitHubProvider.fetch] Returning unvalidated data with filtered events");
				const filteredEvents = transformedEvents.filter(e => ["PushEvent", "CreateEvent", "WatchEvent", "IssuesEvent", "PullRequestEvent"].includes(e.type));
				return ok({
					events: filteredEvents,
					fetched_at: new Date().toISOString(),
				} as GitHubRaw);
			}

			console.log("[GitHubProvider.fetch] Schema validation passed");
			return ok(result.data);
		} catch (error: unknown) {
			console.log("[GitHubProvider.fetch] Error occurred:", error);
			return err(this.mapError(error));
		}
	}

	private mapError(error: unknown): ProviderError {
		if (error && typeof error === "object" && "status" in error) {
			const status = (error as { status: number }).status;
			const response = (error as { response?: { headers?: Record<string, string | number> } }).response;

			if (status === 401 || status === 403) {
				const rateLimitRemaining = response?.headers?.["x-ratelimit-remaining"];
				const rateLimitReset = response?.headers?.["x-ratelimit-reset"];

				if (rateLimitRemaining === 0 && rateLimitReset) {
					return { kind: "rate_limited", retry_after: parseRateLimitReset(Number(rateLimitReset)) };
				}
				return { kind: "auth_expired", message: "GitHub token expired or invalid" };
			}

			if (status === 429) {
				const rateLimitReset = response?.headers?.["x-ratelimit-reset"];
				return { kind: "rate_limited", retry_after: parseRateLimitReset(rateLimitReset ? Number(rateLimitReset) : undefined) };
			}

			const message = (error as { message?: string }).message ?? "Unknown API error";
			return { kind: "api_error", status, message };
		}

		return toProviderError(error);
	}
}

// === NORMALIZER ===

const isPushEvent = (event: { type: string }): event is GitHubPushEvent => event.type === "PushEvent";

const makeCommitId = (repo: string, sha: string): string => `github:commit:${repo}:${sha.slice(0, 7)}`;

const makeCommitUrl = (repo: string, sha: string): string => `https://github.com/${repo}/commit/${sha}`;

const truncateMessage = (message: string): string => {
	const firstLine = message.split("\n")[0] ?? "";
	return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};

export const normalizeGitHub = (raw: GitHubRaw): TimelineItem[] => {
	console.log("[normalizeGitHub] Input data structure keys:", Object.keys(raw));
	console.log("[normalizeGitHub] Events array length:", raw.events?.length ?? 0);
	console.log("[normalizeGitHub] Events types:", raw.events?.map(e => e.type) ?? []);

	const pushEvents = raw.events.filter(isPushEvent);
	console.log("[normalizeGitHub] PushEvents found:", pushEvents.length);

	const items = pushEvents.flatMap((event, eventIndex) => {
		console.log(`[normalizeGitHub] Processing event ${eventIndex + 1}/${pushEvents.length}:`, { type: event.type, repo: event.repo.name, commits: event.payload.commits.length });
		return event.payload.commits.map((commit, commitIndex): TimelineItem => {
			console.log(`[normalizeGitHub] Processing commit ${commitIndex + 1}/${event.payload.commits.length}:`, { sha: commit.sha.slice(0, 7), message: commit.message.slice(0, 50) });
			const payload: CommitPayload = {
				type: "commit",
				repo: event.repo.name,
				sha: commit.sha,
				message: commit.message,
			};
			return {
				id: makeCommitId(event.repo.name, commit.sha),
				platform: "github",
				type: "commit",
				timestamp: event.created_at,
				title: truncateMessage(commit.message),
				url: makeCommitUrl(event.repo.name, commit.sha),
				payload,
			};
		});
	});

	console.log("[normalizeGitHub] Final items array length:", items.length);
	if (items.length > 0) {
		console.log("[normalizeGitHub] First item:", JSON.stringify(items[0]).slice(0, 300));
	}
	return items;
};

// === MEMORY PROVIDER (for tests) ===

export class GitHubMemoryProvider implements Provider<GitHubRaw>, MemoryProviderControls {
	readonly platform = "github";
	private config: GitHubMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: GitHubMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<FetchResult<GitHubRaw>> {
		return simulateErrors(this.state, () => ({
			events: this.config.events ?? [],
			fetched_at: new Date().toISOString(),
		}));
	}

	getCallCount = () => this.state.call_count;

	reset = () => {
		this.state.call_count = 0;
	};

	setSimulateRateLimit = (value: boolean) => {
		this.state.simulate_rate_limit = value;
	};

	setSimulateAuthExpired = (value: boolean) => {
		this.state.simulate_auth_expired = value;
	};

	setEvents(events: GitHubEvent[]): void {
		this.config.events = events;
	}
}
