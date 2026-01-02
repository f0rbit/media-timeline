import type { GitHubMetaStore, GitHubRepoCommitsStore, GitHubRepoMeta, GitHubRepoPRsStore } from "@media/schema";
import type { GitHubFetchResult } from "./github";
import { BaseMemoryProvider } from "./memory-base";

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

export class GitHubMemoryProvider extends BaseMemoryProvider<GitHubFetchResult> {
	readonly platform = "github";
	private config: GitHubMemoryConfig;

	constructor(config: GitHubMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): GitHubFetchResult {
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
}
