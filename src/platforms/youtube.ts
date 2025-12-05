import { YouTubeRawSchema, type YouTubeRaw, type YouTubeVideo, type TimelineItem, type VideoPayload } from "../schema";
import { ok, err, type Result } from "../utils";
import type { Provider, ProviderError, FetchResult } from "./types";
import { toProviderError } from "./types";
import { z } from "zod";

// === PROVIDER (real API) ===

const YouTubePlaylistResponseSchema = z.object({
	items: z.array(
		z.object({
			kind: z.string(),
			etag: z.string(),
			id: z.string(),
			snippet: z.object({
				publishedAt: z.string(),
				channelId: z.string(),
				title: z.string(),
				description: z.string(),
				thumbnails: z.record(
					z.object({
						url: z.string(),
						width: z.number().optional(),
						height: z.number().optional(),
					})
				),
				channelTitle: z.string(),
				playlistId: z.string(),
				position: z.number(),
				resourceId: z.object({
					kind: z.string(),
					videoId: z.string(),
				}),
			}),
			contentDetails: z
				.object({
					videoId: z.string(),
					videoPublishedAt: z.string(),
				})
				.optional(),
		})
	),
	nextPageToken: z.string().optional(),
	pageInfo: z
		.object({
			totalResults: z.number(),
			resultsPerPage: z.number(),
		})
		.optional(),
});

type YouTubePlaylistResponse = z.infer<typeof YouTubePlaylistResponseSchema>;
type Tagged<T> = T & { _tag: string };

export type YouTubeProviderConfig = {
	playlist_id: string;
};

const transformPlaylistToRaw = (playlist: YouTubePlaylistResponse): YouTubeRaw => ({
	items: playlist.items.map(item => ({
		kind: item.kind,
		etag: item.etag,
		id: {
			kind: item.snippet.resourceId.kind,
			videoId: item.snippet.resourceId.videoId,
		},
		snippet: {
			publishedAt: item.snippet.publishedAt,
			channelId: item.snippet.channelId,
			title: item.snippet.title,
			description: item.snippet.description,
			thumbnails: {
				default: item.snippet.thumbnails.default,
				medium: item.snippet.thumbnails.medium,
				high: item.snippet.thumbnails.high,
			},
			channelTitle: item.snippet.channelTitle,
		},
	})),
	nextPageToken: playlist.nextPageToken,
	pageInfo: playlist.pageInfo,
	fetched_at: new Date().toISOString(),
});

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

	const json = await response.json();
	const parsed = YouTubePlaylistResponseSchema.safeParse(json);

	if (!parsed.success) {
		throw {
			_tag: "api_error",
			kind: "api_error",
			status: 200,
			message: `Invalid YouTube API response: ${parsed.error.message}`,
		} as Tagged<ProviderError>;
	}

	const transformed = transformPlaylistToRaw(parsed.data);
	const validated = YouTubeRawSchema.safeParse(transformed);

	if (!validated.success) {
		throw {
			_tag: "api_error",
			kind: "api_error",
			status: 200,
			message: `Failed to transform YouTube response: ${validated.error.message}`,
		} as Tagged<ProviderError>;
	}

	return validated.data;
};

const tryCatchAsync = async <T, E>(fn: () => Promise<T>, mapError: (e: unknown) => E): Promise<Result<T, E>> => {
	try {
		return ok(await fn());
	} catch (e) {
		return err(mapError(e));
	}
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

// === NORMALIZER ===

const makeVideoId = (videoId: string): string => `youtube:video:${videoId}`;

const makeVideoUrl = (videoId: string): string => `https://youtube.com/watch?v=${videoId}`;

const selectThumbnail = (thumbnails: { default?: { url: string }; medium?: { url: string }; high?: { url: string } }): string | undefined => thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url;

export const normalizeYouTube = (raw: YouTubeRaw): TimelineItem[] =>
	raw.items.map((video): TimelineItem => {
		const payload: VideoPayload = {
			type: "video",
			channel_id: video.snippet.channelId,
			channel_title: video.snippet.channelTitle,
			description: video.snippet.description,
			thumbnail_url: selectThumbnail(video.snippet.thumbnails),
		};
		return {
			id: makeVideoId(video.id.videoId),
			platform: "youtube",
			type: "video",
			timestamp: video.snippet.publishedAt,
			title: video.snippet.title,
			url: makeVideoUrl(video.id.videoId),
			payload,
		};
	});

// === MEMORY PROVIDER (for tests) ===

type MemoryProviderState = {
	call_count: number;
	simulate_rate_limit: boolean;
	simulate_auth_expired: boolean;
};

const createMemoryProviderState = (): MemoryProviderState => ({
	call_count: 0,
	simulate_rate_limit: false,
	simulate_auth_expired: false,
});

type SimulationConfig = {
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

export type YouTubeMemoryConfig = {
	items?: YouTubeVideo[];
	next_page_token?: string;
};

export class YouTubeMemoryProvider implements Provider<YouTubeRaw>, MemoryProviderControls {
	readonly platform = "youtube";
	private config: YouTubeMemoryConfig;
	private state: MemoryProviderState;

	constructor(config: YouTubeMemoryConfig = {}) {
		this.config = config;
		this.state = createMemoryProviderState();
	}

	async fetch(_token: string): Promise<FetchResult<YouTubeRaw>> {
		return simulateErrors(
			this.state,
			() => ({
				items: this.config.items ?? [],
				nextPageToken: this.config.next_page_token,
				fetched_at: new Date().toISOString(),
			}),
			{ rate_limit_retry_after: 3600 }
		);
	}

	getCallCount = () => this.state.call_count;

	reset = () => {
		this.state.call_count = 0;
	};

	setSimulateRateLimit = (value: boolean) => {
		this.state.simulate_rate_limit = value;
	};

	setSimulateAuthExpired = (value: boolean) => {
		this.state.simulate_auth_expired = value;
	};

	setItems(items: YouTubeVideo[]): void {
		this.config.items = items;
	}

	setNextPageToken(token: string | undefined): void {
		this.config.next_page_token = token;
	}
}
