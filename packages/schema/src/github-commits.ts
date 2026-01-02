import { z } from "zod";

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
