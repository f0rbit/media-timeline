import type { DevpadRaw, DevpadTask } from "../devpad";
import type { FetchResult, Provider } from "../types";
import { type MemoryProviderControls, type MemoryProviderState, createMemoryProviderControls, createMemoryProviderState, simulateErrors } from "./base";

export type DevpadMemoryConfig = {
	tasks?: DevpadTask[];
};

export class DevpadMemoryProvider implements Provider<DevpadRaw>, MemoryProviderControls {
	readonly platform = "devpad";
	private config: DevpadMemoryConfig;
	private state: MemoryProviderState;
	private controls: MemoryProviderControls;

	constructor(config: DevpadMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
		this.controls = createMemoryProviderControls(this.state);
	}

	async fetch(_token: string): Promise<FetchResult<DevpadRaw>> {
		return simulateErrors(this.state, () => ({
			tasks: this.config.tasks ?? [],
			fetched_at: new Date().toISOString(),
		}));
	}

	getCallCount = () => this.controls.getCallCount();
	reset = () => this.controls.reset();
	setSimulateRateLimit = (value: boolean) => this.controls.setSimulateRateLimit(value);
	setSimulateAuthExpired = (value: boolean) => this.controls.setSimulateAuthExpired(value);

	setTasks(tasks: DevpadTask[]): void {
		this.config.tasks = tasks;
	}
}
