import type { BlueskyRaw, CommitPayload, DevpadRaw, GitHubPushEvent, GitHubRaw, PostPayload, TaskPayload, TimelineItem, VideoPayload, YouTubeRaw } from "@media-timeline/schema";

const isPushEvent = (event: { type: string }): event is GitHubPushEvent => event.type === "PushEvent";

const makeCommitId = (repo: string, sha: string): string => `github:commit:${repo}:${sha.slice(0, 7)}`;

const makeCommitUrl = (repo: string, sha: string): string => `https://github.com/${repo}/commit/${sha}`;

const truncateMessage = (message: string): string => {
	const firstLine = message.split("\n")[0] ?? "";
	return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};

export const normalizeGitHub = (raw: GitHubRaw): TimelineItem[] =>
	raw.events.filter(isPushEvent).flatMap(event =>
		event.payload.commits.map((commit): TimelineItem => {
			const payload: CommitPayload = {
				type: "commit",
				repo: event.repo.name,
				sha: commit.sha,
				message: commit.message,
			};
			return {
				id: makeCommitId(event.repo.name, commit.sha),
				platform: "github",
				type: "commit",
				timestamp: event.created_at,
				title: truncateMessage(commit.message),
				url: makeCommitUrl(event.repo.name, commit.sha),
				payload,
			};
		})
	);

const makePostId = (uri: string): string => {
	const parts = uri.split("/");
	const rkey = parts[parts.length - 1] ?? uri;
	return `bluesky:post:${rkey}`;
};

const makePostUrl = (author: string, uri: string): string => {
	const parts = uri.split("/");
	const rkey = parts[parts.length - 1] ?? "";
	return `https://bsky.app/profile/${author}/post/${rkey}`;
};

const extractPostTitle = (text: string): string => {
	const firstLine = text.split("\n")[0] ?? "";
	return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
};

export const normalizeBluesky = (raw: BlueskyRaw): TimelineItem[] =>
	raw.feed.map((item): TimelineItem => {
		const { post } = item;
		const hasMedia = (post.embed?.images?.length ?? 0) > 0;
		const isReply = post.record.reply !== undefined;
		const isRepost = item.reason?.$type === "app.bsky.feed.defs#reasonRepost";
		const payload: PostPayload = {
			type: "post",
			content: post.record.text,
			author_handle: post.author.handle,
			author_name: post.author.displayName,
			author_avatar: post.author.avatar,
			reply_count: post.replyCount,
			repost_count: post.repostCount,
			like_count: post.likeCount,
			has_media: hasMedia,
			is_reply: isReply,
			is_repost: isRepost,
		};
		return {
			id: makePostId(post.uri),
			platform: "bluesky",
			type: "post",
			timestamp: post.record.createdAt,
			title: extractPostTitle(post.record.text),
			url: makePostUrl(post.author.handle, post.uri),
			payload,
		};
	});

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

const makeTaskId = (id: string): string => `devpad:task:${id}`;

export const normalizeDevpad = (raw: DevpadRaw): TimelineItem[] =>
	raw.tasks.map((task): TimelineItem => {
		const payload: TaskPayload = {
			type: "task",
			status: task.status,
			priority: task.priority,
			project: task.project,
			tags: task.tags,
			due_date: task.due_date,
			completed_at: task.completed_at,
		};
		return {
			id: makeTaskId(task.id),
			platform: "devpad",
			type: "task",
			timestamp: task.updated_at,
			title: task.title,
			payload,
		};
	});
