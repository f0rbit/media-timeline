# Twitter/X Integration Implementation Plan

## Overview

Add Twitter/X integration to the media-timeline application to aggregate a user's tweets, retweets, and likes into the unified timeline. This integration follows the established GitHub multi-store architecture pattern, with separate stores for tweets and user metadata.

**Important Note:** Twitter/X API access has become significantly more restrictive and expensive since the platform changes in 2023. This plan includes details on API tier requirements and alternatives.

## API Access Tiers

### Twitter API v2 Pricing (as of 2024)

| Tier | Monthly Cost | Tweet Cap | Read Access | Notes |
|------|--------------|-----------|-------------|-------|
| Free | $0 | 1,500/month | Limited | Write only, no user timeline read |
| Basic | $100 | 10,000/month | Yes | User timeline access |
| Pro | $5,000 | 1M/month | Yes | Full access |
| Enterprise | Custom | Custom | Yes | Full access |

**Recommendation:** Basic tier ($100/month) is the minimum required for reading user timelines.

### Alternative: Self-hosted Data Collection

For users who want to avoid API costs, consider:
1. Browser extension that exports user's own tweets
2. Twitter archive import (users can request their data)
3. Nitter instance scraping (gray area, may break)

## TypeScript API Client

### Recommended Package: `twitter-api-v2`

