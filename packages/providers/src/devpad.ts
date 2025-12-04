import { tryCatchAsync } from "@media-timeline/core";
import type { FetchResult, Provider, ProviderError } from "./types";

export type DevpadTask = {
	id: string;
	title: string;
	progress: string;
	priority: number;
	project_id: string;
	updated_at: string;
};

export type DevpadRaw = {
	tasks: DevpadTask[];
	fetched_at: string;
};

type Tagged<T> = T & { _tag: string };

const handleDevpadResponse = async (response: Response): Promise<DevpadRaw> => {
	if (response.status === 401) {
		throw { _tag: "auth_expired", kind: "auth_expired", message: "Devpad API key expired or invalid" } as Tagged<ProviderError>;
	}

	if (response.status === 429) {
		const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
		throw { _tag: "rate_limited", kind: "rate_limited", retry_after: retryAfter } as Tagged<ProviderError>;
	}

	if (!response.ok) {
		throw { _tag: "api_error", kind: "api_error", status: response.status, message: await response.text() } as Tagged<ProviderError>;
	}

	const tasks = (await response.json()) as DevpadTask[];
	return { tasks, fetched_at: new Date().toISOString() };
};

const toProviderError = (e: unknown): ProviderError => {
	if (typeof e === "object" && e !== null && "_tag" in e) {
		const { _tag, ...rest } = e as Tagged<ProviderError>;
		return rest as ProviderError;
	}
	return { kind: "network_error", cause: e instanceof Error ? e : new Error(String(e)) };
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
