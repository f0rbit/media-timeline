import type { GitHubMetaStore, GitHubRepoCommitsStore, GitHubRepoMeta, GitHubRepoPRsStore } from "../schema";
import type { Result } from "../utils";
import type { GitHubFetchResult } from "./github";
import { createMemoryProviderState, type MemoryProviderControls, type MemoryProviderState, simulateErrors } from "./memory-base";
import type { ProviderError } from "./types";

export type { GitHubFetchResult };

export type GitHubMemoryConfig = {
	username?: string;
	repositories?: GitHubRepoMeta[];
	repoData?: Map<
		string,
		{
			commits: GitHubRepoCommitsStore;
			prs: GitHubRepoPRsStore;
		}
	>;
};

export class GitHubMemoryProvider implements MemoryProviderControls {
	readonly platform = "github";
	private config: GitHubMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: GitHubMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<Result<GitHubFetchResult, ProviderError>> {
		return simulateErrors(this.state, () => {
			const repos = this.config.repositories ?? [];
			const meta: GitHubMetaStore = {
				username: this.config.username ?? "test-user",
				repositories: repos,
				total_repos_available: repos.length,
				repos_fetched: repos.length,
				fetched_at: new Date().toISOString(),
			};

			return {
				meta,
				repos: this.config.repoData ?? new Map(),
			};
		});
	}

	setUsername(username: string): void {
		this.config.username = username;
	}

	setRepositories(repos: GitHubRepoMeta[]): void {
		this.config.repositories = repos;
	}

	setRepoData(fullName: string, data: { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }): void {
		if (!this.config.repoData) {
			this.config.repoData = new Map();
		}
		this.config.repoData.set(fullName, data);
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
}
