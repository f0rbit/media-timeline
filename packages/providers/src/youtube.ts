import { tryCatchAsync } from "@media-timeline/core";
import { YouTubeRawSchema, type YouTubeRaw } from "@media-timeline/schema";
import { z } from "zod";
import { toProviderError, type FetchResult, type Provider, type ProviderError, type Tagged } from "./types";

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
