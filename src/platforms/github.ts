import { Octokit } from "octokit";
import { parallel_map } from "@f0rbit/corpus";
import { type GitHubRaw, type GitHubEvent, type GitHubExtendedCommit, type GitHubPullRequest, type TimelineItem, type CommitPayload, type PullRequestPayload } from "../schema";
import { ok, err, type Result } from "../utils";
import { toProviderError, type Provider, type ProviderError, type FetchResult } from "./types";
import { createMemoryProviderState, simulateErrors, type MemoryProviderState, type MemoryProviderControls } from "./memory-base";

// === TYPES ===

export type GitHubProviderConfig = {
	username?: string;
};

export type GitHubMemoryConfig = {
	events?: GitHubEvent[];
	commits?: GitHubExtendedCommit[];
	pullRequests?: GitHubPullRequest[];
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

		try {
			const octokit = new Octokit({
				auth: token,
				userAgent: "media-timeline/1.0.0",
			});

			// Get authenticated user
			console.log("[GitHubProvider.fetch] Fetching authenticated user...");
			const { data: user } = await octokit.rest.users.getAuthenticated();
			const username = user.login;
			console.log("[GitHubProvider.fetch] Authenticated as:", username);

			// Fetch events to discover active repos
			console.log("[GitHubProvider.fetch] Fetching events...");
			const { data: events } = await octokit.rest.activity.listEventsForAuthenticatedUser({
				username,
				per_page: 100,
			});
			console.log("[GitHubProvider.fetch] Events fetched:", events.length);

			// Get unique repos from push events (repos user has recently pushed to)
			const pushEvents = events.filter(e => e.type === "PushEvent");

			// Build repo -> branches map from push events
			const repoBranches = new Map<string, Set<string>>();
			for (const event of pushEvents) {
				const payload = event.payload as { ref?: string };
				const ref = payload.ref;
				const branch = ref?.startsWith("refs/heads/") ? ref.replace("refs/heads/", "") : undefined;
				if (branch) {
					const existing = repoBranches.get(event.repo.name) ?? new Set();
					existing.add(branch);
					repoBranches.set(event.repo.name, existing);
				}
			}
			console.log("[GitHubProvider.fetch] Repos with recent pushes:", [...repoBranches.keys()].slice(0, 10));

			// Fetch commits from each repo per branch (limit to 5 repos to avoid rate limits)
			const commits: GitHubExtendedCommit[] = [];
			const reposToFetch = [...repoBranches.entries()].slice(0, 5);

			for (const [repoFullName, branches] of reposToFetch) {
				const [owner, repo] = repoFullName.split("/");
				if (!owner || !repo) continue;

				for (const branch of branches) {
					try {
						console.log(`[GitHubProvider.fetch] Fetching commits for ${repoFullName}@${branch}...`);
						const { data: repoCommits } = await octokit.rest.repos.listCommits({
							owner,
							repo,
							author: username,
							sha: branch,
							per_page: 30,
						});

						for (const commit of repoCommits) {
							commits.push({
								sha: commit.sha,
								message: commit.commit.message,
								date: commit.commit.author?.date ?? commit.commit.committer?.date ?? new Date().toISOString(),
								url: commit.html_url,
								repo: repoFullName,
								branch,
							});
						}
						console.log(`[GitHubProvider.fetch] Got ${repoCommits.length} commits from ${repoFullName}@${branch}`);
					} catch (error) {
						console.log(`[GitHubProvider.fetch] Failed to fetch commits for ${repoFullName}@${branch}:`, error);
					}
				}
			}

			console.log("[GitHubProvider.fetch] Total commits fetched:", commits.length);

			// Extract pull requests from events and fetch full details + commits in parallel
			const prEvents = events.filter(e => e.type === "PullRequestEvent");

			// Deduplicate by PR number per repo (keep first occurrence)
			const seenPRs = new Set<string>();
			const uniquePREvents = prEvents.filter(e => {
				const payload = e.payload as { number?: number };
				const key = `${e.repo.name}:${payload.number}`;
				if (seenPRs.has(key)) return false;
				seenPRs.add(key);
				return true;
			});

			// Prepare PR fetch tasks (limit to 10 to avoid rate limits)
			const prsToFetch = uniquePREvents
				.slice(0, 10)
				.map(event => {
					const payload = event.payload as {
						action?: string;
						number?: number;
						pull_request?: {
							id?: number;
							number?: number;
							merged_at?: string | null;
							head?: { ref?: string };
							base?: { ref?: string };
						};
					};
					return { event, payload };
				})
				.filter(({ payload }) => {
					const prNumber = payload.pull_request?.number ?? payload.number;
					return prNumber !== undefined;
				});

			console.log("[GitHubProvider.fetch] Fetching PR details and commits in parallel for", prsToFetch.length, "PRs");

			// Fetch PR details and commits in parallel (concurrency 3 to respect rate limits)
			const pullRequests = await parallel_map(
				prsToFetch,
				async ({ event, payload }): Promise<GitHubPullRequest> => {
					const prNumber = payload.pull_request?.number ?? payload.number!;
					const [owner, repo] = event.repo.name.split("/");

					if (!owner || !repo) {
						return this.createFallbackPR(event, payload, prNumber);
					}

					try {
						// Fetch full PR details
						const { data: fullPR } = await octokit.rest.pulls.get({
							owner,
							repo,
							pull_number: prNumber,
						});

						// Fetch commits for this PR
						let commitShas: string[] = [];
						try {
							const { data: prCommits } = await octokit.rest.pulls.listCommits({
								owner,
								repo,
								pull_number: prNumber,
								per_page: 100,
							});
							commitShas = prCommits.map(c => c.sha);
							console.log(`[GitHubProvider.fetch] PR #${prNumber}: ${commitShas.length} commits`);
						} catch (e) {
							console.log(`[GitHubProvider.fetch] Failed to fetch commits for PR #${prNumber}`);
						}

						return {
							id: fullPR.id,
							number: fullPR.number,
							title: fullPR.title,
							state: fullPR.merged_at ? "merged" : fullPR.state === "open" ? "open" : "closed",
							action: payload.action ?? "unknown",
							url: fullPR.html_url,
							repo: event.repo.name,
							created_at: fullPR.created_at,
							merged_at: fullPR.merged_at ?? undefined,
							head_ref: fullPR.head.ref,
							base_ref: fullPR.base.ref,
							commit_shas: commitShas,
							merge_commit_sha: fullPR.merge_commit_sha ?? undefined,
						};
					} catch (error) {
						console.log(`[GitHubProvider.fetch] Failed to fetch PR #${prNumber} from ${event.repo.name}:`, error);
						return this.createFallbackPR(event, payload, prNumber);
					}
				},
				3 // concurrency limit
			);

			console.log("[GitHubProvider.fetch] Pull requests fetched:", pullRequests.length);
			console.log("[GitHubProvider.fetch] PRs with commits:", pullRequests.filter(pr => (pr.commit_shas?.length ?? 0) > 0).length);

			// Transform events for legacy compatibility
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

			const rawData: GitHubRaw = {
				events: transformedEvents,
				commits,
				pull_requests: pullRequests,
				fetched_at: new Date().toISOString(),
			};

			console.log("[GitHubProvider.fetch] Raw data summary:", {
				events: rawData.events.length,
				commits: rawData.commits?.length ?? 0,
				pull_requests: rawData.pull_requests?.length ?? 0,
			});
			console.log("[GitHubProvider.fetch] Raw data keys:", Object.keys(rawData));
			console.log(
				"[GitHubProvider.fetch] First 3 commits:",
				(rawData.commits ?? []).slice(0, 3).map(c => ({ sha: c.sha.slice(0, 7), repo: c.repo }))
			);

			return ok(rawData);
		} catch (error: unknown) {
			console.log("[GitHubProvider.fetch] Error occurred:", error);
			return err(this.mapError(error));
		}
	}

	private createFallbackPR(
		event: { repo: { name: string }; created_at?: string | null },
		payload: {
			action?: string;
			number?: number;
			pull_request?: {
				id?: number;
				number?: number;
				merged_at?: string | null;
				head?: { ref?: string };
				base?: { ref?: string };
			};
		},
		prNumber: number
	): GitHubPullRequest {
		const pr = payload.pull_request;
		return {
			id: pr?.id ?? 0,
			number: prNumber,
			title: `PR #${prNumber}`,
			state: pr?.merged_at ? "merged" : "closed",
			action: payload.action ?? "unknown",
			url: `https://github.com/${event.repo.name}/pull/${prNumber}`,
			repo: event.repo.name,
			created_at: event.created_at ?? new Date().toISOString(),
			merged_at: pr?.merged_at ?? undefined,
			head_ref: pr?.head?.ref ?? "unknown",
			base_ref: pr?.base?.ref ?? "unknown",
			commit_shas: [], // No commits for fallback
			merge_commit_sha: undefined,
		};
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

const makeCommitId = (repo: string, sha: string): string => `github:commit:${repo}:${sha.slice(0, 7)}`;

const makePrId = (repo: string, number: number): string => `github:pr:${repo}:${number}`;

const makeCommitUrl = (repo: string, sha: string): string => `https://github.com/${repo}/commit/${sha}`;

const truncateMessage = (message: string): string => {
	const firstLine = message.split("\n")[0] ?? "";
	return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};

export const normalizeGitHub = (raw: GitHubRaw): TimelineItem[] => {
	console.log("[normalizeGitHub] Input data structure keys:", Object.keys(raw));

	const items: TimelineItem[] = [];

	// Process commits array (from Commits API)
	const commits = raw.commits;
	console.log("[normalizeGitHub] Processing commits array:", commits.length);

	for (const commit of commits) {
		const payload: CommitPayload = {
			type: "commit",
			repo: commit.repo,
			sha: commit.sha,
			message: commit.message,
			branch: commit.branch,
		};

		items.push({
			id: makeCommitId(commit.repo, commit.sha),
			platform: "github",
			type: "commit",
			timestamp: commit.date,
			title: truncateMessage(commit.message),
			url: commit.url,
			payload,
		});
	}

	// Process pull requests
	const pullRequests = raw.pull_requests;
	if (pullRequests.length > 0) {
		console.log("[normalizeGitHub] Processing pull requests:", pullRequests.length);

		// Deduplicate PRs (keep only the most recent event per PR)
		const prMap = new Map<string, GitHubPullRequest>();
		for (const pr of pullRequests) {
			const key = `${pr.repo}:${pr.number}`;
			const existing = prMap.get(key);
			if (!existing || new Date(pr.created_at) > new Date(existing.created_at)) {
				prMap.set(key, pr);
			}
		}

		for (const pr of prMap.values()) {
			const payload: PullRequestPayload & { commit_shas?: string[]; merge_commit_sha?: string } = {
				type: "pull_request",
				repo: pr.repo,
				number: pr.number,
				title: pr.title,
				state: pr.state,
				action: pr.action,
				head_ref: pr.head_ref,
				base_ref: pr.base_ref,
				commits: [],
				commit_shas: pr.commit_shas,
				merge_commit_sha: pr.merge_commit_sha,
			};

			items.push({
				id: makePrId(pr.repo, pr.number),
				platform: "github",
				type: "pull_request",
				timestamp: pr.merged_at ?? pr.created_at,
				title: pr.title,
				url: pr.url,
				payload,
			});
		}
		console.log("[normalizeGitHub] Pull requests processed:", prMap.size);
	}

	console.log("[normalizeGitHub] Total items:", items.length);
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
			commits: this.config.commits ?? [],
			pull_requests: this.config.pullRequests ?? [],
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

	setCommits(commits: GitHubExtendedCommit[]): void {
		this.config.commits = commits;
	}
}
