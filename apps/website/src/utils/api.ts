import { type Result, err, ok } from "@f0rbit/corpus/types";
import type { CommentPayload, CommitGroup, CommitPayload, DateGroup, GitHubRepo, PRCommit, PlatformSettings, PostPayload, PullRequestPayload, TimelineItem, TimelineType } from "@media/schema/types";
import { MOCK_API_KEY, MOCK_USER_ID, isDevMode } from "./mock-auth";

export type { CommentPayload, CommitGroup, CommitPayload, DateGroup, GitHubRepo, PRCommit, PlatformSettings, PostPayload, PullRequestPayload, TimelineItem, TimelineType };

/**
 * Runtime context passed from Astro SSR
 */
type SSRRuntime = {
	env?: {
		API_HANDLER?: {
			fetch: (request: Request) => Promise<Response>;
		};
	};
};

export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

// Use relative URLs in production/preview (same worker), localhost only in dev
const API_HOST = import.meta.env.PUBLIC_API_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const apiUrls = {
	host: API_HOST,
	media: (path: string) => `${API_HOST}/media/api${normalizePath(path)}`,
	auth: (path: string) => `${API_HOST}/media/api/auth${normalizePath(path)}`,
	timeline: (path = "") => `${API_HOST}/media/api/v1/timeline${path ? normalizePath(path) : ""}`,
	connections: (path = "") => `${API_HOST}/media/api/v1/connections${path ? normalizePath(path) : ""}`,
	profiles: (path = "") => `${API_HOST}/media/api/v1/profiles${path ? normalizePath(path) : ""}`,
	me: () => `${API_HOST}/media/api/v1/me`,
};

export type ApiError = {
	message: string;
	status: number;
};

export type ApiResult<T> = Result<T, ApiError>;

type ApiClientConfig = {
	apiKey: string | null;
};

let config: ApiClientConfig = {
	apiKey: null,
};

const getEffectiveApiKey = (): string | null => {
	if (config.apiKey) return config.apiKey;
	if (isDevMode()) return MOCK_API_KEY;
	return null;
};

export const configureApi = (newConfig: Partial<ApiClientConfig>): void => {
	config = { ...config, ...newConfig };
};

export const setApiKey = (key: string): void => {
	config.apiKey = key;
};

export const getApiKey = (): string | null => config.apiKey;

export const getMockApiKey = (): string => MOCK_API_KEY;

export const getMockUserId = (): string => MOCK_USER_ID;

export const initMockAuth = (): void => {
	if (isDevMode()) setApiKey(MOCK_API_KEY);
};

const buildHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
	const requestHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...headers,
	};
	const apiKey = getEffectiveApiKey();
	if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
	return requestHeaders;
};

export const fetchApi = async <T>(url: string, options?: RequestInit): Promise<ApiResult<T>> => {
	try {
		const response = await fetch(url, {
			...options,
			credentials: "include",
			headers: buildHeaders(options?.headers as Record<string, string>),
		});

		if (!response.ok) {
			const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
			return err({
				message: errorBody.message ?? errorBody.error ?? `HTTP ${response.status}`,
				status: response.status,
			});
		}

		const data = await response.json();
		return ok(data);
	} catch (e) {
		return err({
			message: e instanceof Error ? e.message : "Network error",
			status: 0,
		});
	}
};

type RequestOptions = {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
};