**Package:** [`twitter-api-v2`](https://www.npmjs.com/package/twitter-api-v2)  
**Version:** `^1.15.0`  
**Types:** Included (TypeScript-first library)

**Why twitter-api-v2:**
- Official-ish, most popular TypeScript Twitter client
- Full API v2 support
- Built-in OAuth 2.0 with PKCE
- Rate limit handling
- Pagination helpers
- Works with both OAuth 1.0a and OAuth 2.0

**Example usage:**
```typescript
import { TwitterApi } from 'twitter-api-v2';

// With user OAuth 2.0 token
const client = new TwitterApi(userAccessToken);

// Get user info
const me = await client.v2.me();

// Get user's tweets with pagination
const tweets = await client.v2.userTimeline(userId, {
  max_results: 100,
  'tweet.fields': ['created_at', 'public_metrics', 'entities', 'attachments'],
  'user.fields': ['profile_image_url', 'username'],
  expansions: ['author_id', 'attachments.media_keys'],
});

// Iterate with pagination
for await (const tweet of tweets) {
  console.log(tweet.text);
}
```

**Cloudflare Workers Compatibility:**
The `twitter-api-v2` library uses native `fetch` internally and should work in Cloudflare Workers without modifications.

## Authentication Flow

Twitter/X uses OAuth 2.0 with PKCE for user authentication.

### OAuth 2.0 Scopes Required
- `tweet.read` - Read tweets
- `users.read` - Read user profile information
- `offline.access` - Get refresh tokens

### Flow
```
1. User initiates connection from frontend
2. Generate PKCE code verifier and challenge
3. Redirect to: https://twitter.com/i/oauth2/authorize
   - response_type=code
   - client_id
   - redirect_uri
   - scope=tweet.read users.read offline.access
   - state (CSRF + code_verifier storage key)
   - code_challenge
   - code_challenge_method=S256
4. User approves on Twitter
5. Twitter redirects back with authorization code
6. Backend exchanges code for tokens:
   POST https://api.twitter.com/2/oauth2/token
   - grant_type=authorization_code
   - code={authorization_code}
   - redirect_uri={redirect_uri}
   - client_id
   - code_verifier
7. Store encrypted tokens in database
8. Use refresh token when access token expires (2 hours)
```

### Token Refresh
```typescript
// POST https://api.twitter.com/2/oauth2/token
// Content-Type: application/x-www-form-urlencoded
// Body: grant_type=refresh_token&refresh_token={refresh_token}&client_id={client_id}
```

**Important:** Refresh tokens expire after 6 months of inactivity.

## Schema Definitions

### File: `src/schema/twitter-tweets.ts`

```typescript
import { z } from "zod";

// Tweet public metrics
export const TweetMetricsSchema = z.object({
  retweet_count: z.number().default(0),
  reply_count: z.number().default(0),
  like_count: z.number().default(0),
  quote_count: z.number().default(0),
  impression_count: z.number().optional(),
  bookmark_count: z.number().optional(),
});

// Media attachment
export const TweetMediaSchema = z.object({
  media_key: z.string(),
  type: z.enum(["photo", "video", "animated_gif"]),
  url: z.string().url().optional(),
  preview_image_url: z.string().url().optional(),
  alt_text: z.string().optional(),
  duration_ms: z.number().optional(), // for video
  width: z.number().optional(),
  height: z.number().optional(),
});

// URL entity
export const TweetUrlSchema = z.object({
  start: z.number(),
  end: z.number(),
  url: z.string(),
  expanded_url: z.string(),
  display_url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

// Individual tweet
export const TwitterTweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().datetime(),
  author_id: z.string(),
  conversation_id: z.string().optional(),
  in_reply_to_user_id: z.string().optional(),
  public_metrics: TweetMetricsSchema,
  possibly_sensitive: z.boolean().default(false),
  lang: z.string().optional(),
  source: z.string().optional(), // e.g., "Twitter Web App"
  // Referenced tweets (retweets, quotes, replies)
  referenced_tweets: z.array(z.object({
    type: z.enum(["retweeted", "quoted", "replied_to"]),
    id: z.string(),
  })).optional(),
  // Attachments
  attachments: z.object({
    media_keys: z.array(z.string()).optional(),
    poll_ids: z.array(z.string()).optional(),
  }).optional(),
  // Entities (URLs, mentions, hashtags)
  entities: z.object({
    urls: z.array(TweetUrlSchema).optional(),
    mentions: z.array(z.object({
      start: z.number(),
      end: z.number(),
      username: z.string(),
      id: z.string(),
    })).optional(),
    hashtags: z.array(z.object({
      start: z.number(),
      end: z.number(),
      tag: z.string(),
    })).optional(),
  }).optional(),
});

// Store for tweets per user
export const TwitterTweetsStoreSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  tweets: z.array(TwitterTweetSchema),
  // Included media (expanded from attachments.media_keys)
  media: z.array(TweetMediaSchema).default([]),
  total_tweets: z.number(),
  oldest_tweet_id: z.string().optional(), // for pagination
  newest_tweet_id: z.string().optional(),
  fetched_at: z.string().datetime(),
});

export type TweetMetrics = z.infer<typeof TweetMetricsSchema>;
export type TweetMedia = z.infer<typeof TweetMediaSchema>;
export type TwitterTweet = z.infer<typeof TwitterTweetSchema>;
export type TwitterTweetsStore = z.infer<typeof TwitterTweetsStoreSchema>;
```

### File: `src/schema/twitter-meta.ts`

```typescript
import { z } from "zod";

// User public metrics
export const TwitterUserMetricsSchema = z.object({
  followers_count: z.number(),
  following_count: z.number(),
  tweet_count: z.number(),
  listed_count: z.number(),
});

// User metadata
export const TwitterMetaStoreSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  description: z.string().optional(),
  profile_image_url: z.string().url().optional(),
  profile_banner_url: z.string().url().optional(),
  url: z.string().url().optional(),
  location: z.string().optional(),
  created_at: z.string().datetime(),
  verified: z.boolean().default(false),
  verified_type: z.enum(["blue", "business", "government", "none"]).default("none"),
  protected: z.boolean().default(false),
  public_metrics: TwitterUserMetricsSchema,
  pinned_tweet_id: z.string().optional(),
  fetched_at: z.string().datetime(),
});

export type TwitterUserMetrics = z.infer<typeof TwitterUserMetricsSchema>;
export type TwitterMetaStore = z.infer<typeof TwitterMetaStoreSchema>;
```

### Update `src/schema/timeline.ts`

```typescript
// Add to PlatformSchema:
export const PlatformSchema = z.enum([
  "github", "bluesky", "youtube", "devpad", "reddit", "twitter"
]);

// Twitter can use existing PostPayloadSchema with these mappings:
// - content: tweet text
// - author_handle: @username
// - author_name: display name
// - author_avatar: profile_image_url
// - reply_count: public_metrics.reply_count
// - repost_count: public_metrics.retweet_count + quote_count
// - like_count: public_metrics.like_count
// - has_media: attachments.media_keys.length > 0
// - is_reply: in_reply_to_user_id !== undefined
// - is_repost: referenced_tweets contains "retweeted"
```

### Update `src/schema/index.ts`

```typescript
export * from "./twitter-tweets";
export * from "./twitter-meta";
```

## Storage Pattern

Following the GitHub multi-store pattern:

```
twitter/{account_id}/meta         - User metadata
twitter/{account_id}/tweets       - User's tweets
```

### File: `src/storage.ts` additions

```typescript
// Store ID types
export type TwitterMetaStoreId = `twitter/${string}/meta`;
export type TwitterTweetsStoreId = `twitter/${string}/tweets`;

// Store ID helpers
export const twitterMetaStoreId = (accountId: string): TwitterMetaStoreId => 
  `twitter/${accountId}/meta`;

export const twitterTweetsStoreId = (accountId: string): TwitterTweetsStoreId => 
  `twitter/${accountId}/tweets`;

// Store creators
export function createTwitterMetaStore(backend: Backend, accountId: string): Result<...> { ... }
export function createTwitterTweetsStore(backend: Backend, accountId: string): Result<...> { ... }
```

## Provider Class

### File: `src/platforms/twitter.ts`

```typescript
import { TwitterApi, type TweetV2, type UserV2 } from 'twitter-api-v2';
import type { Result } from "../utils";
import { ok, err } from "../utils";
import type { ProviderError } from "./types";
import type { 
  TwitterMetaStore, 
  TwitterTweetsStore,
  TwitterTweet,
  TweetMedia 
} from "../schema";

export type TwitterProviderConfig = {
  maxTweets: number;
  includeRetweets: boolean;
  includeReplies: boolean;
};

const DEFAULT_CONFIG: TwitterProviderConfig = {
  maxTweets: 3200, // Twitter API max for user timeline
  includeRetweets: true,
  includeReplies: false, // Usually too noisy
};

export type TwitterFetchResult = {
  meta: TwitterMetaStore;
  tweets: TwitterTweetsStore;
};

export class TwitterProvider {
  readonly platform = "twitter";
  private config: TwitterProviderConfig;

  constructor(config: Partial<TwitterProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async fetch(token: string): Promise<Result<TwitterFetchResult, ProviderError>> {
    try {
      const client = new TwitterApi(token);

      // 1. Fetch user info
      const userResult = await this.fetchUser(client);
      if (!userResult.ok) return userResult;
      const { userId, meta } = userResult.value;

      // 2. Fetch tweets
      const tweetsResult = await this.fetchTweets(client, userId, meta.username);
      if (!tweetsResult.ok) return tweetsResult;

      return ok({
        meta,
        tweets: tweetsResult.value,
      });
    } catch (error) {
      return err(this.mapError(error));
    }
  }

  private async fetchUser(client: TwitterApi): Promise<Result<{ userId: string; meta: TwitterMetaStore }, ProviderError>> {
    try {
      const me = await client.v2.me({
        'user.fields': [
          'created_at',
          'description',
          'profile_image_url',
          'public_metrics',
          'verified',
          'verified_type',
          'protected',
          'location',
          'url',
          'pinned_tweet_id',
        ],
      });

      const user = me.data;
      
      return ok({
        userId: user.id,
        meta: {
          id: user.id,
          username: user.username,
          name: user.name,
          description: user.description,
          profile_image_url: user.profile_image_url,
          url: user.url,
          location: user.location,
          created_at: user.created_at ?? new Date().toISOString(),
          verified: user.verified ?? false,
          verified_type: this.mapVerifiedType(user.verified_type),
          protected: user.protected ?? false,
          public_metrics: {
            followers_count: user.public_metrics?.followers_count ?? 0,
            following_count: user.public_metrics?.following_count ?? 0,
            tweet_count: user.public_metrics?.tweet_count ?? 0,
            listed_count: user.public_metrics?.listed_count ?? 0,
          },
          pinned_tweet_id: user.pinned_tweet_id,
          fetched_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      return err(this.mapError(error));
    }
  }

  private async fetchTweets(
    client: TwitterApi, 
    userId: string, 
    username: string
  ): Promise<Result<TwitterTweetsStore, ProviderError>> {
    try {
      const tweets: TwitterTweet[] = [];
      const mediaMap = new Map<string, TweetMedia>();
      let oldestId: string | undefined;
      let newestId: string | undefined;

      // Build exclude array based on config
      const exclude: ('retweets' | 'replies')[] = [];
      if (!this.config.includeRetweets) exclude.push('retweets');
      if (!this.config.includeReplies) exclude.push('replies');

      const paginator = await client.v2.userTimeline(userId, {
        max_results: 100,
        exclude: exclude.length > 0 ? exclude : undefined,
        'tweet.fields': [
          'created_at',
          'public_metrics',
          'entities',
          'attachments',
          'referenced_tweets',
          'in_reply_to_user_id',
          'conversation_id',
          'possibly_sensitive',
          'lang',
          'source',
        ],
        'media.fields': [
          'type',
          'url',
          'preview_image_url',
          'alt_text',
          'duration_ms',
          'width',
          'height',
        ],
        expansions: ['attachments.media_keys'],
      });

      // Iterate through pages
      let fetchedCount = 0;
      for await (const tweet of paginator) {
        if (fetchedCount >= this.config.maxTweets) break;

        const parsed = this.parseTweet(tweet);
        tweets.push(parsed);

        if (!newestId) newestId = tweet.id;
        oldestId = tweet.id;

        fetchedCount++;
      }

      // Extract media from includes
      const includes = paginator.includes;
      if (includes?.media) {
        for (const media of includes.media) {
          mediaMap.set(media.media_key, {
            media_key: media.media_key,
            type: media.type as "photo" | "video" | "animated_gif",
            url: media.url,
            preview_image_url: media.preview_image_url,
            alt_text: media.alt_text,
            duration_ms: media.duration_ms,
            width: media.width,
            height: media.height,
          });
        }
      }

      return ok({
        user_id: userId,
        username,
        tweets,
        media: Array.from(mediaMap.values()),
        total_tweets: tweets.length,
        oldest_tweet_id: oldestId,
        newest_tweet_id: newestId,
        fetched_at: new Date().toISOString(),
      });
    } catch (error) {
      return err(this.mapError(error));
    }
  }

  private parseTweet(tweet: TweetV2): TwitterTweet {
    return {
      id: tweet.id,
      text: tweet.text,
      created_at: tweet.created_at ?? new Date().toISOString(),
      author_id: tweet.author_id ?? "",
      conversation_id: tweet.conversation_id,
      in_reply_to_user_id: tweet.in_reply_to_user_id,
      public_metrics: {
        retweet_count: tweet.public_metrics?.retweet_count ?? 0,
        reply_count: tweet.public_metrics?.reply_count ?? 0,
        like_count: tweet.public_metrics?.like_count ?? 0,
        quote_count: tweet.public_metrics?.quote_count ?? 0,
        impression_count: tweet.public_metrics?.impression_count,
        bookmark_count: tweet.public_metrics?.bookmark_count,
      },
      possibly_sensitive: tweet.possibly_sensitive ?? false,
      lang: tweet.lang,
      source: tweet.source,
      referenced_tweets: tweet.referenced_tweets?.map(ref => ({
        type: ref.type,
        id: ref.id,
      })),
      attachments: tweet.attachments ? {
        media_keys: tweet.attachments.media_keys,
        poll_ids: tweet.attachments.poll_ids,
      } : undefined,
      entities: tweet.entities ? {
        urls: tweet.entities.urls?.map(url => ({
          start: url.start,
          end: url.end,
          url: url.url,
          expanded_url: url.expanded_url,
          display_url: url.display_url,
          title: url.title,
          description: url.description,
        })),
        mentions: tweet.entities.mentions?.map(m => ({
          start: m.start,
          end: m.end,
          username: m.username,
          id: m.id,
        })),
        hashtags: tweet.entities.hashtags?.map(h => ({
          start: h.start,
          end: h.end,
          tag: h.tag,
        })),
      } : undefined,
    };
  }

  private mapVerifiedType(type: string | undefined): "blue" | "business" | "government" | "none" {
    switch (type) {
      case 'blue': return 'blue';
      case 'business': return 'business';
      case 'government': return 'government';
      default: return 'none';
    }
  }

  private mapError(error: unknown): ProviderError {
    if (error && typeof error === 'object') {
      // Twitter API v2 error structure
      if ('code' in error) {
        const code = (error as { code: number }).code;
        const message = (error as { message?: string }).message ?? 'Unknown error';

        // Rate limit
        if (code === 429) {
          const resetTime = (error as { rateLimit?: { reset?: number } }).rateLimit?.reset;
          const retryAfter = resetTime ? Math.max(0, resetTime - Math.floor(Date.now() / 1000)) : 900;
          return { kind: "rate_limited", retry_after: retryAfter };
        }

        // Auth errors
        if (code === 401 || code === 403) {
          return { kind: "auth_expired", message: `Twitter auth error: ${message}` };
        }

        return { kind: "api_error", status: code, message };
      }
    }

    if (error instanceof Error) {
      return { kind: "network_error", cause: error };
    }

    return { kind: "network_error", cause: new Error(String(error)) };
  }
}
```

## Cron Processing

### File: `src/cron-twitter.ts`

```typescript
import type { Backend } from "@f0rbit/corpus";
import type { TwitterFetchResult } from "./platforms/twitter";
import { createTwitterMetaStore, createTwitterTweetsStore } from "./storage";
import { ok, err, to_nullable, type Result } from "./utils";
import type { TwitterTweetsStore } from "./schema";
import type { ProviderError } from "./platforms/types";

export type TwitterProcessResult = {
  account_id: string;
  meta_version: string;
  tweets_version: string;
  stats: {
    total_tweets: number;
    new_tweets: number;
  };
};

type ProcessError = 
  | { kind: "fetch_failed"; message: string }
  | { kind: "store_failed"; store_id: string };

type MergeResult = { merged: TwitterTweetsStore; newCount: number };

const mergeTweets = (
  existing: TwitterTweetsStore | null,
  incoming: TwitterTweetsStore
): MergeResult => {
  if (!existing) {
    return { merged: incoming, newCount: incoming.tweets.length };
  }

  const existingIds = new Set(existing.tweets.map(t => t.id));
  const newTweets = incoming.tweets.filter(t => !existingIds.has(t.id));

  // Also update metrics for existing tweets
  const updatedExisting = existing.tweets.map(existingTweet => {
    const incomingTweet = incoming.tweets.find(t => t.id === existingTweet.id);
    if (incomingTweet) {
      // Update public metrics (likes, retweets change over time)
      return { ...existingTweet, public_metrics: incomingTweet.public_metrics };
    }
    return existingTweet;
  });

  // Merge media
  const existingMediaKeys = new Set(existing.media.map(m => m.media_key));
  const newMedia = incoming.media.filter(m => !existingMediaKeys.has(m.media_key));

  return {
    merged: {
      user_id: incoming.user_id,
      username: incoming.username,
      tweets: [...updatedExisting, ...newTweets].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
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

export async function processTwitterAccount(
  backend: Backend,
  accountId: string,
  token: string,
  provider: TwitterProvider
): Promise<Result<TwitterProcessResult, ProcessError>> {
  console.log(`[processTwitterAccount] Starting for account: ${accountId}`);

  const fetchResult = await provider.fetch(token);
  if (!fetchResult.ok) {
    return err({
      kind: "fetch_failed",
      message: `Twitter fetch failed: ${fetchResult.error.kind}`,
    });
  }

  const { meta, tweets } = fetchResult.value;

  // Save meta
  let metaVersion = "";
  const metaStoreResult = createTwitterMetaStore(backend, accountId);
  if (metaStoreResult.ok) {
    const putResult = await metaStoreResult.value.store.put(meta);
    if (putResult.ok) {
      metaVersion = putResult.value.version;
    }
  }

  // Save tweets with merge
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
```

## Timeline Normalization

### File: `src/timeline-twitter.ts`

```typescript
import type { Backend } from "@f0rbit/corpus";
import { createTwitterTweetsStore, createTwitterMetaStore } from "./storage";
import type { TwitterTweet, TweetMedia, TwitterMetaStore, TimelineItem, PostPayload } from "./schema";

type TwitterTimelineData = {
  tweets: TwitterTweet[];
  media: TweetMedia[];
  meta: TwitterMetaStore | null;
};

export async function loadTwitterDataForAccount(
  backend: Backend,
  accountId: string
): Promise<TwitterTimelineData> {
  let tweets: TwitterTweet[] = [];
  let media: TweetMedia[] = [];
  let meta: TwitterMetaStore | null = null;

  const tweetsStoreResult = createTwitterTweetsStore(backend, accountId);
  if (tweetsStoreResult.ok) {
    const snapshotResult = await tweetsStoreResult.value.store.get_latest();
    if (snapshotResult.ok && snapshotResult.value) {
      tweets = snapshotResult.value.data.tweets;
      media = snapshotResult.value.data.media;
    }
  }

  const metaStoreResult = createTwitterMetaStore(backend, accountId);
  if (metaStoreResult.ok) {
    const snapshotResult = await metaStoreResult.value.store.get_latest();
    if (snapshotResult.ok && snapshotResult.value) {
      meta = snapshotResult.value.data;
    }
  }

  console.log(`[loadTwitterDataForAccount] Loaded: ${tweets.length} tweets, ${media.length} media`);
  return { tweets, media, meta };
}

export function normalizeTwitter(data: TwitterTimelineData): TimelineItem[] {
  const items: TimelineItem[] = [];
  const mediaMap = new Map(data.media.map(m => [m.media_key, m]));

  for (const tweet of data.tweets) {
    // Determine tweet type
    const isRetweet = tweet.referenced_tweets?.some(r => r.type === 'retweeted') ?? false;
    const isQuote = tweet.referenced_tweets?.some(r => r.type === 'quoted') ?? false;
    const isReply = tweet.in_reply_to_user_id !== undefined;

    // Get media for this tweet
    const tweetMediaKeys = tweet.attachments?.media_keys ?? [];
    const hasMedia = tweetMediaKeys.length > 0;

    // Build display text
    let displayText = tweet.text;
    
    // For retweets, the text starts with "RT @username: "
    // which is usually truncated - we keep it as-is
    
    const payload: PostPayload = {
      type: "post",
      content: displayText,
      author_handle: data.meta?.username ?? tweet.author_id,
      author_name: data.meta?.name,
      author_avatar: data.meta?.profile_image_url,
      reply_count: tweet.public_metrics.reply_count,
      repost_count: tweet.public_metrics.retweet_count + tweet.public_metrics.quote_count,
      like_count: tweet.public_metrics.like_count,
      has_media: hasMedia,
      is_reply: isReply,
      is_repost: isRetweet,
    };

    // Generate title (first line, truncated)
    const title = truncateTitle(displayText);

    items.push({
      id: `twitter:tweet:${tweet.id}`,
      platform: "twitter",
      type: "post",
      timestamp: tweet.created_at,
      title,
      url: `https://twitter.com/${data.meta?.username ?? 'i'}/status/${tweet.id}`,
      payload,
    });
  }

  console.log(`[normalizeTwitter] Generated ${items.length} timeline items`);
  return items;
}

