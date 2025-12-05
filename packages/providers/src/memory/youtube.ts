import type { FetchResult, Provider } from "../types";
import type { YouTubePlaylistItem, YouTubeRaw } from "../youtube";
import { type MemoryProviderControls, type MemoryProviderState, createMemoryProviderControls, createMemoryProviderState, simulateErrors } from "./base";

export type YouTubeMemoryConfig = {
	items?: YouTubePlaylistItem[];
	next_page_token?: string;
};

export class YouTubeMemoryProvider implements Provider<YouTubeRaw>, MemoryProviderControls {
	readonly platform = "youtube";
	private config: YouTubeMemoryConfig;
	private state: MemoryProviderState;
	private controls: MemoryProviderControls;

	constructor(config: YouTubeMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
		this.controls = createMemoryProviderControls(this.state);
	}

	async fetch(_token: string): Promise<FetchResult<YouTubeRaw>> {
		return simulateErrors(
			this.state,
			() => ({
				items: this.config.items ?? [],
				nextPageToken: this.config.next_page_token,
				fetched_at: new Date().toISOString(),
			}),
			{ rate_limit_retry_after: 3600 }
		);
	}

	getCallCount = () => this.controls.getCallCount();
	reset = () => this.controls.reset();
	setSimulateRateLimit = (value: boolean) => this.controls.setSimulateRateLimit(value);
	setSimulateAuthExpired = (value: boolean) => this.controls.setSimulateAuthExpired(value);

	setItems(items: YouTubePlaylistItem[]): void {
		this.config.items = items;
	}

	setNextPageToken(token: string | undefined): void {
		this.config.next_page_token = token;
	}
}
