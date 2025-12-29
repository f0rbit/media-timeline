import type { Backend } from "@f0rbit/corpus";
import type { TimelineItem, TweetMedia, TwitterMetaStore, TwitterTweet } from "./schema";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { truncate } from "./utils";

export type TwitterTimelineData = {
	tweets: TwitterTweet[];
	media: TweetMedia[];
	meta: TwitterMetaStore | null;
};

export async function loadTwitterDataForAccount(backend: Backend, accountId: string): Promise<TwitterTimelineData> {
	const [tweetsData, meta] = await Promise.all([
		(async (): Promise<{ tweets: TwitterTweet[]; media: TweetMedia[] }> => {
			const storeResult = createTwitterTweetsStore(backend, accountId);
			if (!storeResult.ok) return { tweets: [], media: [] };
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return { tweets: [], media: [] };
			return { tweets: snapshotResult.value.data.tweets, media: snapshotResult.value.data.media };
		})(),
		(async (): Promise<TwitterMetaStore | null> => {
			const storeResult = createTwitterMetaStore(backend, accountId);
			if (!storeResult.ok) return null;
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return null;
			return snapshotResult.value.data;
		})(),
	]);

	console.log(`[loadTwitterDataForAccount] Loaded: ${tweetsData.tweets.length} tweets, ${tweetsData.media.length} media`);
	return { tweets: tweetsData.tweets, media: tweetsData.media, meta };
}

export function normalizeTwitter(data: TwitterTimelineData): TimelineItem[] {
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

	console.log(`[normalizeTwitter] Generated ${items.length} timeline items`);
	return items;
}
