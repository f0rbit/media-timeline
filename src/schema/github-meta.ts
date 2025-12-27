import { z } from "zod";

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
