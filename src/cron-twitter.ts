import type { Backend } from "@f0rbit/corpus";
import { mergeByKey } from "./merge";
import type { TwitterFetchResult } from "./platforms/twitter";
import type { ProviderError } from "./platforms/types";
import type { TwitterTweetsStore } from "./schema";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { type Result, err, ok, to_nullable } from "./utils";

export type TwitterProcessResult = {
	account_id: string;
	meta_version: string;
	tweets_version: string;
	stats: {
		total_tweets: number;
		new_tweets: number;
	};
};

type ProcessError = { kind: "fetch_failed"; message: string } | { kind: "store_failed"; store_id: string };

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

export async function processTwitterAccount(backend: Backend, accountId: string, token: string, provider: TwitterProvider): Promise<Result<TwitterProcessResult, ProcessError>> {
	console.log(`[processTwitterAccount] Starting for account: ${accountId}`);

	const fetchResult = await provider.fetch(token);
	if (!fetchResult.ok) {
		return err({
			kind: "fetch_failed",
			message: `Twitter fetch failed: ${fetchResult.error.kind}`,
		});
	}

	const { meta, tweets } = fetchResult.value;

	let metaVersion = "";
	const metaStoreResult = createTwitterMetaStore(backend, accountId);
	if (metaStoreResult.ok) {
		const putResult = await metaStoreResult.value.store.put(meta);
		if (putResult.ok) {
			metaVersion = putResult.value.version;
		}
	}

	let tweetsVersion = "";
	let newTweets = 0;
	let totalTweets = 0;
	const tweetsStoreResult = createTwitterTweetsStore(backend, accountId);
	if (tweetsStoreResult.ok) {
		const store = tweetsStoreResult.value.store;
		const existingResult = await store.get_latest();
		const existing = to_nullable(existingResult)?.data ?? null;
		const { merged, newCount } = mergeTweets(existing, tweets);
		newTweets = newCount;
		totalTweets = merged.total_tweets;

		const putResult = await store.put(merged);
		if (putResult.ok) {
			tweetsVersion = putResult.value.version;
		}

		console.log(`[processTwitterAccount] Tweets: ${newCount} new, ${merged.total_tweets} total`);
	}

	console.log("[processTwitterAccount] Completed:", {
		tweets: totalTweets,
		newTweets,
	});

	return ok({
		account_id: accountId,
		meta_version: metaVersion,
		tweets_version: tweetsVersion,
		stats: {
			total_tweets: totalTweets,
			new_tweets: newTweets,
		},
	});
}