const truncateTitle = (text: string, maxLength = 72): string => {
  // Remove newlines and excess whitespace
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
};

export type { TwitterTimelineData };
```

## Route Updates

### Updates to `src/routes.ts`

```typescript
// Update CreateConnectionBodySchema
const CreateConnectionBodySchema = z.object({
  platform: z.enum(["github", "bluesky", "youtube", "devpad", "reddit", "twitter"]),
  // ... rest unchanged
});
```

## Frontend Components

### File: `apps/website/src/components/solid/PlatformSettings/TwitterSettings.tsx`

```tsx
import { createResource, createSignal, Show } from "solid-js";
import { connections } from "@/utils/api-client";

type Props = {
  accountId: string;
  settings: { 
    include_retweets?: boolean;
    include_replies?: boolean;
    hide_sensitive?: boolean;
  } | null;
  onUpdate: () => void;
};

export default function TwitterSettings(props: Props) {
  const [expanded, setExpanded] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const includeRetweets = () => props.settings?.include_retweets ?? true;
  const includeReplies = () => props.settings?.include_replies ?? false;
  const hideSensitive = () => props.settings?.hide_sensitive ?? false;

  const updateSetting = async (key: string, value: boolean) => {
    setSaving(true);
    await connections.updateSettings(props.accountId, { [key]: value });
    setSaving(false);
    props.onUpdate();
  };

  return (
    <div class="settings-section">
      <button type="button" class="settings-header" onClick={() => setExpanded(!expanded())}>
        <ChevronIcon expanded={expanded()} />
        <h6 class="settings-title">Twitter/X Settings</h6>
      </button>

      <Show when={expanded()}>
        <div class="settings-content">
          <div class="setting-row">
            <label>
              <input 
                type="checkbox" 
                checked={includeRetweets()} 
                onChange={() => updateSetting('include_retweets', !includeRetweets())}
                disabled={saving()}
              />
              <span>Include retweets in timeline</span>
            </label>
          </div>
          
          <div class="setting-row">
            <label>
              <input 
                type="checkbox" 
                checked={includeReplies()} 
                onChange={() => updateSetting('include_replies', !includeReplies())}
                disabled={saving()}
              />
              <span>Include replies in timeline</span>
            </label>
          </div>
          
          <div class="setting-row">
            <label>
              <input 
                type="checkbox" 
                checked={hideSensitive()} 
                onChange={() => updateSetting('hide_sensitive', !hideSensitive())}
                disabled={saving()}
              />
              <span>Hide sensitive content</span>
            </label>
          </div>

          <p class="muted text-xs mt-2">
            Note: Changes apply on next data refresh.
          </p>
        </div>
      </Show>
    </div>
  );
}