const request = async <T>(url: string, options: RequestOptions = {}): Promise<ApiResult<T>> => {
	const { method = "GET", body, headers = {} } = options;
	return fetchApi<T>(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
};

export const api = {
	get: <T>(path: string) => request<T>(apiUrls.media(`/v1${path}`), { method: "GET" }),
	post: <T>(path: string, body?: unknown) => request<T>(apiUrls.media(`/v1${path}`), { method: "POST", body }),
	put: <T>(path: string, body?: unknown) => request<T>(apiUrls.media(`/v1${path}`), { method: "PUT", body }),
	patch: <T>(path: string, body?: unknown) => request<T>(apiUrls.media(`/v1${path}`), { method: "PATCH", body }),
	delete: <T>(path: string) => request<T>(apiUrls.media(`/v1${path}`), { method: "DELETE" }),

	/**
	 * Make an SSR request to the API.
	 * If running in unified worker, uses direct internal call (no HTTP roundtrip).
	 * Otherwise falls back to HTTP fetch.
	 * Returns typed JSON result.
	 */
	ssr: async <T>(path: string, incomingRequest: Request, options: RequestInit = {}, runtime?: SSRRuntime): Promise<ApiResult<T>> => {
		try {
			const url = new URL(path, incomingRequest.url);
			const cookie = incomingRequest.headers.get("cookie") ?? "";
			const origin = new URL(incomingRequest.url).origin;

			const headers: Record<string, string> = {
				...(options.headers as Record<string, string>),
				Origin: origin,
			};
			if (cookie) {
				headers.Cookie = cookie;
			}

			const apiHandler = runtime?.env?.API_HANDLER;
			const response = apiHandler ? await apiHandler.fetch(new Request(url.toString(), { ...options, headers })) : await fetch(url.toString(), { ...options, headers });

			if (!response.ok) {
				const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
				return err({
					message: (errorBody as { message?: string }).message ?? `HTTP ${response.status}`,
					status: response.status,
				});
			}

			const data = (await response.json()) as T;
			return ok(data);
		} catch (e) {
			return err({
				message: e instanceof Error ? e.message : "Network error",
				status: 0,
			});
		}
	},
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
	list: (profileId: string) => request<ConnectionsResponse>(apiUrls.connections(`?profile_id=${profileId}`)),
	listWithSettings: (profileId: string) => request<ConnectionsWithSettingsResponse>(apiUrls.connections(`?profile_id=${profileId}&include_settings=true`)),
	create: (data: { platform: string; access_token: string; platform_username?: string; profile_id: string }) => request<{ account_id: string }>(apiUrls.connections(), { method: "POST", body: data }),
	update: (accountId: string, data: { is_active?: boolean }) => request<{ success: boolean; connection: Connection }>(apiUrls.connections(`/${accountId}`), { method: "PATCH", body: data }),
	delete: (accountId: string) => request<{ success: boolean }>(apiUrls.connections(`/${accountId}`), { method: "DELETE" }),
	refresh: (accountId: string) => request<{ status: string }>(apiUrls.connections(`/${accountId}/refresh`), { method: "POST" }),
	refreshAll: () => request<{ status: string; succeeded: number; failed: number }>(apiUrls.connections("/refresh-all"), { method: "POST" }),
	getSettings: (accountId: string) => request<{ settings: PlatformSettings }>(apiUrls.connections(`/${accountId}/settings`)),
	updateSettings: (accountId: string, settings: PlatformSettings) => request<{ updated: boolean }>(apiUrls.connections(`/${accountId}/settings`), { method: "PUT", body: { settings } }),
	getRepos: (accountId: string) => request<{ repos: GitHubRepo[] }>(apiUrls.connections(`/${accountId}/repos`)),
	getSubreddits: (accountId: string) => request<{ subreddits: string[]; username: string }>(apiUrls.connections(`/${accountId}/subreddits`)),
};

export const timeline = {
	get: (userId: string) => request<TimelineResponse>(apiUrls.timeline(`/${userId}`)),
	getRaw: (userId: string, platform: string, accountId: string) => request<unknown>(apiUrls.timeline(`/${userId}/raw/${platform}?account_id=${accountId}`)),
};

export type ProfileSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
};

export type ProfilesListResponse = {
	profiles: ProfileSummary[];
};

export type ProfileTimelineResponse = {
	meta: {
		profile_id: string;
		profile_slug: string;
		profile_name: string;
		generated_at: string;
	};
	data: {
		groups: TimelineGroup[];
	};
};

export type ProfileWithRelations = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	filters: Array<{
		id: string;
		account_id: string;
		filter_type: "include" | "exclude";
		filter_key: string;
		filter_value: string;
	}>;
};

export type ProfileDetailResponse = {
	profile: ProfileWithRelations;
};

export const profiles = {
	list: () => request<ProfilesListResponse>(apiUrls.profiles()),
	get: (id: string) => request<ProfileDetailResponse>(apiUrls.profiles(`/${id}`)),
	getTimeline: (slug: string, params?: { limit?: number; before?: string }) => {
		const query = new URLSearchParams();
		if (params?.limit) query.set("limit", String(params.limit));
		if (params?.before) query.set("before", params.before);
		const queryString = query.toString();
		return request<ProfileTimelineResponse>(apiUrls.profiles(`/${slug}/timeline${queryString ? `?${queryString}` : ""}`));
	},
};
