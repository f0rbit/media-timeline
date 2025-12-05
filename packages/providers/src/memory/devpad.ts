import type { DevpadRaw, DevpadTask } from "../devpad";
import type { FetchResult, Provider } from "../types";
import { err, ok } from "../types";

export type DevpadMemoryConfig = {
	tasks?: DevpadTask[];
	simulate_rate_limit?: boolean;
	simulate_auth_expired?: boolean;
};

export class DevpadMemoryProvider implements Provider<DevpadRaw> {
	readonly platform = "devpad";
	private config: DevpadMemoryConfig;
	private call_count = 0;

	constructor(config: DevpadMemoryConfig = {}) {
		this.config = config;
	}

	async fetch(_token: string): Promise<FetchResult<DevpadRaw>> {
		this.call_count++;

		if (this.config.simulate_rate_limit) {
			return err({ kind: "rate_limited", retry_after: 60 });
		}
		if (this.config.simulate_auth_expired) {
			return err({ kind: "auth_expired", message: "Simulated auth expiry" });
		}

		return ok({
			tasks: this.config.tasks ?? [],
			fetched_at: new Date().toISOString(),
		});
	}

	getCallCount(): number {
		return this.call_count;
	}

	reset(): void {
		this.call_count = 0;
	}

	setTasks(tasks: DevpadTask[]): void {
		this.config.tasks = tasks;
	}

	setSimulateRateLimit(value: boolean): void {
		this.config.simulate_rate_limit = value;
	}

	setSimulateAuthExpired(value: boolean): void {
		this.config.simulate_auth_expired = value;
	}
}
