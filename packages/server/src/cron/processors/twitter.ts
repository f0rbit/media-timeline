import type { Backend } from "@f0rbit/corpus";
import type { TwitterMetaStore, TwitterTweetsStore } from "@media/schema";
import { createLogger } from "../../logger";
import { mergeByKey } from "../../merge";
import type { TwitterFetchResult } from "../../platforms/twitter";
import type { ProviderError } from "../../platforms/types";
import { createTwitterMetaStore, createTwitterTweetsStore } from "../../storage";
import { type Result, ok, pipe } from "../../utils";
import { type ProcessError, type StoreStats, formatFetchError, storeMeta as genericStoreMeta, storeWithMerge } from "../platform-processor";

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

const storeTweets = (backend: Backend, accountId: string, tweets: TwitterTweetsStore): Promise<StoreStats> =>
	storeWithMerge(backend, accountId, { name: "tweets", create: createTwitterTweetsStore, merge: mergeTweets, getKey: () => "", getTotal: m => m.total_tweets }, tweets);

export const processTwitterAccount = (backend: Backend, accountId: string, token: string, provider: TwitterProvider): Promise<Result<TwitterProcessResult, ProcessError>> =>
	pipe(provider.fetch(token))
		.tap(() => log.info("Processing account", { account_id: accountId }))
		.map_err((e): ProcessError => formatFetchError("Twitter", e))
		.flat_map(async ({ meta, tweets }) => {
			const [metaVersion, tweetsResult] = await Promise.all([storeMeta(backend, accountId, meta), storeTweets(backend, accountId, tweets)]);

			log.info("Processing complete", {
				account_id: accountId,
				total_tweets: tweetsResult.total,
				new_tweets: tweetsResult.newCount,
			});

			return ok<TwitterProcessResult>({
				account_id: accountId,
				meta_version: metaVersion,
				tweets_version: tweetsResult.version,
				stats: {
					total_tweets: tweetsResult.total,
					new_tweets: tweetsResult.newCount,
				},
			});
		})
		.result();
