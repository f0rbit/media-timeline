import { z } from "zod";

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
