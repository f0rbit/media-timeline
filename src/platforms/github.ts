import { Octokit } from "octokit";
import type { GitHubMetaStore, GitHubRepoCommit, GitHubRepoCommitsStore, GitHubRepoMeta, GitHubRepoPR, GitHubRepoPRsStore } from "../schema";
import { type Result, err, ok } from "../utils";
import { type ProviderError, mapHttpError, toProviderError } from "./types";

export type GitHubProviderConfig = {
	maxRepos: number;
	maxCommitsPerRepo: number;
	maxPRsPerRepo: number;
	concurrency: number;
	prCommitConcurrency: number;
};

const DEFAULT_CONFIG: GitHubProviderConfig = {
	maxRepos: 500,
	maxCommitsPerRepo: 10000,
	maxPRsPerRepo: 10000,
	concurrency: 5,
	prCommitConcurrency: 3,
};

export type GitHubFetchResult = {
	meta: GitHubMetaStore;
	repos: Map<
		string,
		{
			commits: GitHubRepoCommitsStore;
			prs: GitHubRepoPRsStore;
		}
	>;
};

type OctokitResponse<T> = { data: T };

type RepoData = {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string };
	default_branch: string;
	private: boolean;
	fork: boolean;
	pushed_at: string | null;
	updated_at: string | null;
};

type BranchData = {
	name: string;
};

type CommitData = {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date?: string } | null;
		committer: { name: string; email: string; date?: string } | null;
	};
	html_url: string;
	stats?: { additions?: number; deletions?: number };
	files?: unknown[];
};

type PRData = {
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	html_url: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
	head: { ref: string };
	base: { ref: string };
	merge_commit_sha: string | null;
	user: { login: string; avatar_url?: string } | null;
	additions?: number;
	deletions?: number;
	changed_files?: number;
};

type PRCommitData = {
	sha: string;
};

const parallel_map = async <T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> => {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += concurrency) {
		const batch = items.slice(i, i + concurrency);
		const batchResults = await Promise.all(batch.map(fn));
		results.push(...batchResults);
	}
	return results;
};

const mapOctokitError = (error: unknown): ProviderError => {
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status: number }).status;
		const response = (error as { response?: { headers?: Record<string, string | number> } }).response;
		const message = (error as { message?: string }).message ?? "Unknown API error";

		return mapHttpError(status, message, response?.headers);
	}

	return toProviderError(error);
};

const fetchAllPages = async <T>(fetcher: (page: number) => Promise<OctokitResponse<T[]>>, maxItems: number): Promise<T[]> => {
	const results: T[] = [];
	let page = 1;
	const perPage = 100;

	while (results.length < maxItems) {
		const { data } = await fetcher(page);
		if (data.length === 0) break;
		results.push(...data);
		if (data.length < perPage) break;
		page++;
	}

	return results.slice(0, maxItems);
};

export class GitHubProvider {
	readonly platform = "github";
	private config: GitHubProviderConfig;

