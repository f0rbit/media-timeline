import type { FetchResult, Provider } from "./types";
import { err, ok } from "./types";

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

export class DevpadProvider implements Provider<DevpadRaw> {
	readonly platform = "devpad";

	async fetch(token: string): Promise<FetchResult<DevpadRaw>> {
		const url = "https://devpad.tools/api/v0/tasks";

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
			});
		} catch (cause) {
			return err({ kind: "network_error", cause: cause as Error });
		}

		if (response.status === 401) {
			return err({ kind: "auth_expired", message: "Devpad API key expired or invalid" });
		}

		if (response.status === 429) {
			const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
			return err({ kind: "rate_limited", retry_after: retryAfter });
		}

		if (!response.ok) {
			return err({ kind: "api_error", status: response.status, message: await response.text() });
		}

		let tasks: DevpadTask[];
		try {
			tasks = (await response.json()) as DevpadTask[];
		} catch {
			return err({ kind: "api_error", status: response.status, message: "Invalid JSON response" });
		}

		return ok({
			tasks,
			fetched_at: new Date().toISOString(),
		});
	}
}
