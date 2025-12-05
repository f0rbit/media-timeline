import { tryCatchAsync } from "@media-timeline/core";
import { toProviderError, type FetchResult, type Provider, type ProviderError, type Tagged } from "./types";

export type GitHubEvent = {
	id: string;
	type: string;
	actor: { id: number; login: string; avatar_url: string };
	repo: { id: number; name: string; url: string };
	payload: Record<string, unknown>;
	public: boolean;
	created_at: string;
};

export type GitHubRaw = {
	events: GitHubEvent[];
	fetched_at: string;
};

export type GitHubProviderConfig = {
	username: string;
};

const parseRateLimitReset = (headers: Headers): number => {
	const resetTimestamp = headers.get("X-RateLimit-Reset");
	return resetTimestamp ? Math.max(0, parseInt(resetTimestamp, 10) - Math.floor(Date.now() / 1000)) : 60;
};

const handleGitHubResponse = async (response: Response): Promise<GitHubRaw> => {
	if (response.status === 401 || response.status === 403) {
		if (response.headers.get("X-RateLimit-Remaining") === "0") {
			throw { _tag: "rate_limited", kind: "rate_limited", retry_after: parseRateLimitReset(response.headers) } as Tagged<ProviderError>;
		}
		throw { _tag: "auth_expired", kind: "auth_expired", message: "GitHub token expired or invalid" } as Tagged<ProviderError>;
	}

	if (response.status === 429) {
		throw { _tag: "rate_limited", kind: "rate_limited", retry_after: parseRateLimitReset(response.headers) } as Tagged<ProviderError>;
	}

	if (!response.ok) {
		throw { _tag: "api_error", kind: "api_error", status: response.status, message: await response.text() } as Tagged<ProviderError>;
	}

	const events = (await response.json()) as GitHubEvent[];
	return { events, fetched_at: new Date().toISOString() };
};

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
