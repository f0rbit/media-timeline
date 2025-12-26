import { GitHubRawSchema, type GitHubRaw, type GitHubEvent, type GitHubPushEvent, type TimelineItem, type CommitPayload } from "../schema";
import { ok, err, type Result } from "../utils";
import { toProviderError, type Provider, type ProviderError, type FetchResult } from "./types";
import { createMemoryProviderState, simulateErrors, type MemoryProviderState, type MemoryProviderControls } from "./memory-base";

// === TYPES ===

export type GitHubProviderConfig = {
	username: string;
};

export type GitHubMemoryConfig = {
	events?: GitHubEvent[];
};

// === HELPERS ===

const parseRateLimitReset = (headers: Headers): number => {
	const resetTimestamp = headers.get("X-RateLimit-Reset");
	return resetTimestamp ? Math.max(0, parseInt(resetTimestamp, 10) - Math.floor(Date.now() / 1000)) : 60;
};

const handleGitHubResponse = async (response: Response): Promise<GitHubRaw> => {
	if (response.status === 401 || response.status === 403) {
		if (response.headers.get("X-RateLimit-Remaining") === "0") {
			throw { kind: "rate_limited", retry_after: parseRateLimitReset(response.headers) } satisfies ProviderError;
		}
		throw { kind: "auth_expired", message: "GitHub token expired or invalid" } satisfies ProviderError;
	}

	if (response.status === 429) {
		throw { kind: "rate_limited", retry_after: parseRateLimitReset(response.headers) } satisfies ProviderError;
	}

	if (!response.ok) {
		throw { kind: "api_error", status: response.status, message: await response.text() } satisfies ProviderError;
	}

	const json = await response.json();
	const result = GitHubRawSchema.safeParse({ events: json, fetched_at: new Date().toISOString() });
	if (!result.success) {
		throw { kind: "api_error", status: 500, message: `Invalid GitHub response: ${result.error.message}` } satisfies ProviderError;
	}
	return result.data;
};

const tryCatchAsync = async <T, E>(fn: () => Promise<T>, mapError: (e: unknown) => E): Promise<Result<T, E>> => {
	try {
		return ok(await fn());
	} catch (e) {
		return err(mapError(e));
	}
};

// === PROVIDER (real API) ===

export class GitHubProvider implements Provider<GitHubRaw> {
	readonly platform = "github";
	private config: GitHubProviderConfig;

	constructor(config: GitHubProviderConfig) {
		this.config = config;
	}

	fetch(token: string): Promise<FetchResult<GitHubRaw>> {
		const url = `https://api.github.com/users/${this.config.username}/events`;
		return tryCatchAsync(
			async () =>
				handleGitHubResponse(
					await fetch(url, {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/vnd.github+json",
							"X-GitHub-Api-Version": "2022-11-28",
						},
					})
				),
			toProviderError
		);
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

export const normalizeGitHub = (raw: GitHubRaw): TimelineItem[] =>
	raw.events.filter(isPushEvent).flatMap(event =>
		event.payload.commits.map((commit): TimelineItem => {
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
		})
	);

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
