import { Octokit } from "@octokit/rest";
import { z } from "zod";
import config from "../config";
import { GithubResponseData } from "../types";

var client: Octokit | null = null;
function getGithubClient() {
	if (client == null) {
		if (config.GITHUB == null) throw new Error("Github config not set");
		client = new Octokit({
			auth: config.GITHUB.AUTH_TOKEN,
		});
	}
	return client;
}

export async function fetchGithubCommits() {
	const octokit = getGithubClient();

	const repos = await octokit.paginate("GET /user/repos", {
		affiliation: "owner",
		per_page: 100,
	});

	// const existing_ids = await
	const fetched_commits: GithubResponseData[] = [];

	for (const repo of repos) {
		const commits = (await octokit.paginate("GET /repos/:owner/:repo/commits", {
			owner: repo.owner.login,
			repo: repo.name,
			author: config.GITHUB?.USERNAME,
			// since: new Date(ONE_MONTH_AGO).toISOString(),
		})) as any[];

		for (const ghCommit of commits) {
			const sha = ghCommit.sha;
			if (ghCommit.author == null || ghCommit.author.login !== config.GITHUB?.USERNAME) {
				continue;
			}

			const commit = {
				sha,
				date: new Date(ghCommit.commit.author.date).getTime(),
				permalink: ghCommit.html_url,
				project: repo.full_name,
				title: ghCommit.commit.message.split("\n")[0],
				description: ghCommit.commit.message.split("\n").slice(1).join("\n").trim(),
				private: repo.private,
			};
			fetched_commits.push(commit);
		}
	}

	return fetched_commits;
}

export function parseGithubData(data: any) {
	// parse github data using zod
	return z
		.object({
			sha: z.string(),
			date: z.number(),
			permalink: z.string(),
			project: z.string(),
			title: z.string(),
			description: z.string(),
			private: z.boolean(),
		})
		.parse(data);
}
