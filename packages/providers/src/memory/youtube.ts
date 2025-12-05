import type { FetchResult, Provider } from "../types";
import { err, ok } from "../types";
import type { YouTubePlaylistItem, YouTubeRaw } from "../youtube";

export type YouTubeMemoryConfig = {
	items?: YouTubePlaylistItem[];
	next_page_token?: string;
	simulate_rate_limit?: boolean;
	simulate_auth_expired?: boolean;
};

export class YouTubeMemoryProvider implements Provider<YouTubeRaw> {
	readonly platform = "youtube";
	private config: YouTubeMemoryConfig;
	private call_count = 0;

	constructor(config: YouTubeMemoryConfig = {}) {
		this.config = config;
	}

	async fetch(_token: string): Promise<FetchResult<YouTubeRaw>> {
		this.call_count++;

		if (this.config.simulate_rate_limit) {
			return err({ kind: "rate_limited", retry_after: 3600 });
		}
		if (this.config.simulate_auth_expired) {
			return err({ kind: "auth_expired", message: "Simulated auth expiry" });
		}

		return ok({
			items: this.config.items ?? [],
			nextPageToken: this.config.next_page_token,
			fetched_at: new Date().toISOString(),
		});
	}

	getCallCount(): number {
		return this.call_count;
	}

	reset(): void {
		this.call_count = 0;
	}

	setItems(items: YouTubePlaylistItem[]): void {
		this.config.items = items;
	}

	setNextPageToken(token: string | undefined): void {
		this.config.next_page_token = token;
	}

	setSimulateRateLimit(value: boolean): void {
		this.config.simulate_rate_limit = value;
	}

	setSimulateAuthExpired(value: boolean): void {
		this.config.simulate_auth_expired = value;
	}
}
