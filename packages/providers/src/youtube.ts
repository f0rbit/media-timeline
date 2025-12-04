import type { FetchResult, Provider } from "./types";
import { err, ok } from "./types";

export type YouTubePlaylistItem = {
	kind: string;
	etag: string;
	id: string;
	snippet: {
		publishedAt: string;
		channelId: string;
		title: string;
		description: string;
		thumbnails: Record<string, { url: string; width: number; height: number }>;
		channelTitle: string;
		playlistId: string;
		position: number;
		resourceId: { kind: string; videoId: string };
	};
	contentDetails?: {
		videoId: string;
		videoPublishedAt: string;
	};
};

export type YouTubeRaw = {
	items: YouTubePlaylistItem[];
	nextPageToken?: string;
	fetched_at: string;
};

export type YouTubeProviderConfig = {
	playlist_id: string;
};

export class YouTubeProvider implements Provider<YouTubeRaw> {
	readonly platform = "youtube";
	private config: YouTubeProviderConfig;

	constructor(config: YouTubeProviderConfig) {
		this.config = config;
	}

	async fetch(token: string): Promise<FetchResult<YouTubeRaw>> {
		const params = new URLSearchParams({
			part: "snippet,contentDetails",
			playlistId: this.config.playlist_id,
			maxResults: "50",
			key: token,
		});
		const url = `https://www.googleapis.com/youtube/v3/playlistItems?${params}`;

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Accept: "application/json",
				},
			});
		} catch (cause) {
			return err({ kind: "network_error", cause: cause as Error });
		}

		if (response.status === 401 || response.status === 403) {
			const body = await response.text();
			if (body.includes("quotaExceeded") || body.includes("rateLimitExceeded")) {
				return err({ kind: "rate_limited", retry_after: 3600 });
			}
			return err({ kind: "auth_expired", message: "YouTube API key invalid or expired" });
		}

		if (response.status === 429) {
			return err({ kind: "rate_limited", retry_after: 3600 });
		}

		if (!response.ok) {
			return err({ kind: "api_error", status: response.status, message: await response.text() });
		}

		let data: { items: YouTubePlaylistItem[]; nextPageToken?: string };
		try {
			data = (await response.json()) as { items: YouTubePlaylistItem[]; nextPageToken?: string };
		} catch {
			return err({ kind: "api_error", status: response.status, message: "Invalid JSON response" });
		}

		return ok({
			items: data.items ?? [],
			nextPageToken: data.nextPageToken,
			fetched_at: new Date().toISOString(),
		});
	}
}
