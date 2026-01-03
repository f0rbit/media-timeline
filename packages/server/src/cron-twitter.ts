import type { Backend } from "@f0rbit/corpus";
import type { TwitterMetaStore, TwitterTweetsStore } from "@media/schema";
import { type ProcessError, type StoreStats, defaultStats, formatFetchError, storeMeta as genericStoreMeta } from "./cron/platform-processor";
import { createLogger } from "./logger";
import { mergeByKey } from "./merge";
import type { TwitterFetchResult } from "./platforms/twitter";
import type { ProviderError } from "./platforms/types";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { type Result, ok, pipe, to_nullable } from "./utils";

const log = createLogger("cron:twitter");

export type TwitterProcessResult = {
	account_id: string;
	meta_version: string;
	tweets_version: string;
	stats: {
		total_tweets: number;
		new_tweets: number;
	};
};

type TwitterStoreStats = StoreStats & { totalTweets: number };
const defaultTwitterStats: TwitterStoreStats = { ...defaultStats, totalTweets: 0 };

const mergeTweets = (existing: TwitterTweetsStore | null, incoming: TwitterTweetsStore): { merged: TwitterTweetsStore; newCount: number } => {
	const { merged: tweets, newCount } = mergeByKey(existing?.tweets, incoming.tweets, t => t.id);
	const { merged: media } = mergeByKey(existing?.media, incoming.media, m => m.media_key);

	return {
		merged: {
			user_id: incoming.user_id,
			username: incoming.username,
			tweets: tweets.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
			media,
			total_tweets: tweets.length,
			oldest_tweet_id: existing?.oldest_tweet_id ?? incoming.oldest_tweet_id,
			newest_tweet_id: incoming.newest_tweet_id ?? existing?.newest_tweet_id,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

type TwitterProvider = {
	fetch(token: string): Promise<Result<TwitterFetchResult, ProviderError>>;
};

const storeMeta = (backend: Backend, accountId: string, meta: TwitterMetaStore): Promise<string> => genericStoreMeta(backend, accountId, createTwitterMetaStore, meta);

const storeTweets = async (backend: Backend, accountId: string, tweets: TwitterTweetsStore): Promise<TwitterStoreStats> => {
	const storeResult = createTwitterTweetsStore(backend, accountId);
	if (!storeResult.ok) return defaultTwitterStats;

	const store = storeResult.value.store;
	const existing = to_nullable(await store.get_latest())?.data ?? null;
	const { merged, newCount } = mergeTweets(existing, tweets);
	const putResult = await store.put(merged);

	if (!putResult.ok) return defaultTwitterStats;

	log.debug("Stored tweets", { new: newCount, total: merged.total_tweets });
	return { version: putResult.value.version, newCount, total: merged.total_tweets, totalTweets: merged.total_tweets };
};

export const processTwitterAccount = (backend: Backend, accountId: string, token: string, provider: TwitterProvider): Promise<Result<TwitterProcessResult, ProcessError>> =>
	pipe(provider.fetch(token))
		.tap(() => log.info("Processing account", { account_id: accountId }))
		.map_err((e): ProcessError => formatFetchError("Twitter", e))
		.flat_map(async ({ meta, tweets }) => {
			const [metaVersion, tweetsResult] = await Promise.all([storeMeta(backend, accountId, meta), storeTweets(backend, accountId, tweets)]);

			log.info("Processing complete", {
				account_id: accountId,
				total_tweets: tweetsResult.totalTweets,
				new_tweets: tweetsResult.newCount,
			});

			return ok<TwitterProcessResult>({
				account_id: accountId,
				meta_version: metaVersion,
				tweets_version: tweetsResult.version,
				stats: {
					total_tweets: tweetsResult.totalTweets,
					new_tweets: tweetsResult.newCount,
				},
			});
		})
		.result();
