import type { FetchResult, Provider } from "./types";
import { err, ok } from "./types";

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

export class GitHubProvider implements Provider<GitHubRaw> {
	readonly platform = "github";
	private config: GitHubProviderConfig;

	constructor(config: GitHubProviderConfig) {
		this.config = config;
	}

	async fetch(token: string): Promise<FetchResult<GitHubRaw>> {
		const url = `https://api.github.com/users/${this.config.username}/events`;

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			});
		} catch (cause) {
			return err({ kind: "network_error", cause: cause as Error });
		}

		if (response.status === 401 || response.status === 403) {
			const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
			if (rateLimitRemaining === "0") {
				const resetTimestamp = response.headers.get("X-RateLimit-Reset");
				const retryAfter = resetTimestamp ? Math.max(0, parseInt(resetTimestamp, 10) - Math.floor(Date.now() / 1000)) : 60;
				return err({ kind: "rate_limited", retry_after: retryAfter });
			}
			return err({ kind: "auth_expired", message: "GitHub token expired or invalid" });
		}

		if (response.status === 429) {
			const resetTimestamp = response.headers.get("X-RateLimit-Reset");
			const retryAfter = resetTimestamp ? Math.max(0, parseInt(resetTimestamp, 10) - Math.floor(Date.now() / 1000)) : 60;
			return err({ kind: "rate_limited", retry_after: retryAfter });
		}

		if (!response.ok) {
			return err({ kind: "api_error", status: response.status, message: await response.text() });
		}

		let events: GitHubEvent[];
		try {
			events = (await response.json()) as GitHubEvent[];
		} catch {
			return err({ kind: "api_error", status: response.status, message: "Invalid JSON response" });
		}

		return ok({
			events,
			fetched_at: new Date().toISOString(),
		});
	}
}
