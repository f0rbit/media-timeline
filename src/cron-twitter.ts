import type { Backend } from "@f0rbit/corpus";
import type { TwitterFetchResult } from "./platforms/twitter";
import type { ProviderError } from "./platforms/types";
import type { TwitterTweetsStore } from "./schema";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { err, ok, type Result, to_nullable } from "./utils";

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

type MergeResult = { merged: TwitterTweetsStore; newCount: number };

const mergeTweets = (existing: TwitterTweetsStore | null, incoming: TwitterTweetsStore): MergeResult => {
	if (!existing) {
		return { merged: incoming, newCount: incoming.tweets.length };
	}

	const existingIds = new Set(existing.tweets.map(t => t.id));
	const newTweets = incoming.tweets.filter(t => !existingIds.has(t.id));

	const updatedExisting = existing.tweets.map(existingTweet => {
		const incomingTweet = incoming.tweets.find(t => t.id === existingTweet.id);
		if (incomingTweet) {
			return { ...existingTweet, public_metrics: incomingTweet.public_metrics };
		}
		return existingTweet;
	});

	const existingMediaKeys = new Set(existing.media.map(m => m.media_key));
	const newMedia = incoming.media.filter(m => !existingMediaKeys.has(m.media_key));

	return {
		merged: {
			user_id: incoming.user_id,
			username: incoming.username,
			tweets: [...updatedExisting, ...newTweets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
			media: [...existing.media, ...newMedia],
			total_tweets: updatedExisting.length + newTweets.length,
			oldest_tweet_id: existing.oldest_tweet_id ?? incoming.oldest_tweet_id,
			newest_tweet_id: incoming.newest_tweet_id ?? existing.newest_tweet_id,
			fetched_at: incoming.fetched_at,
		},
		newCount: newTweets.length,
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

	console.log(`[processTwitterAccount] Completed:`, {
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
