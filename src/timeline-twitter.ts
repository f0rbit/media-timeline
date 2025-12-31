import type { Backend } from "@f0rbit/corpus";
import { createLogger } from "./logger";
import type { TimelineItem, TweetMedia, TwitterMetaStore, TwitterTweet } from "./schema";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { truncate } from "./utils";

const log = createLogger("timeline:twitter");

export type TwitterTimelineData = {
	tweets: TwitterTweet[];
	media: TweetMedia[];
	meta: TwitterMetaStore | null;
};

export async function loadTwitterDataForAccount(backend: Backend, accountId: string): Promise<TwitterTimelineData> {
	// Note: corpus json_codec applies Zod defaults during decode, so the runtime type is correct
	const [tweetsData, meta] = await Promise.all([
		(async (): Promise<{ tweets: TwitterTweet[]; media: TweetMedia[] }> => {
			const storeResult = createTwitterTweetsStore(backend, accountId);
			if (!storeResult.ok) return { tweets: [], media: [] };
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return { tweets: [], media: [] };
			const data = snapshotResult.value.data;
			return { tweets: data.tweets as TwitterTweet[], media: (data.media ?? []) as TweetMedia[] };
		})(),
		(async (): Promise<TwitterMetaStore | null> => {
			const storeResult = createTwitterMetaStore(backend, accountId);
			if (!storeResult.ok) return null;
			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok) return null;
			return snapshotResult.value.data as TwitterMetaStore;
		})(),
	]);

	log.info("Loaded data", { account_id: accountId, tweets: tweetsData.tweets.length, media: tweetsData.media.length });
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

	log.info("Normalization complete", { total_items: items.length });
	return items;
}
