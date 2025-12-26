type ApiClientConfig = {
	baseUrl: string;
	apiKey: string | null;
};

let config: ApiClientConfig = {
	baseUrl: import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787",
	apiKey: null,
};

export function configureApi(newConfig: Partial<ApiClientConfig>) {
	config = { ...config, ...newConfig };
}

export function setApiKey(key: string) {
	config.apiKey = key;
}

export function getApiKey(): string | null {
	return config.apiKey;
}

const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = "mt_dev_" + btoa(MOCK_USER_ID).slice(0, 24);

export function getMockApiKey(): string {
	return MOCK_API_KEY;
}

export function getMockUserId(): string {
	return MOCK_USER_ID;
}

export function initMockAuth() {
	if (import.meta.env.DEV) {
		setApiKey(MOCK_API_KEY);
	}
}

type RequestOptions = {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
};

export type ApiError = {
	message: string;
	status: number;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
	const { method = "GET", body, headers = {} } = options;

	const requestHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...headers,
	};

	if (config.apiKey) {
		requestHeaders["Authorization"] = `Bearer ${config.apiKey}`;
	}

	const url = `${config.baseUrl}/api/v1${path}`;

	try {
		const response = await fetch(url, {
			method,
			headers: requestHeaders,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
			return {
				ok: false,
				error: {
					message: errorBody.message ?? errorBody.error ?? `HTTP ${response.status}`,
					status: response.status,
				},
			};
		}

		const data = await response.json();
		return { ok: true, data };
	} catch (e) {
		return {
			ok: false,
			error: {
				message: e instanceof Error ? e.message : "Network error",
				status: 0,
			},
		};
	}
}

export const api = {
	get: <T>(path: string) => request<T>(path, { method: "GET" }),
	post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
	put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
	delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type Connection = {
	account_id: string;
	platform: string;
	platform_username: string | null;
	is_active: boolean;
	last_fetched_at: string | null;
	created_at: string;
};

export type ConnectionsResponse = {
	accounts: Connection[];
};

export type TimelineItem = {
	id: string;
	platform: string;
	type: string;
	timestamp: string;
	title: string;
	url?: string;
	payload: Record<string, unknown>;
};

export type CommitGroup = {
	type: "commit_group";
	repo: string;
	date: string;
	commits: TimelineItem[];
	total_additions?: number;
	total_deletions?: number;
	total_files_changed?: number;
};

export type TimelineEntry = TimelineItem | CommitGroup;

export type TimelineGroup = {
	date: string;
	items: TimelineEntry[];
};

export type TimelineResponse = {
	data: {
		groups: TimelineGroup[];
	};
	meta: {
		version: string;
		generated_at: string;
	};
};

export const connections = {
	list: () => api.get<ConnectionsResponse>("/connections"),
	create: (data: { platform: string; access_token: string; platform_username?: string }) => api.post<{ account_id: string }>("/connections", data),
	delete: (accountId: string) => api.delete<{ success: boolean }>(`/connections/${accountId}`),
	refresh: (accountId: string) => api.post<{ status: string }>(`/connections/${accountId}/refresh`),
	refreshAll: () => api.post<{ status: string; succeeded: number; failed: number }>("/connections/refresh-all"),
};

export const timeline = {
	get: (userId: string) => api.get<TimelineResponse>(`/timeline/${userId}`),
	getRaw: (userId: string, platform: string, accountId: string) => api.get<unknown>(`/timeline/${userId}/raw/${platform}?account_id=${accountId}`),
};
