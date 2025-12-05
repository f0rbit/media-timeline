import type { GitHubEvent, GitHubRaw } from "../github";
import type { FetchResult, Provider } from "../types";
import { err, ok } from "../types";

export type GitHubMemoryConfig = {
	events?: GitHubEvent[];
	simulate_rate_limit?: boolean;
	simulate_auth_expired?: boolean;
};

export class GitHubMemoryProvider implements Provider<GitHubRaw> {
	readonly platform = "github";
	private config: GitHubMemoryConfig;
	private call_count = 0;

	constructor(config: GitHubMemoryConfig = {}) {
		this.config = config;
	}

	async fetch(_token: string): Promise<FetchResult<GitHubRaw>> {
		this.call_count++;

		if (this.config.simulate_rate_limit) {
			return err({ kind: "rate_limited", retry_after: 60 });
		}
		if (this.config.simulate_auth_expired) {
			return err({ kind: "auth_expired", message: "Simulated auth expiry" });
		}

		return ok({
			events: this.config.events ?? [],
			fetched_at: new Date().toISOString(),
		});
	}

	getCallCount(): number {
		return this.call_count;
	}

	reset(): void {
		this.call_count = 0;
	}

	setEvents(events: GitHubEvent[]): void {
		this.config.events = events;
	}

	setSimulateRateLimit(value: boolean): void {
		this.config.simulate_rate_limit = value;
	}

	setSimulateAuthExpired(value: boolean): void {
		this.config.simulate_auth_expired = value;
	}
}
