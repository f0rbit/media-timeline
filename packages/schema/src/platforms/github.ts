import { z } from "zod";

// === Commits ===

export const GitHubRepoCommitSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author_name: z.string(),
	author_email: z.string(),
	author_date: z.string().datetime(),
	committer_name: z.string(),
	committer_email: z.string(),
	committer_date: z.string().datetime(),
	url: z.string().url(),
	branch: z.string(),
	additions: z.number().optional(),
	deletions: z.number().optional(),
	files_changed: z.number().optional(),
});

export const GitHubRepoCommitsStoreSchema = z.object({
	owner: z.string(),
	repo: z.string(),
	branches: z.array(z.string()),
	commits: z.array(GitHubRepoCommitSchema),
	total_commits: z.number(),
	fetched_at: z.string().datetime(),
});

export type GitHubRepoCommit = z.infer<typeof GitHubRepoCommitSchema>;
export type GitHubRepoCommitsStore = z.infer<typeof GitHubRepoCommitsStoreSchema>;

// === Meta ===

export const GitHubRepoMetaSchema = z.object({
	owner: z.string(),
	name: z.string(),
	full_name: z.string(),
	default_branch: z.string(),
	branches: z.array(z.string()),
	is_private: z.boolean(),
	pushed_at: z.string().datetime().nullable(),
	updated_at: z.string().datetime(),
});

export const GitHubMetaStoreSchema = z.object({
	username: z.string(),
	repositories: z.array(GitHubRepoMetaSchema),
	total_repos_available: z.number(),
	repos_fetched: z.number(),
	fetched_at: z.string().datetime(),
});

export type GitHubRepoMeta = z.infer<typeof GitHubRepoMetaSchema>;
export type GitHubMetaStore = z.infer<typeof GitHubMetaStoreSchema>;

// === Pull Requests ===

export const GitHubRepoPRSchema = z.object({
	id: z.number(),
	number: z.number(),
	title: z.string(),
	body: z.string().nullable(),
	state: z.enum(["open", "closed", "merged"]),
	url: z.string().url(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	closed_at: z.string().datetime().nullable(),
	merged_at: z.string().datetime().nullable(),
	head_ref: z.string(),
	base_ref: z.string(),
	commit_shas: z.array(z.string()),
	merge_commit_sha: z.string().nullable(),
	author_login: z.string(),
	author_avatar_url: z.string().url().optional(),
	additions: z.number().optional(),
	deletions: z.number().optional(),
	changed_files: z.number().optional(),
});

export const GitHubRepoPRsStoreSchema = z.object({
	owner: z.string(),
	repo: z.string(),
	pull_requests: z.array(GitHubRepoPRSchema),
	total_prs: z.number(),
	fetched_at: z.string().datetime(),
});

export type GitHubRepoPR = z.infer<typeof GitHubRepoPRSchema>;
export type GitHubRepoPRsStore = z.infer<typeof GitHubRepoPRsStoreSchema>;
