import { z } from "zod";
import { type TimelineItem, type VideoPayload, type YouTubeRaw, YouTubeRawSchema, type YouTubeVideo } from "../schema";
import { type FetchError, err, ok, pipe } from "../utils";
import { BaseMemoryProvider } from "./memory-base";
import type { FetchResult, Provider, ProviderError } from "./types";
import { mapHttpError } from "./types";

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

const mapYouTubeError = (e: FetchError): ProviderError => {
	if (e.type === "http") {
		if (e.status === 429 || e.status === 403) {
			return { kind: "rate_limited", retry_after: 3600 };
		}
		return mapHttpError(e.status, e.status_text);
	}
	return { kind: "network_error", cause: e.cause instanceof Error ? e.cause : new Error(String(e.cause)) };
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

		return pipe
			.fetch<unknown, ProviderError>(url, { headers: { Accept: "application/json" } }, mapYouTubeError)
			.flat_map(json => {
				const parsed = YouTubePlaylistResponseSchema.safeParse(json);
				if (!parsed.success) {
					return err({ kind: "api_error", status: 200, message: `Invalid YouTube API response: ${parsed.error.message}` } as ProviderError);
				}

				const transformed = transformPlaylistToRaw(parsed.data);
				const validated = YouTubeRawSchema.safeParse(transformed);
				return validated.success ? ok(validated.data) : err({ kind: "api_error", status: 200, message: `Failed to transform YouTube response: ${validated.error.message}` } as ProviderError);
			})
			.result();
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

export type YouTubeMemoryConfig = {
	items?: YouTubeVideo[];
	next_page_token?: string;
};

export class YouTubeMemoryProvider extends BaseMemoryProvider<YouTubeRaw> implements Provider<YouTubeRaw> {
	readonly platform = "youtube";
	private config: YouTubeMemoryConfig;

	constructor(config: YouTubeMemoryConfig = {}) {
		super({ rate_limit_retry_after: 3600 });
		this.config = config;
	}

	protected getData(): YouTubeRaw {
		return {
			items: this.config.items ?? [],
			nextPageToken: this.config.next_page_token,
			fetched_at: new Date().toISOString(),
		};
	}

	setItems(items: YouTubeVideo[]): void {
		this.config.items = items;
	}

	setNextPageToken(token: string | undefined): void {
		this.config.next_page_token = token;
	}
}
