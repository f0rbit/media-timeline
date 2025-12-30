import { z } from "zod";
import { type DevpadRaw, type DevpadTask, DevpadTaskSchema, type TaskPayload, type TimelineItem } from "../schema";
import { type FetchError, err, ok, pipe } from "../utils";
import { BaseMemoryProvider } from "./memory-base";
import { type FetchResult, type Provider, type ProviderError, mapHttpError } from "./types";

// === PROVIDER (real API) ===

const DevpadApiResponseSchema = z.array(DevpadTaskSchema);

const mapDevpadError = (e: FetchError): ProviderError => (e.type === "http" ? mapHttpError(e.status, e.status_text) : { kind: "network_error", cause: e.cause instanceof Error ? e.cause : new Error(String(e.cause)) });

export class DevpadProvider implements Provider<DevpadRaw> {
	readonly platform = "devpad";

	fetch(token: string): Promise<FetchResult<DevpadRaw>> {
		const url = "https://devpad.tools/api/v0/tasks";

		return pipe
			.fetch<unknown, ProviderError>(
				url,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
					},
				},
				mapDevpadError
			)
			.flat_map(json => {
				const parsed = DevpadApiResponseSchema.safeParse(json);
				return parsed.success ? ok({ tasks: parsed.data, fetched_at: new Date().toISOString() } as DevpadRaw) : err({ kind: "api_error", status: 200, message: `Invalid response format: ${parsed.error.message}` } as ProviderError);
			})
			.result();
	}
}

// === NORMALIZER ===

const makeTaskId = (id: string): string => `devpad:task:${id}`;

const makeTaskUrl = (id: string): string => `https://devpad.tools/tasks/${id}`;

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
			url: makeTaskUrl(task.id),
			payload,
		};
	});

// === MEMORY PROVIDER (for tests) ===

export type DevpadMemoryConfig = {
	tasks?: DevpadTask[];
};

export class DevpadMemoryProvider extends BaseMemoryProvider<DevpadRaw> implements Provider<DevpadRaw> {
	readonly platform = "devpad";
	private config: DevpadMemoryConfig;

	constructor(config: DevpadMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): DevpadRaw {
		return {
			tasks: this.config.tasks ?? [],
			fetched_at: new Date().toISOString(),
		};
	}

	setTasks(tasks: DevpadTask[]): void {
		this.config.tasks = tasks;
	}
}
