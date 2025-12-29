import type { CommentPayload, CommitGroup, CommitPayload, DateGroup, GitHubRepo, PRCommit, Platform, PlatformSettings, PostPayload, PullRequestPayload, TimelineItem, TimelineType } from "@schema/types";

export type { CommitGroup, CommitPayload, CommentPayload, DateGroup, GitHubRepo, Platform, PlatformSettings, PostPayload, PRCommit, PullRequestPayload, TimelineItem, TimelineType };

type ApiClientConfig = {
	baseUrl: string;
	apiKey: string | null;
};

let config: ApiClientConfig = {
	baseUrl: import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787",
	apiKey: null,
};

export function configureApi(newConfig: Partial<ApiClientConfig>): void {
	config = { ...config, ...newConfig };
}

export function setApiKey(key: string): void {
	config.apiKey = key;
}

export function getApiKey(): string | null {
	return config.apiKey;
}

const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = `mt_dev_${btoa(MOCK_USER_ID).slice(0, 24)}`;

export function getMockApiKey(): string {
	return MOCK_API_KEY;
}

export function getMockUserId(): string {
	return MOCK_USER_ID;
}

export function initMockAuth(): void {
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
		requestHeaders.Authorization = `Bearer ${config.apiKey}`;
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
	patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
	delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type Connection = {
	account_id: string;
	platform: Platform;
	platform_username: string | null;
	is_active: boolean;
	last_fetched_at: string | null;
	created_at: string;
};

export type ConnectionWithSettings = Connection & {
	settings?: PlatformSettings;
};

export type ConnectionsResponse = {
	accounts: Connection[];
};

export type ConnectionsWithSettingsResponse = {
	accounts: ConnectionWithSettings[];
};

export type TimelineEntry = TimelineItem | CommitGroup;

export type TimelineGroup = DateGroup;

export type TimelineResponse = {
	data: {
		groups: TimelineGroup[];
	};
	meta: {
		version: string;
		generated_at: string;
		github_usernames?: string[];
	};
};

export const connections = {
	list: () => api.get<ConnectionsResponse>("/connections"),
	listWithSettings: () => api.get<ConnectionsWithSettingsResponse>("/connections?include_settings=true"),
	create: (data: { platform: string; access_token: string; platform_username?: string }) => api.post<{ account_id: string }>("/connections", data),
	update: (accountId: string, data: { is_active?: boolean }) => api.patch<{ success: boolean; connection: Connection }>(`/connections/${accountId}`, data),
	delete: (accountId: string) => api.delete<{ success: boolean }>(`/connections/${accountId}`),
	refresh: (accountId: string) => api.post<{ status: string }>(`/connections/${accountId}/refresh`),
	refreshAll: () => api.post<{ status: string; succeeded: number; failed: number }>("/connections/refresh-all"),
	getSettings: (accountId: string) => api.get<{ settings: PlatformSettings }>(`/connections/${accountId}/settings`),
	updateSettings: (accountId: string, settings: PlatformSettings) => api.put<{ updated: boolean }>(`/connections/${accountId}/settings`, { settings }),
	getRepos: (accountId: string) => api.get<{ repos: GitHubRepo[] }>(`/connections/${accountId}/repos`),
	getSubreddits: (accountId: string) => api.get<{ subreddits: string[]; username: string }>(`/connections/${accountId}/subreddits`),
};

export const timeline = {
	get: (userId: string) => api.get<TimelineResponse>(`/timeline/${userId}`),
	getRaw: (userId: string, platform: string, accountId: string) => api.get<unknown>(`/timeline/${userId}/raw/${platform}?account_id=${accountId}`),
};
