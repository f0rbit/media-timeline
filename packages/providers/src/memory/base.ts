import type { FetchResult } from "../types";
import { err, ok } from "../types";

export type MemoryProviderState = {
	call_count: number;
	simulate_rate_limit: boolean;
	simulate_auth_expired: boolean;
};

export const createMemoryProviderState = (): MemoryProviderState => ({
	call_count: 0,
	simulate_rate_limit: false,
	simulate_auth_expired: false,
});

export type SimulationConfig = {
	rate_limit_retry_after?: number;
};

export const simulateErrors = <T>(state: MemoryProviderState, getData: () => T, config: SimulationConfig = {}): FetchResult<T> => {
	state.call_count++;

	if (state.simulate_rate_limit) {
		return err({ kind: "rate_limited", retry_after: config.rate_limit_retry_after ?? 60 });
	}
	if (state.simulate_auth_expired) {
		return err({ kind: "auth_expired", message: "Simulated auth expiry" });
	}

	return ok(getData());
};

export interface MemoryProviderControls {
	getCallCount(): number;
	reset(): void;
	setSimulateRateLimit(value: boolean): void;
	setSimulateAuthExpired(value: boolean): void;
}

export const createMemoryProviderControls = (state: MemoryProviderState): MemoryProviderControls => ({
	getCallCount: () => state.call_count,
	reset: () => {
		state.call_count = 0;
	},
	setSimulateRateLimit: (value: boolean) => {
		state.simulate_rate_limit = value;
	},
	setSimulateAuthExpired: (value: boolean) => {
		state.simulate_auth_expired = value;
	},
});
