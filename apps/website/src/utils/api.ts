const API_HOST = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const api = {
	host: API_HOST,

	media: (path: string) => `${API_HOST}/media/api${normalizePath(path)}`,

	auth: (path: string) => `${API_HOST}/media/api/auth${normalizePath(path)}`,

	timeline: (path = "") => `${API_HOST}/media/api/v1/timeline${path ? normalizePath(path) : ""}`,

	connections: (path = "") => `${API_HOST}/media/api/v1/connections${path ? normalizePath(path) : ""}`,

	profiles: (path = "") => `${API_HOST}/media/api/v1/profiles${path ? normalizePath(path) : ""}`,
};

export type ApiError = {
	message: string;
	status: number;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const fetchApi = async <T>(url: string, options?: RequestInit): Promise<ApiResult<T>> => {
	try {
		const response = await fetch(url, {
			...options,
			credentials: "include",
			headers: {
				"Content-Type": "application/json",
				...options?.headers,
			},
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
};