	constructor(config: Partial<GitHubProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	async fetch(token: string): Promise<Result<GitHubFetchResult, ProviderError>> {
		try {
			console.log("[github] Starting fetch with config:", {
				maxRepos: this.config.maxRepos,
				maxCommitsPerRepo: this.config.maxCommitsPerRepo,
				maxPRsPerRepo: this.config.maxPRsPerRepo,
				concurrency: this.config.concurrency,
			});

			const octokit = new Octokit({
				auth: token,
				userAgent: "media-timeline/2.0.0",
			});

			console.log("[github] Fetching authenticated user...");
			const userResult = await this.fetchUser(octokit);
			if (!userResult.ok) return userResult;
			const username = userResult.value;
			console.log("[github] Authenticated as:", username);

			console.log("[github] Fetching repositories...");
			const reposResult = await this.fetchRepos(octokit);
			if (!reposResult.ok) return reposResult;
			const repos = reposResult.value;
			console.log("[github] Found", repos.length, "repos (after filtering forks)");

			console.log("[github] Building metadata and fetching branches...");
			const meta = await this.buildMeta(octokit, username, repos);
			console.log("[github] Metadata built for", meta.repositories.length, "repos");

			console.log("[github] Fetching commits and PRs for all repos...");
			const repoDataMap = await this.fetchAllRepoData(octokit, meta.repositories, username);
			console.log("[github] Fetch complete - processed", repoDataMap.size, "repos");

			const totalCommits = Array.from(repoDataMap.values()).reduce((sum, r) => sum + r.commits.total_commits, 0);
			const totalPRs = Array.from(repoDataMap.values()).reduce((sum, r) => sum + r.prs.total_prs, 0);
			console.log("[github] Summary: repos=", repoDataMap.size, "commits=", totalCommits, "prs=", totalPRs);

			return ok({ meta, repos: repoDataMap });
		} catch (error: unknown) {
			console.error("[github] Fetch failed with error:", error);
			return err(mapOctokitError(error));
		}
	}

	private async fetchUser(octokit: Octokit): Promise<Result<string, ProviderError>> {
		try {
			const { data: user } = await octokit.rest.users.getAuthenticated();
			return ok(user.login);
		} catch (error) {
			return err(mapOctokitError(error));
		}
	}

	private async fetchRepos(octokit: Octokit): Promise<Result<RepoData[], ProviderError>> {
		try {
			const repos = await fetchAllPages<RepoData>(
				page =>
					octokit.rest.repos.listForAuthenticatedUser({
						sort: "pushed",
						direction: "desc",
						per_page: 100,
						page,
					}) as Promise<OctokitResponse<RepoData[]>>,
				this.config.maxRepos
			);
			console.log("[github] Raw repos fetched:", repos.length);

			const filteredRepos = repos.filter(repo => !repo.fork);
			console.log("[github] Repos after filtering forks:", filteredRepos.length, "(removed", repos.length - filteredRepos.length, "forks)");
			return ok(filteredRepos);
		} catch (error) {
			console.error("[github] Failed to fetch repos:", error);
			return err(mapOctokitError(error));
		}
	}

	private async buildMeta(octokit: Octokit, username: string, repos: RepoData[]): Promise<GitHubMetaStore> {
		const repoMetas = await parallel_map(
			repos,
			async (repo): Promise<GitHubRepoMeta> => {
				const branches = await this.fetchBranches(octokit, repo.owner.login, repo.name);
				return {
					owner: repo.owner.login,
					name: repo.name,
					full_name: repo.full_name,
					default_branch: repo.default_branch,
					branches,
					is_private: repo.private,
					pushed_at: repo.pushed_at,
					updated_at: repo.updated_at ?? new Date().toISOString(),
				};
			},
			this.config.concurrency
		);

		return {
			username,
			repositories: repoMetas,
			total_repos_available: repos.length,
			repos_fetched: repoMetas.length,
			fetched_at: new Date().toISOString(),
		};
	}

	private async fetchBranches(octokit: Octokit, owner: string, repo: string): Promise<string[]> {
		try {
			const { data: branches } = (await octokit.rest.repos.listBranches({
				owner,
				repo,
				per_page: 100,
			})) as OctokitResponse<BranchData[]>;
			return branches.map(b => b.name);
		} catch {
			return [];
		}
	}

	private async fetchAllRepoData(octokit: Octokit, repoMetas: GitHubRepoMeta[], username: string): Promise<Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>> {
		let processed = 0;
		const total = repoMetas.length;

		const results = await parallel_map(
			repoMetas,
			async (repoMeta): Promise<[string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }]> => {
				const [commits, prs] = await Promise.all([this.fetchRepoCommits(octokit, repoMeta, username), this.fetchRepoPRs(octokit, repoMeta, username)]);
				processed++;
				if (processed % 5 === 0 || processed === total) {
					console.log(`[github] Progress: ${processed}/${total} repos (${repoMeta.full_name}: ${commits.total_commits} commits, ${prs.total_prs} PRs)`);
				}
				return [repoMeta.full_name, { commits, prs }];
			},
			this.config.concurrency
		);

		return new Map(results);
	}

