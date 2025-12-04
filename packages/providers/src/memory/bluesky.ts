import type { BlueskyFeedItem, BlueskyRaw } from "../bluesky";
import type { FetchResult, Provider } from "../types";
import { err, ok } from "../types";

export type BlueskyMemoryConfig = {
	feed?: BlueskyFeedItem[];
	cursor?: string;
	simulate_rate_limit?: boolean;
	simulate_auth_expired?: boolean;
};

export class BlueskyMemoryProvider implements Provider<BlueskyRaw> {
	readonly platform = "bluesky";
	private config: BlueskyMemoryConfig;
	private call_count = 0;

	constructor(config: BlueskyMemoryConfig = {}) {
		this.config = config;
	}

	async fetch(_token: string): Promise<FetchResult<BlueskyRaw>> {
		this.call_count++;

		if (this.config.simulate_rate_limit) {
			return err({ kind: "rate_limited", retry_after: 60 });
		}
		if (this.config.simulate_auth_expired) {
			return err({ kind: "auth_expired", message: "Simulated auth expiry" });
		}

		return ok({
			feed: this.config.feed ?? [],
			cursor: this.config.cursor,
			fetched_at: new Date().toISOString(),
		});
	}

	getCallCount(): number {
		return this.call_count;
	}

	reset(): void {
		this.call_count = 0;
	}

	setFeed(feed: BlueskyFeedItem[]): void {
		this.config.feed = feed;
	}

	setCursor(cursor: string | undefined): void {
		this.config.cursor = cursor;
	}

	setSimulateRateLimit(value: boolean): void {
		this.config.simulate_rate_limit = value;
	}

	setSimulateAuthExpired(value: boolean): void {
		this.config.simulate_auth_expired = value;
	}
}
