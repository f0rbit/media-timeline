import type { GitHubEvent, GitHubRaw } from "@media-timeline/schema";
import type { FetchResult, Provider } from "../types";
import { type MemoryProviderControls, type MemoryProviderState, createMemoryProviderControls, createMemoryProviderState, simulateErrors } from "./base";

export type GitHubMemoryConfig = {
	events?: GitHubEvent[];
};

export class GitHubMemoryProvider implements Provider<GitHubRaw>, MemoryProviderControls {
	readonly platform = "github";
	private config: GitHubMemoryConfig;
	private state: MemoryProviderState;
	private controls: MemoryProviderControls;

	constructor(config: GitHubMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
		this.controls = createMemoryProviderControls(this.state);
	}

	async fetch(_token: string): Promise<FetchResult<GitHubRaw>> {
		return simulateErrors(this.state, () => ({
			events: this.config.events ?? [],
			fetched_at: new Date().toISOString(),
		}));
	}

	getCallCount = () => this.controls.getCallCount();
	reset = () => this.controls.reset();
	setSimulateRateLimit = (value: boolean) => this.controls.setSimulateRateLimit(value);
	setSimulateAuthExpired = (value: boolean) => this.controls.setSimulateAuthExpired(value);

	setEvents(events: GitHubEvent[]): void {
		this.config.events = events;
	}
}