	private async fetchRepoCommits(octokit: Octokit, repoMeta: GitHubRepoMeta, username: string): Promise<GitHubRepoCommitsStore> {
		const { owner, name, branches } = repoMeta;
		const commitMap = new Map<string, GitHubRepoCommit>();

		for (const branch of branches) {
			try {
				const branchCommits = await fetchAllPages<CommitData>(
					page =>
						octokit.rest.repos.listCommits({
							owner,
							repo: name,
							sha: branch,
							author: username,
							per_page: 100,
							page,
						}) as Promise<OctokitResponse<CommitData[]>>,
					this.config.maxCommitsPerRepo
				);

				for (const commit of branchCommits) {
					if (commitMap.has(commit.sha)) continue;

					const authorDate = commit.commit.author?.date ?? commit.commit.committer?.date ?? new Date().toISOString();
					const committerDate = commit.commit.committer?.date ?? commit.commit.author?.date ?? new Date().toISOString();

					commitMap.set(commit.sha, {
						sha: commit.sha,
						message: commit.commit.message,
						author_name: commit.commit.author?.name ?? "Unknown",
						author_email: commit.commit.author?.email ?? "",
						author_date: authorDate,
						committer_name: commit.commit.committer?.name ?? "Unknown",
						committer_email: commit.commit.committer?.email ?? "",
						committer_date: committerDate,
						url: commit.html_url,
						branch,
						additions: commit.stats?.additions,
						deletions: commit.stats?.deletions,
						files_changed: commit.files?.length,
					});
				}
			} catch {}
		}

		return {
			owner,
			repo: name,
			branches,
			commits: Array.from(commitMap.values()),
			total_commits: commitMap.size,
			fetched_at: new Date().toISOString(),
		};
	}

	private async fetchRepoPRs(octokit: Octokit, repoMeta: GitHubRepoMeta, username: string): Promise<GitHubRepoPRsStore> {
		const { owner, name } = repoMeta;

		try {
			const allPRs = await fetchAllPages<PRData>(
				page =>
					octokit.rest.pulls.list({
						owner,
						repo: name,
						state: "all",
						sort: "updated",
						direction: "desc",
						per_page: 100,
						page,
					}) as Promise<OctokitResponse<PRData[]>>,
				this.config.maxPRsPerRepo
			);

			const userPRs = allPRs.filter(pr => pr.user?.login.toLowerCase() === username.toLowerCase());
			const filteredCount = allPRs.length - userPRs.length;
			if (filteredCount > 0) {
				console.log(`[github] ${repoMeta.full_name}: filtered out ${filteredCount} PRs not authored by ${username}`);
			}

			const prsWithCommits = await parallel_map(
				userPRs,
				async (pr): Promise<GitHubRepoPR> => {
					const commitShas = await this.fetchPRCommits(octokit, owner, name, pr.number);
					const state = pr.merged_at ? "merged" : pr.state;

					return {
						id: pr.id,
						number: pr.number,
						title: pr.title,
						body: pr.body,
						state,
						url: pr.html_url,
						created_at: pr.created_at,
						updated_at: pr.updated_at,
						closed_at: pr.closed_at,
						merged_at: pr.merged_at,
						head_ref: pr.head.ref,
						base_ref: pr.base.ref,
						commit_shas: commitShas,
						merge_commit_sha: pr.merge_commit_sha,
						author_login: pr.user?.login ?? "unknown",
						author_avatar_url: pr.user?.avatar_url,
						additions: pr.additions,
						deletions: pr.deletions,
						changed_files: pr.changed_files,
					};
				},
				this.config.prCommitConcurrency
			);

			return {
				owner,
				repo: name,
				pull_requests: prsWithCommits,
				total_prs: prsWithCommits.length,
				fetched_at: new Date().toISOString(),
			};
		} catch {
			return {
				owner,
				repo: name,
				pull_requests: [],
				total_prs: 0,
				fetched_at: new Date().toISOString(),
			};
		}
	}

	private async fetchPRCommits(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<string[]> {
		try {
			const { data: commits } = (await octokit.rest.pulls.listCommits({
				owner,
				repo,
				pull_number: prNumber,
				per_page: 250,
			})) as OctokitResponse<PRCommitData[]>;
			return commits.map(c => c.sha);
		} catch {
			return [];
		}
	}
}