function ChevronIcon(props: { expanded: boolean }) {
  return (
    <svg
      class={`chevron-icon ${props.expanded ? "expanded" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
```

## Database Changes

### Update `src/schema/database.ts`

```typescript
// Update Platform type
export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";
```

No new tables required.

## Environment Variables

Add to Cloudflare Workers secrets:

```bash
wrangler secret put TWITTER_CLIENT_ID
wrangler secret put TWITTER_CLIENT_SECRET
```

### Update `src/bindings.ts`

```typescript
export type Bindings = {
  // ... existing bindings
  TWITTER_CLIENT_ID: string;
  TWITTER_CLIENT_SECRET: string;
};
```

## Rate Limiting

Twitter API v2 rate limits vary by endpoint and tier:

### Basic Tier Limits
| Endpoint | Requests | Window |
|----------|----------|--------|
| User Timeline | 1,500 | 15 min |
| User Lookup | 500 | 15 min |

### Headers to track:
- `x-rate-limit-limit` - Max requests in window
- `x-rate-limit-remaining` - Requests remaining
- `x-rate-limit-reset` - Unix timestamp of window reset

### Implementation:
Reuse existing `rate_limits` table and functions from `src/storage.ts`.

**Additional consideration:** Monthly tweet cap tracking for Basic tier (10K tweets/month).

## Testing Strategy

### File: `src/platforms/twitter-memory.ts`

```typescript
import type { TwitterMetaStore, TwitterTweetsStore, TwitterTweet, TweetMedia } from "../schema";
import type { Result } from "../utils";
import { createMemoryProviderState, simulateErrors, type MemoryProviderState, type MemoryProviderControls } from "./memory-base";
import type { TwitterFetchResult } from "./twitter";
import type { ProviderError } from "./types";

export type TwitterMemoryConfig = {
  userId?: string;
  username?: string;
  name?: string;
  tweets?: TwitterTweet[];
  media?: TweetMedia[];
};

export class TwitterMemoryProvider implements MemoryProviderControls {
  readonly platform = "twitter";
  private config: TwitterMemoryConfig;
  private state: MemoryProviderState;

  constructor(config: TwitterMemoryConfig = {}) {
    this.config = config;
    this.state = createMemoryProviderState();
  }

  async fetch(_token: string): Promise<Result<TwitterFetchResult, ProviderError>> {
    return simulateErrors(this.state, () => {
      const now = new Date().toISOString();
      const userId = this.config.userId ?? "123456789";
      const username = this.config.username ?? "testuser";

      return {
        meta: {
          id: userId,
          username,
          name: this.config.name ?? "Test User",
          created_at: new Date(Date.now() - 86400000 * 365).toISOString(),
          verified: false,
          verified_type: "none" as const,
          protected: false,
          public_metrics: {
            followers_count: 100,
            following_count: 50,
            tweet_count: this.config.tweets?.length ?? 0,
            listed_count: 1,
          },
          fetched_at: now,
        },
        tweets: {
          user_id: userId,
          username,
          tweets: this.config.tweets ?? [],
          media: this.config.media ?? [],
          total_tweets: this.config.tweets?.length ?? 0,
          fetched_at: now,
        },
      };
    });
  }

  setTweets(tweets: TwitterTweet[]): void {
    this.config.tweets = tweets;
  }

  setMedia(media: TweetMedia[]): void {
    this.config.media = media;
  }

  getCallCount = () => this.state.call_count;
  reset = () => { this.state.call_count = 0; };
  setSimulateRateLimit = (value: boolean) => { this.state.simulate_rate_limit = value; };
  setSimulateAuthExpired = (value: boolean) => { this.state.simulate_auth_expired = value; };
}
```

### Test fixtures in `__tests__/integration/fixtures.ts`

```typescript
export const makeTwitterTweet = (overrides: Partial<TwitterTweet> = {}): TwitterTweet => ({
  id: uuid().slice(0, 19).replace(/-/g, ''),
  text: "This is a test tweet",
  created_at: new Date().toISOString(),
  author_id: "123456789",
  public_metrics: {
    retweet_count: 5,
    reply_count: 2,
    like_count: 42,
    quote_count: 1,
  },
  possibly_sensitive: false,
  ...overrides,
});

export const TWITTER_FIXTURES = {
  singleTweet: () => [makeTwitterTweet()],
  multipleTweets: (count = 3) => Array.from({ length: count }, (_, i) =>
    makeTwitterTweet({ 
      text: `Tweet ${i + 1}`,
      public_metrics: {
        retweet_count: i * 2,
        reply_count: i,
        like_count: i * 10,
        quote_count: 0,
      },
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
    })
  ),
  withRetweet: () => [
    makeTwitterTweet({
      text: "RT @other: Original tweet content",
      referenced_tweets: [{ type: "retweeted", id: "987654321" }],
    }),
  ],
  withReply: () => [
    makeTwitterTweet({
      text: "@someone This is a reply",
      in_reply_to_user_id: "111222333",
      referenced_tweets: [{ type: "replied_to", id: "444555666" }],
    }),
  ],
  withMedia: () => [
    makeTwitterTweet({
      attachments: { media_keys: ["media_1"] },
    }),
  ],
  empty: () => [],
};
```

## Task Breakdown

### Phase 1: Schema & Storage (can be parallelized)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 1.1 Create `src/schema/twitter-tweets.ts` | ~80 | None |
| 1.2 Create `src/schema/twitter-meta.ts` | ~35 | None |
| 1.3 Update `src/schema/index.ts` exports | ~5 | 1.1, 1.2 |
| 1.4 Update `src/schema/timeline.ts` Platform enum | ~5 | None |
| 1.5 Add storage helpers to `src/storage.ts` | ~50 | 1.1, 1.2 |

**Total Phase 1:** ~175 LOC

### Phase 2: Provider & Cron (sequential)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 2.1 Create `src/platforms/twitter.ts` | ~250 | Phase 1 |
| 2.2 Create `src/cron-twitter.ts` | ~100 | 2.1 |
| 2.3 Create `src/timeline-twitter.ts` | ~80 | Phase 1 |
| 2.4 Update `src/cron.ts` to handle Twitter | ~30 | 2.2, 2.3 |

**Total Phase 2:** ~460 LOC

### Phase 3: API & Frontend (can be parallelized after Phase 2)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 3.1 Update `src/routes.ts` with Twitter platform | ~5 | Phase 2 |
| 3.2 Update `src/schema/database.ts` Platform type | ~5 | None |
| 3.3 Create `TwitterSettings.tsx` component | ~80 | Phase 2 |
| 3.4 Update `src/bindings.ts` | ~5 | None |

**Total Phase 3:** ~95 LOC

### Phase 4: Testing (after Phase 2)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 4.1 Create `src/platforms/twitter-memory.ts` | ~60 | Phase 2 |
| 4.2 Add Twitter fixtures to `fixtures.ts` | ~50 | Phase 1 |
| 4.3 Add Twitter tests to `cron-workflow.test.ts` | ~80 | 4.1, 4.2 |
| 4.4 Create `__tests__/unit/twitter-normalize.test.ts` | ~50 | 2.3 |

**Total Phase 4:** ~240 LOC

### Total Estimated LOC: ~970

## Critical Approval Points

1. **API Tier Selection** - Requires budget approval:
   - Free tier is insufficient (no timeline read)
   - Basic tier ($100/month) is minimum required
   - Consider if this cost is justified by user demand

2. **OAuth 2.0 vs 1.0a** - This plan uses OAuth 2.0 with PKCE
   - OAuth 1.0a is also supported if needed for app-only contexts
   - Confirm frontend can handle PKCE flow

3. **Twitter Developer Portal Setup** - Requires:
   - Developer account approval
   - App creation in developer portal
   - OAuth 2.0 callback URL registration

## Limitations

1. **API Cost** - Minimum $100/month for Basic tier access
2. **Historical Limit** - Max 3,200 tweets via user timeline endpoint
3. **Rate Limits** - 1,500 timeline requests per 15 minutes on Basic tier
4. **Monthly Cap** - 10,000 tweet reads per month on Basic tier
5. **No DMs** - Only public tweets accessible
6. **No Likes Feed** - Can't access what user has liked (would require separate endpoint)
7. **Token Expiry** - Access tokens expire in 2 hours, refresh tokens in 6 months
8. **Protected Accounts** - Cannot fetch tweets from protected accounts unless following

## Alternative: Twitter Archive Import

For users who don't want to pay for API access or want historical data beyond 3,200 tweets:

```typescript
// Future enhancement: Import from Twitter data archive
// Users can request their archive from Twitter settings
// Archive contains all tweets in JSON format

type TwitterArchiveImporter = {
  parseArchive(zipFile: File): Promise<TwitterTweet[]>;
  importToStore(tweets: TwitterTweet[], accountId: string): Promise<void>;
};
```

This would be a separate feature allowing users to upload their Twitter data archive ZIP file for processing, bypassing API limits entirely.
