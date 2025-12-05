import { tryCatchAsync } from "@media-timeline/core";
import type { FetchResult, Provider, ProviderError } from "./types";

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

type Tagged<T> = T & { _tag: string };

const handleYouTubeResponse = async (response: Response): Promise<YouTubeRaw> => {
	if (response.status === 401 || response.status === 403) {
		const body = await response.text();
		if (body.includes("quotaExceeded") || body.includes("rateLimitExceeded")) {
			throw { _tag: "rate_limited", kind: "rate_limited", retry_after: 3600 } as Tagged<ProviderError>;
		}
		throw { _tag: "auth_expired", kind: "auth_expired", message: "YouTube API key invalid or expired" } as Tagged<ProviderError>;
	}

	if (response.status === 429) {
		throw { _tag: "rate_limited", kind: "rate_limited", retry_after: 3600 } as Tagged<ProviderError>;
	}

	if (!response.ok) {
		throw { _tag: "api_error", kind: "api_error", status: response.status, message: await response.text() } as Tagged<ProviderError>;
	}

	const data = (await response.json()) as { items: YouTubePlaylistItem[]; nextPageToken?: string };
	return { items: data.items ?? [], nextPageToken: data.nextPageToken, fetched_at: new Date().toISOString() };
};

const toProviderError = (e: unknown): ProviderError => {
	if (typeof e === "object" && e !== null && "_tag" in e) {
		const { _tag, ...rest } = e as Tagged<ProviderError>;
		return rest as ProviderError;
	}
	return { kind: "network_error", cause: e instanceof Error ? e : new Error(String(e)) };
};

export class YouTubeProvider implements Provider<YouTubeRaw> {
	readonly platform = "youtube";
	private config: YouTubeProviderConfig;

	constructor(config: YouTubeProviderConfig) {
		this.config = config;
	}

	fetch(token: string): Promise<FetchResult<YouTubeRaw>> {
		const params = new URLSearchParams({
			part: "snippet,contentDetails",
			playlistId: this.config.playlist_id,
			maxResults: "50",
			key: token,
		});
		const url = `https://www.googleapis.com/youtube/v3/playlistItems?${params}`;

		return tryCatchAsync(
			async () =>
				handleYouTubeResponse(
					await fetch(url, {
						headers: {
							Accept: "application/json",
						},
					})
				),
			toProviderError
		);
	}
}
