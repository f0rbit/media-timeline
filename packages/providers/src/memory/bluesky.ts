import type { BlueskyFeedItem, BlueskyRaw } from "../bluesky";
import type { FetchResult, Provider } from "../types";
import { type MemoryProviderControls, type MemoryProviderState, createMemoryProviderControls, createMemoryProviderState, simulateErrors } from "./base";

export type BlueskyMemoryConfig = {
	feed?: BlueskyFeedItem[];
	cursor?: string;
};

export class BlueskyMemoryProvider implements Provider<BlueskyRaw>, MemoryProviderControls {
	readonly platform = "bluesky";
	private config: BlueskyMemoryConfig;
	private state: MemoryProviderState;
	private controls: MemoryProviderControls;

	constructor(config: BlueskyMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
		this.controls = createMemoryProviderControls(this.state);
	}

	async fetch(_token: string): Promise<FetchResult<BlueskyRaw>> {
		return simulateErrors(this.state, () => ({
			feed: this.config.feed ?? [],
			cursor: this.config.cursor,
			fetched_at: new Date().toISOString(),
		}));
	}

	getCallCount = () => this.controls.getCallCount();
	reset = () => this.controls.reset();
	setSimulateRateLimit = (value: boolean) => this.controls.setSimulateRateLimit(value);
	setSimulateAuthExpired = (value: boolean) => this.controls.setSimulateAuthExpired(value);

	setFeed(feed: BlueskyFeedItem[]): void {
		this.config.feed = feed;
	}

	setCursor(cursor: string | undefined): void {
		this.config.cursor = cursor;
	}
}
