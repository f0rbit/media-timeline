import type { Platform, TimelineItem } from "@media/schema";
import { createLogger } from "../logger";
import { type NormalizeFunction, registerNormalizer } from "../platforms/registry";
import { truncate } from "../utils";
import type { GitHubTimelineData, RedditTimelineData, TwitterTimelineData } from "./loaders";

const log = createLogger("timeline:normalizers");

export const normalizeGitHub = (data: GitHubTimelineData): TimelineItem[] => {
	const items: TimelineItem[] = [];

	for (const commit of data.commits) {
		items.push({
			id: `github:commit:${commit._repo}:${commit.sha.slice(0, 7)}`,
			platform: "github",
			type: "commit",
			timestamp: commit.author_date,
			title: truncate(commit.message),
			url: commit.url,
			payload: {
				type: "commit",
				sha: commit.sha,
				message: commit.message,
				repo: commit._repo,
				branch: commit.branch,
				additions: commit.additions,
				deletions: commit.deletions,
				files_changed: commit.files_changed,
			},
		});
	}

	log.debug("Normalized GitHub commits", { count: data.commits.length });

	for (const pr of data.prs) {
		items.push({
			id: `github:pr:${pr._repo}:${pr.number}`,
			platform: "github",
			type: "pull_request",
			timestamp: pr.merged_at ?? pr.updated_at,
			title: pr.title,
			url: pr.url,
			payload: {
				type: "pull_request",
				repo: pr._repo,
				number: pr.number,
				title: pr.title,
				state: pr.state,
				action: pr.state,
				head_ref: pr.head_ref,
				base_ref: pr.base_ref,
				additions: pr.additions,
				deletions: pr.deletions,
				changed_files: pr.changed_files,
				commit_shas: pr.commit_shas,
				merge_commit_sha: pr.merge_commit_sha,
				commits: [],
			},
		});
	}

	log.debug("Normalized GitHub PRs", { count: data.prs.length });
	log.info("GitHub normalization complete", { total_items: items.length });
	return items;
};

export const normalizeReddit = (data: RedditTimelineData, _username: string): TimelineItem[] => {
	const items: TimelineItem[] = [];

	for (const post of data.posts) {
		const timestamp = new Date(post.created_utc * 1000).toISOString();
		const content = post.is_self ? post.selftext : post.url;
		const hasMedia = post.is_video || (!post.is_self && (post.url.includes("imgur") || post.url.includes("i.redd.it")));

		items.push({
			id: `reddit:post:${post.id}`,
			platform: "reddit",
			type: "post",
			timestamp,
			title: post.title,
			url: `https://reddit.com${post.permalink}`,
			payload: {
				type: "post",
				content: truncate(content, 200),
				author_handle: post.author,
				author_name: post.author,
				reply_count: post.num_comments,
				repost_count: 0,
				like_count: post.score,
				has_media: hasMedia,
				is_reply: false,
				is_repost: false,
				subreddit: post.subreddit,
			},
		});
	}

	for (const comment of data.comments) {
		const timestamp = new Date(comment.created_utc * 1000).toISOString();

		items.push({
			id: `reddit:comment:${comment.id}`,
			platform: "reddit",
			type: "comment",
			timestamp,
			title: truncate(comment.body),
			url: `https://reddit.com${comment.permalink}`,
			payload: {
				type: "comment",
				content: comment.body,
				author_handle: comment.author,
				parent_title: comment.link_title,
				parent_url: comment.link_permalink.startsWith("http") ? comment.link_permalink : `https://reddit.com${comment.link_permalink}`,
				subreddit: comment.subreddit,
				score: comment.score,
				is_op: comment.is_submitter,
			},
		});
	}

	log.info("Reddit normalization complete", { total_items: items.length });
	return items;
};

export const normalizeTwitter = (data: TwitterTimelineData): TimelineItem[] => {
	const items: TimelineItem[] = [];

	for (const tweet of data.tweets) {
		const isRetweet = tweet.referenced_tweets?.some(r => r.type === "retweeted") ?? false;
		const isReply = tweet.in_reply_to_user_id !== undefined;

		const tweetMediaKeys = tweet.attachments?.media_keys ?? [];
		const hasMedia = tweetMediaKeys.length > 0;

		items.push({
			id: `twitter:tweet:${tweet.id}`,
			platform: "twitter",
			type: "post",
			timestamp: tweet.created_at,
			title: truncate(tweet.text),
			url: `https://twitter.com/${data.meta?.username ?? "i"}/status/${tweet.id}`,
			payload: {
				type: "post",
				content: tweet.text,
				author_handle: data.meta?.username ?? tweet.author_id,
				author_name: data.meta?.name,
				author_avatar: data.meta?.profile_image_url,
				reply_count: tweet.public_metrics.reply_count,
				repost_count: tweet.public_metrics.retweet_count + tweet.public_metrics.quote_count,
				like_count: tweet.public_metrics.like_count,
				has_media: hasMedia,
				is_reply: isReply,
				is_repost: isRetweet,
			},
		});
	}

	log.info("Twitter normalization complete", { total_items: items.length });
	return items;
};

registerNormalizer("github", data => normalizeGitHub(data as GitHubTimelineData));
registerNormalizer("reddit", (data, username) => normalizeReddit(data as RedditTimelineData, username ?? ""));
registerNormalizer("twitter", data => normalizeTwitter(data as TwitterTimelineData));

export const normalizers: Record<Platform, NormalizeFunction> = {
	github: data => normalizeGitHub(data as GitHubTimelineData),
	reddit: (data, username) => normalizeReddit(data as RedditTimelineData, username ?? ""),
	twitter: data => normalizeTwitter(data as TwitterTimelineData),
	bluesky: () => [],
	youtube: () => [],
	devpad: () => [],
};
