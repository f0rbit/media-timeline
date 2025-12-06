import { DevpadTaskSchema, type DevpadRaw, type DevpadTask, type TaskPayload, type TimelineItem } from "../schema";
import { ok, err, tryCatchAsync } from "../utils";
import { toProviderError, type Provider, type ProviderError, type FetchResult } from "./types";
import { z } from "zod";

// === PROVIDER (real API) ===

const DevpadApiResponseSchema = z.array(DevpadTaskSchema);

const handleDevpadResponse = async (response: Response): Promise<DevpadRaw> => {
	if (response.status === 401) {
		throw { kind: "auth_expired", message: "Devpad API key expired or invalid" } satisfies ProviderError;
	}

	if (response.status === 429) {
		const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
		throw { kind: "rate_limited", retry_after: retryAfter } satisfies ProviderError;
	}

	if (!response.ok) {
		throw { kind: "api_error", status: response.status, message: await response.text() } satisfies ProviderError;
	}

	const json = await response.json();
	const parsed = DevpadApiResponseSchema.safeParse(json);

	if (!parsed.success) {
		throw {
			kind: "api_error",
			status: 200,
			message: `Invalid response format: ${parsed.error.message}`,
		} satisfies ProviderError;
	}

	return { tasks: parsed.data, fetched_at: new Date().toISOString() };
};

export class DevpadProvider implements Provider<DevpadRaw> {
	readonly platform = "devpad";

	fetch(token: string): Promise<FetchResult<DevpadRaw>> {
		const url = "https://devpad.tools/api/v0/tasks";

		return tryCatchAsync(
			async () =>
				handleDevpadResponse(
					await fetch(url, {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/json",
						},
					})
				),
			toProviderError
		);
	}
}

// === NORMALIZER ===

const makeTaskId = (id: string): string => `devpad:task:${id}`;

export const normalizeDevpad = (raw: DevpadRaw): TimelineItem[] =>
	raw.tasks.map((task): TimelineItem => {
		const payload: TaskPayload = {
			type: "task",
			status: task.status,
			priority: task.priority,
			project: task.project,
			tags: task.tags,
			due_date: task.due_date,
			completed_at: task.completed_at,
		};
		return {
			id: makeTaskId(task.id),
			platform: "devpad",
			type: "task",
			timestamp: task.updated_at,
			title: task.title,
			payload,
		};
	});

// === MEMORY PROVIDER (for tests) ===

export type MemoryProviderState = {
	call_count: number;
	simulate_rate_limit: boolean;
	simulate_auth_expired: boolean;
};

const createMemoryProviderState = (): MemoryProviderState => ({
	call_count: 0,
	simulate_rate_limit: false,
	simulate_auth_expired: false,
});

export type SimulationConfig = {
	rate_limit_retry_after?: number;
};

const simulateErrors = <T>(state: MemoryProviderState, getData: () => T, config: SimulationConfig = {}): FetchResult<T> => {
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

const createMemoryProviderControls = (state: MemoryProviderState): MemoryProviderControls => ({
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
