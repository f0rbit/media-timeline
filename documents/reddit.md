# Reddit Integration Implementation Plan

## Overview

Add Reddit integration to the media-timeline application to aggregate a user's Reddit posts and comments into the unified timeline. The integration will follow the established GitHub multi-store architecture pattern, storing posts and comments in separate corpus stores with proper deduplication and incremental updates.

## API Client Approach

### Direct Fetch to Reddit OAuth API

For this Cloudflare Workers application, we use **direct `fetch` calls** to Reddit's OAuth API at `oauth.reddit.com`. This is the most appropriate approach for external applications that need to fetch user data via OAuth.

**Why direct fetch:**
- Works natively in Cloudflare Workers (no Node.js dependencies)
- Full control over request handling and error responses
- Lightweight with no external dependencies
- Easy to implement rate limiting and retry logic

**Alternatives considered and rejected:**
- `snoowrap`: Popular Reddit API wrapper, but uses Node.js internals (`https` module) that don't work in Cloudflare Workers
- `@devvit/public-api` (Devvit RedditAPIClient): Specifically designed for building Reddit apps that run *inside* Reddit (custom posts, bots, mod tools). **NOT suitable for external applications** like ours that fetch user data via OAuth

### Reddit OAuth API Endpoints

The following endpoints are used (documented at https://www.reddit.com/dev/api):

| Endpoint | Purpose |
|----------|---------|
| `https://oauth.reddit.com/api/v1/me` | Get authenticated user info |
| `https://oauth.reddit.com/user/{username}/submitted` | Get user's posts |
| `https://oauth.reddit.com/user/{username}/comments` | Get user's comments |

**OAuth Scopes Required:**
- `identity` - Read username and user info
- `history` - Read user's post/comment history
- `read` - Read posts and comments

**Rate Limits:**
- 60 requests per minute for OAuth apps
- Tracked via `X-Ratelimit-*` response headers

**Example usage:**
```typescript
// Direct Reddit API calls
const response = await fetch(`https://oauth.reddit.com/user/${username}/submitted?limit=100`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'User-Agent': 'media-timeline/2.0.0',
  },
});
```

## Authentication Flow

Reddit uses OAuth 2.0 with the following flow:

### OAuth Scopes Required
- `identity` - Read username
- `history` - Read user's post/comment history
- `read` - Read posts and comments

### Token Types
1. **Access Token** - Short-lived (1 hour), used for API calls
2. **Refresh Token** - Long-lived, used to get new access tokens

### Flow
```
1. User initiates connection from frontend
2. Redirect to: https://www.reddit.com/api/v1/authorize
   - client_id
   - response_type=code
   - state (CSRF token)
   - redirect_uri
   - duration=permanent
   - scope=identity,history,read
3. User approves on Reddit
4. Reddit redirects back with authorization code
5. Backend exchanges code for tokens:
   POST https://www.reddit.com/api/v1/access_token
   - grant_type=authorization_code
   - code={authorization_code}
   - redirect_uri={redirect_uri}
6. Store encrypted tokens in database
7. Use refresh token to get new access tokens when expired
```

### Token Refresh
```typescript
// POST https://www.reddit.com/api/v1/access_token
// Content-Type: application/x-www-form-urlencoded
// Authorization: Basic base64(client_id:client_secret)
// Body: grant_type=refresh_token&refresh_token={refresh_token}
```

## Schema Definitions

### File: `src/schema/reddit-posts.ts`

```typescript
import { z } from "zod";

// Individual Reddit post (submission)
export const RedditPostSchema = z.object({
  id: z.string(),
  name: z.string(), // fullname like "t3_abc123"
  title: z.string(),
  selftext: z.string().default(""),
  url: z.string().url(),
  permalink: z.string(),
  subreddit: z.string(),
  subreddit_prefixed: z.string(),
  author: z.string(),
  created_utc: z.number(),
  score: z.number(),
  upvote_ratio: z.number().optional(),
  num_comments: z.number(),
  is_self: z.boolean(), // true = text post, false = link post
  is_video: z.boolean().default(false),
  thumbnail: z.string().optional(),
  link_flair_text: z.string().nullable().optional(),
  over_18: z.boolean().default(false),
  spoiler: z.boolean().default(false),
  stickied: z.boolean().default(false),
  locked: z.boolean().default(false),
  archived: z.boolean().default(false),
});

// Store for posts per user
export const RedditPostsStoreSchema = z.object({
  username: z.string(),
  posts: z.array(RedditPostSchema),
  total_posts: z.number(),
  fetched_at: z.string().datetime(),
});

export type RedditPost = z.infer<typeof RedditPostSchema>;
export type RedditPostsStore = z.infer<typeof RedditPostsStoreSchema>;
```

### File: `src/schema/reddit-comments.ts`

```typescript
import { z } from "zod";

// Individual Reddit comment
export const RedditCommentSchema = z.object({
  id: z.string(),
  name: z.string(), // fullname like "t1_abc123"
  body: z.string(),
  body_html: z.string().optional(),
  permalink: z.string(),
  link_id: z.string(), // parent post fullname
  link_title: z.string(),
  link_permalink: z.string(),
  subreddit: z.string(),
  subreddit_prefixed: z.string(),
  author: z.string(),
  created_utc: z.number(),
  score: z.number(),
  is_submitter: z.boolean().default(false), // is OP
  stickied: z.boolean().default(false),
  edited: z.union([z.boolean(), z.number()]).default(false),
  parent_id: z.string(), // parent comment or post
});

// Store for comments per user
export const RedditCommentsStoreSchema = z.object({
  username: z.string(),
  comments: z.array(RedditCommentSchema),
  total_comments: z.number(),
  fetched_at: z.string().datetime(),
});

export type RedditComment = z.infer<typeof RedditCommentSchema>;
export type RedditCommentsStore = z.infer<typeof RedditCommentsStoreSchema>;
```

### File: `src/schema/reddit-meta.ts`

```typescript
import { z } from "zod";

// User metadata
export const RedditMetaStoreSchema = z.object({
  username: z.string(),
  user_id: z.string(),
  icon_img: z.string().url().optional(),
  total_karma: z.number(),
  link_karma: z.number(),
  comment_karma: z.number(),
  created_utc: z.number(),
  is_gold: z.boolean().default(false),
  subreddits_active: z.array(z.string()).default([]), // unique subreddits user posts in
  fetched_at: z.string().datetime(),
});

export type RedditMetaStore = z.infer<typeof RedditMetaStoreSchema>;
```

### Update `src/schema/timeline.ts`

```typescript
// Add to PlatformSchema:
export const PlatformSchema = z.enum(["github", "bluesky", "youtube", "devpad", "reddit"]);

// Add to TimelineTypeSchema:
export const TimelineTypeSchema = z.enum(["commit", "post", "video", "task", "pull_request", "comment"]);

// Reddit-specific post payload (extends PostPayloadSchema pattern)
export const RedditPostPayloadSchema = z.object({
  type: z.literal("post"),
  content: z.string(), // selftext for text posts, url for link posts
  author_handle: z.string(),
  subreddit: z.string(),
  score: z.number(),
  num_comments: z.number(),
  is_self: z.boolean(),
  has_media: z.boolean().default(false),
  is_nsfw: z.boolean().default(false),
  flair: z.string().nullable().optional(),
  // Following existing PostPayload fields
  reply_count: z.number().default(0),
  repost_count: z.number().default(0), // crosspost count
  like_count: z.number().default(0), // score
});

// Comment payload
export const CommentPayloadSchema = z.object({
  type: z.literal("comment"),
  content: z.string(),
  author_handle: z.string(),
  parent_title: z.string(), // title of the post being commented on
  parent_url: z.string(),
  subreddit: z.string(),
  score: z.number(),
  is_op: z.boolean().default(false),
});
```

### Update `src/schema/index.ts`

```typescript
// Add exports
export * from "./reddit-posts";
export * from "./reddit-comments";
export * from "./reddit-meta";
```

## Storage Pattern

Following the GitHub multi-store pattern:

```
reddit/{account_id}/meta          - User metadata
reddit/{account_id}/posts         - User's submissions
reddit/{account_id}/comments      - User's comments
```

### File: `src/storage.ts` additions

```typescript
// Store ID types
export type RedditMetaStoreId = `reddit/${string}/meta`;
export type RedditPostsStoreId = `reddit/${string}/posts`;
export type RedditCommentsStoreId = `reddit/${string}/comments`;

// Store ID helpers
export const redditMetaStoreId = (accountId: string): RedditMetaStoreId => 
  `reddit/${accountId}/meta`;

export const redditPostsStoreId = (accountId: string): RedditPostsStoreId => 
  `reddit/${accountId}/posts`;

export const redditCommentsStoreId = (accountId: string): RedditCommentsStoreId => 
  `reddit/${accountId}/comments`;

// Store creators
export function createRedditMetaStore(backend: Backend, accountId: string): Result<...> { ... }
export function createRedditPostsStore(backend: Backend, accountId: string): Result<...> { ... }
export function createRedditCommentsStore(backend: Backend, accountId: string): Result<...> { ... }
```

## Provider Class

### File: `src/platforms/reddit.ts`

```typescript
import type { Result } from "../utils";
import { ok, err, tryCatchAsync } from "../utils";
import type { ProviderError } from "./types";
import type { 
  RedditMetaStore, 
  RedditPostsStore, 
  RedditCommentsStore,
  RedditPost,
  RedditComment 
} from "../schema";

export type RedditProviderConfig = {
  maxPosts: number;
  maxComments: number;
  userAgent: string;
};

const DEFAULT_CONFIG: RedditProviderConfig = {
  maxPosts: 1000,
  maxComments: 1000,
  userAgent: "media-timeline/2.0.0",
};

export type RedditFetchResult = {
  meta: RedditMetaStore;
  posts: RedditPostsStore;
  comments: RedditCommentsStore;
};

export class RedditProvider {
  readonly platform = "reddit";
  private config: RedditProviderConfig;

  constructor(config: Partial<RedditProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async fetch(token: string): Promise<Result<RedditFetchResult, ProviderError>> {
    try {
      // 1. Fetch user info first
      const userResult = await this.fetchUser(token);
      if (!userResult.ok) return userResult;
      const { username, meta } = userResult.value;

      // 2. Fetch posts and comments in parallel
      const [postsResult, commentsResult] = await Promise.all([
        this.fetchPosts(token, username),
        this.fetchComments(token, username),
      ]);

      if (!postsResult.ok) return postsResult;
      if (!commentsResult.ok) return commentsResult;

      // 3. Update meta with active subreddits
      const subreddits = new Set<string>();
      for (const post of postsResult.value) {
        subreddits.add(post.subreddit);
      }
      for (const comment of commentsResult.value) {
        subreddits.add(comment.subreddit);
      }

      return ok({
        meta: {
          ...meta,
          subreddits_active: Array.from(subreddits),
        },
        posts: {
          username,
          posts: postsResult.value,
          total_posts: postsResult.value.length,
          fetched_at: new Date().toISOString(),
        },
        comments: {
          username,
          comments: commentsResult.value,
          total_comments: commentsResult.value.length,
          fetched_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      return err(this.mapError(error));
    }
  }

  private async fetchUser(token: string): Promise<Result<{ username: string; meta: RedditMetaStore }, ProviderError>> {
    const response = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: this.headers(token),
    });

    if (!response.ok) {
      return err(this.handleResponse(response));
    }

    const data = await response.json() as Record<string, unknown>;
    const username = data.name as string;

    return ok({
      username,
      meta: {
        username,
        user_id: data.id as string,
        icon_img: data.icon_img as string | undefined,
        total_karma: data.total_karma as number,
        link_karma: data.link_karma as number,
        comment_karma: data.comment_karma as number,
        created_utc: data.created_utc as number,
        is_gold: data.is_gold as boolean,
        subreddits_active: [],
        fetched_at: new Date().toISOString(),
      },
    });
  }

  private async fetchPosts(token: string, username: string): Promise<Result<RedditPost[], ProviderError>> {
    return this.fetchPaginated(
      token,
      `https://oauth.reddit.com/user/${username}/submitted`,
      this.config.maxPosts,
      this.parsePost
    );
  }

  private async fetchComments(token: string, username: string): Promise<Result<RedditComment[], ProviderError>> {
    return this.fetchPaginated(
      token,
      `https://oauth.reddit.com/user/${username}/comments`,
      this.config.maxComments,
      this.parseComment
    );
  }

  private async fetchPaginated<T>(
    token: string,
    baseUrl: string,
    maxItems: number,
    parser: (item: Record<string, unknown>) => T
  ): Promise<Result<T[], ProviderError>> {
    const items: T[] = [];
    let after: string | null = null;

    while (items.length < maxItems) {
      const url = new URL(baseUrl);
      url.searchParams.set("limit", "100");
      url.searchParams.set("raw_json", "1");
      if (after) url.searchParams.set("after", after);

      const response = await fetch(url.toString(), {
        headers: this.headers(token),
      });

      if (!response.ok) {
        return err(this.handleResponse(response));
      }

      const data = await response.json() as { data: { children: Array<{ data: Record<string, unknown> }>, after: string | null } };
      const children = data.data.children;

      if (children.length === 0) break;

      for (const child of children) {
        items.push(parser(child.data));
      }

      after = data.data.after;
      if (!after) break;
    }

    return ok(items.slice(0, maxItems));
  }

  private parsePost(data: Record<string, unknown>): RedditPost {
    return {
      id: data.id as string,
      name: data.name as string,
      title: data.title as string,
      selftext: (data.selftext as string) ?? "",
      url: data.url as string,
      permalink: data.permalink as string,
      subreddit: data.subreddit as string,
      subreddit_prefixed: data.subreddit_name_prefixed as string,
      author: data.author as string,
      created_utc: data.created_utc as number,
      score: data.score as number,
      upvote_ratio: data.upvote_ratio as number | undefined,
      num_comments: data.num_comments as number,
      is_self: data.is_self as boolean,
      is_video: (data.is_video as boolean) ?? false,
      thumbnail: data.thumbnail as string | undefined,
      link_flair_text: data.link_flair_text as string | null | undefined,
      over_18: (data.over_18 as boolean) ?? false,
      spoiler: (data.spoiler as boolean) ?? false,
      stickied: (data.stickied as boolean) ?? false,
      locked: (data.locked as boolean) ?? false,
      archived: (data.archived as boolean) ?? false,
    };
  }

  private parseComment(data: Record<string, unknown>): RedditComment {
    return {
      id: data.id as string,
      name: data.name as string,
      body: data.body as string,
      body_html: data.body_html as string | undefined,
      permalink: data.permalink as string,
      link_id: data.link_id as string,
      link_title: data.link_title as string,
      link_permalink: data.link_permalink as string,
      subreddit: data.subreddit as string,
      subreddit_prefixed: data.subreddit_name_prefixed as string,
      author: data.author as string,
      created_utc: data.created_utc as number,
      score: data.score as number,
      is_submitter: (data.is_submitter as boolean) ?? false,
      stickied: (data.stickied as boolean) ?? false,
      edited: (data.edited as boolean | number) ?? false,
      parent_id: data.parent_id as string,
    };
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "User-Agent": this.config.userAgent,
    };
  }

  private handleResponse(response: Response): ProviderError {
    if (response.status === 401) {
      return { kind: "auth_expired", message: "Reddit token expired or invalid" };
    }
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10);
      return { kind: "rate_limited", retry_after: retryAfter };
    }
    return { kind: "api_error", status: response.status, message: response.statusText };
  }

  private mapError(error: unknown): ProviderError {
    if (error instanceof Error) {
      return { kind: "network_error", cause: error };
    }
    return { kind: "network_error", cause: new Error(String(error)) };
  }
}
```

## Cron Processing

### File: `src/cron-reddit.ts`

```typescript
import type { Backend } from "@f0rbit/corpus";
import type { RedditFetchResult } from "./platforms/reddit";
import { createRedditMetaStore, createRedditPostsStore, createRedditCommentsStore } from "./storage";
import { ok, err, to_nullable, type Result } from "./utils";
import type { RedditPostsStore, RedditCommentsStore } from "./schema";
import type { ProviderError } from "./platforms/types";

export type RedditProcessResult = {
  account_id: string;
  meta_version: string;
  posts_version: string;
  comments_version: string;
  stats: {
    total_posts: number;
    total_comments: number;
    new_posts: number;
    new_comments: number;
  };
};

type ProcessError = 
  | { kind: "fetch_failed"; message: string }
  | { kind: "store_failed"; store_id: string };

type MergeResult<T> = { merged: T; newCount: number };

const mergePosts = (
  existing: RedditPostsStore | null, 
  incoming: RedditPostsStore
): MergeResult<RedditPostsStore> => {
  if (!existing) {
    return { merged: incoming, newCount: incoming.posts.length };
  }

  const existingIds = new Set(existing.posts.map(p => p.id));
  const newPosts = incoming.posts.filter(p => !existingIds.has(p.id));

  // Also update scores/comments for existing posts
  const updatedExisting = existing.posts.map(existingPost => {
    const incomingPost = incoming.posts.find(p => p.id === existingPost.id);
    return incomingPost ?? existingPost;
  });

  return {
    merged: {
      username: incoming.username,
      posts: [...updatedExisting, ...newPosts],
      total_posts: updatedExisting.length + newPosts.length,
      fetched_at: incoming.fetched_at,
    },
    newCount: newPosts.length,
  };
};

const mergeComments = (
  existing: RedditCommentsStore | null,
  incoming: RedditCommentsStore
): MergeResult<RedditCommentsStore> => {
  if (!existing) {
    return { merged: incoming, newCount: incoming.comments.length };
  }

  const existingIds = new Set(existing.comments.map(c => c.id));
  const newComments = incoming.comments.filter(c => !existingIds.has(c.id));

  const updatedExisting = existing.comments.map(existingComment => {
    const incomingComment = incoming.comments.find(c => c.id === existingComment.id);
    return incomingComment ?? existingComment;
  });

  return {
    merged: {
      username: incoming.username,
      comments: [...updatedExisting, ...newComments],
      total_comments: updatedExisting.length + newComments.length,
      fetched_at: incoming.fetched_at,
    },
    newCount: newComments.length,
  };
};

type RedditProvider = {
  fetch(token: string): Promise<Result<RedditFetchResult, ProviderError>>;
};

export async function processRedditAccount(
  backend: Backend,
  accountId: string,
  token: string,
  provider: RedditProvider
): Promise<Result<RedditProcessResult, ProcessError>> {
  console.log(`[processRedditAccount] Starting for account: ${accountId}`);

  const fetchResult = await provider.fetch(token);
  if (!fetchResult.ok) {
    return err({
      kind: "fetch_failed",
      message: `Reddit fetch failed: ${fetchResult.error.kind}`,
    });
  }

  const { meta, posts, comments } = fetchResult.value;

  // Save meta
  let metaVersion = "";
  const metaStoreResult = createRedditMetaStore(backend, accountId);
  if (metaStoreResult.ok) {
    const putResult = await metaStoreResult.value.store.put(meta);
    if (putResult.ok) {
      metaVersion = putResult.value.version;
    }
  }

  // Save posts with merge
  let postsVersion = "";
  let newPosts = 0;
  let totalPosts = 0;
  const postsStoreResult = createRedditPostsStore(backend, accountId);
  if (postsStoreResult.ok) {
    const store = postsStoreResult.value.store;
    const existingResult = await store.get_latest();
    const existing = to_nullable(existingResult)?.data ?? null;
    const { merged, newCount } = mergePosts(existing, posts);
    newPosts = newCount;
    totalPosts = merged.total_posts;

    const putResult = await store.put(merged);
    if (putResult.ok) {
      postsVersion = putResult.value.version;
    }
  }

  // Save comments with merge
  let commentsVersion = "";
  let newComments = 0;
  let totalComments = 0;
  const commentsStoreResult = createRedditCommentsStore(backend, accountId);
  if (commentsStoreResult.ok) {
    const store = commentsStoreResult.value.store;
    const existingResult = await store.get_latest();
    const existing = to_nullable(existingResult)?.data ?? null;
    const { merged, newCount } = mergeComments(existing, comments);
    newComments = newCount;
    totalComments = merged.total_comments;

    const putResult = await store.put(merged);
    if (putResult.ok) {
      commentsVersion = putResult.value.version;
    }
  }

  console.log(`[processRedditAccount] Completed:`, {
    posts: totalPosts,
    comments: totalComments,
    newPosts,
    newComments,
  });

  return ok({
    account_id: accountId,
    meta_version: metaVersion,
    posts_version: postsVersion,
    comments_version: commentsVersion,
    stats: {
      total_posts: totalPosts,
      total_comments: totalComments,
      new_posts: newPosts,
      new_comments: newComments,
    },
  });
}
```

## Timeline Normalization

### File: `src/timeline-reddit.ts`

```typescript
import type { Backend } from "@f0rbit/corpus";
import { createRedditPostsStore, createRedditCommentsStore } from "./storage";
import type { RedditPost, RedditComment, TimelineItem } from "./schema";

type RedditTimelineData = {
  posts: RedditPost[];
  comments: RedditComment[];
};

export async function loadRedditDataForAccount(
  backend: Backend,
  accountId: string
): Promise<RedditTimelineData> {
  const posts: RedditPost[] = [];
  const comments: RedditComment[] = [];

  const postsStoreResult = createRedditPostsStore(backend, accountId);
  if (postsStoreResult.ok) {
    const snapshotResult = await postsStoreResult.value.store.get_latest();
    if (snapshotResult.ok && snapshotResult.value) {
      posts.push(...snapshotResult.value.data.posts);
    }
  }

  const commentsStoreResult = createRedditCommentsStore(backend, accountId);
  if (commentsStoreResult.ok) {
    const snapshotResult = await commentsStoreResult.value.store.get_latest();
    if (snapshotResult.ok && snapshotResult.value) {
      comments.push(...snapshotResult.value.data.comments);
    }
  }

  console.log(`[loadRedditDataForAccount] Loaded: ${posts.length} posts, ${comments.length} comments`);
  return { posts, comments };
}

const truncateContent = (content: string, maxLength = 200): string => {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength - 3)}...`;
};

export function normalizeReddit(data: RedditTimelineData, username: string): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Normalize posts
  for (const post of data.posts) {
    const timestamp = new Date(post.created_utc * 1000).toISOString();
    const content = post.is_self ? post.selftext : post.url;
    const hasMedia = post.is_video || 
      (!post.is_self && (post.url.includes('imgur') || post.url.includes('i.redd.it')));

    items.push({
      id: `reddit:post:${post.id}`,
      platform: "reddit",
      type: "post",
      timestamp,
      title: post.title,
      url: `https://reddit.com${post.permalink}`,
      payload: {
        type: "post",
        content: truncateContent(content),
        author_handle: post.author,
        subreddit: post.subreddit,
        score: post.score,
        num_comments: post.num_comments,
        is_self: post.is_self,
        has_media: hasMedia,
        is_nsfw: post.over_18,
        flair: post.link_flair_text,
        reply_count: post.num_comments,
        repost_count: 0, // Reddit doesn't have native repost concept like crossposts
        like_count: post.score,
      },
    });
  }

  // Normalize comments
  for (const comment of data.comments) {
    const timestamp = new Date(comment.created_utc * 1000).toISOString();

    items.push({
      id: `reddit:comment:${comment.id}`,
      platform: "reddit",
      type: "comment",
      timestamp,
      title: truncateContent(comment.body, 72),
      url: `https://reddit.com${comment.permalink}`,
      payload: {
        type: "comment",
        content: comment.body,
        author_handle: comment.author,
        parent_title: comment.link_title,
        parent_url: `https://reddit.com${comment.link_permalink}`,
        subreddit: comment.subreddit,
        score: comment.score,
        is_op: comment.is_submitter,
      },
    });
  }

  console.log(`[normalizeReddit] Generated ${items.length} timeline items`);
  return items;
}

export type { RedditTimelineData };
```

## Route Updates

### Updates to `src/routes.ts`

```typescript
// Update CreateConnectionBodySchema
const CreateConnectionBodySchema = z.object({
  platform: z.enum(["github", "bluesky", "youtube", "devpad", "reddit"]),
  // ... rest unchanged
});

// Add Reddit-specific endpoints (optional, for subreddit filtering)
connectionRoutes.get("/:account_id/subreddits", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");

  // Verify access
  const account = await ctx.db
    .select({ id: accounts.id, platform: accounts.platform })
    .from(accounts)
    .innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
    .where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
    .get();

  if (!account || account.platform !== "reddit") {
    return c.json({ error: "Not found" }, 404);
  }

  const metaStoreResult = createRedditMetaStore(ctx.backend, accountId);
  if (!metaStoreResult.ok) {
    return c.json({ subreddits: [] });
  }

  const latest = await metaStoreResult.value.store.get_latest();
  if (!latest.ok) {
    return c.json({ subreddits: [] });
  }

  return c.json({ 
    subreddits: latest.value.data.subreddits_active,
    username: latest.value.data.username,
  });
});
```

## Frontend Components

### File: `apps/website/src/components/solid/PlatformSettings/RedditSettings.tsx`

```tsx
import { createResource, createSignal, For, Show } from "solid-js";
import { connections } from "@/utils/api-client";

type Props = {
  accountId: string;
  settings: { 
    hidden_subreddits?: string[];
    hide_comments?: boolean;
    hide_nsfw?: boolean;
  } | null;
  onUpdate: () => void;
};

export default function RedditSettings(props: Props) {
  const [updating, setUpdating] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  const [subreddits] = createResource(async () => {
    const result = await connections.getSubreddits(props.accountId);
    if (!result.ok) return [];
    return result.data.subreddits;
  });

  const hiddenSubreddits = () => new Set(props.settings?.hidden_subreddits ?? []);
  const hideComments = () => props.settings?.hide_comments ?? false;
  const hideNsfw = () => props.settings?.hide_nsfw ?? true;

  const toggleSubreddit = async (subreddit: string) => {
    setUpdating(subreddit);
    const hidden = new Set(hiddenSubreddits());

    if (hidden.has(subreddit)) {
      hidden.delete(subreddit);
    } else {
      hidden.add(subreddit);
    }

    await connections.updateSettings(props.accountId, {
      hidden_subreddits: Array.from(hidden),
    });

    setUpdating(null);
    props.onUpdate();
  };

  const toggleHideComments = async () => {
    await connections.updateSettings(props.accountId, {
      hide_comments: !hideComments(),
    });
    props.onUpdate();
  };

  const toggleHideNsfw = async () => {
    await connections.updateSettings(props.accountId, {
      hide_nsfw: !hideNsfw(),
    });
    props.onUpdate();
  };

  return (
    <div class="settings-section">
      <button type="button" class="settings-header" onClick={() => setExpanded(!expanded())}>
        <ChevronIcon expanded={expanded()} />
        <h6 class="settings-title">Reddit Settings</h6>
      </button>

      <Show when={expanded()}>
        <div class="settings-content">
          {/* Global toggles */}
          <div class="setting-row">
            <label>
              <input 
                type="checkbox" 
                checked={hideComments()} 
                onChange={toggleHideComments} 
              />
              <span>Hide comments (show posts only)</span>
            </label>
          </div>
          <div class="setting-row">
            <label>
              <input 
                type="checkbox" 
                checked={hideNsfw()} 
                onChange={toggleHideNsfw} 
              />
              <span>Hide NSFW content</span>
            </label>
          </div>

          {/* Subreddit visibility */}
          <h6 class="subsection-title">Subreddit Visibility</h6>
          <Show when={subreddits.loading}>
            <p class="muted text-sm">Loading subreddits...</p>
          </Show>
          <Show when={subreddits() && subreddits()!.length > 0}>
            <div class="subreddit-list">
              <For each={subreddits()}>
                {subreddit => {
                  const isHidden = () => hiddenSubreddits().has(subreddit);
                  const isUpdating = () => updating() === subreddit;
                  return (
                    <label class={`subreddit-item ${isHidden() ? "hidden" : ""}`}>
                      <input 
                        type="checkbox" 
                        checked={!isHidden()} 
                        onChange={() => toggleSubreddit(subreddit)} 
                        disabled={isUpdating()} 
                      />
                      <span class="mono text-sm">r/{subreddit}</span>
                      <Show when={isHidden()}>
                        <span class="muted text-xs">(hidden)</span>
                      </Show>
                    </label>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
```

### Update `apps/website/src/utils/api-client.ts`

```typescript
// Add to connections object
getSubreddits: async (accountId: string) => {
  return fetchApi<{ subreddits: string[]; username: string }>(
    `/api/connections/${accountId}/subreddits`
  );
},
```

## Database Changes

### Update `src/schema/database.ts`

```typescript
// Update Platform type
export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit";
```

No new tables required - uses existing `accounts`, `account_members`, `account_settings`, and `rate_limits` tables.

## Environment Variables

Add to Cloudflare Workers secrets:

```bash
wrangler secret put REDDIT_CLIENT_ID
wrangler secret put REDDIT_CLIENT_SECRET
```

### Update `src/bindings.ts`

```typescript
export type Bindings = {
  // ... existing bindings
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
};
```

## Rate Limiting

Reddit API limits:
- **OAuth apps:** 60 requests per minute
- **Per-user rate limit:** Tracked in `X-Ratelimit-*` headers

### Headers to track:
- `X-Ratelimit-Remaining` - Requests remaining
- `X-Ratelimit-Reset` - Seconds until reset
- `X-Ratelimit-Used` - Requests used in current period

### Implementation:
Reuse existing `rate_limits` table and `updateOnSuccess`/`updateOnFailure` functions from `src/storage.ts`.

## Testing Strategy

### File: `src/platforms/reddit-memory.ts`

```typescript
import type { RedditMetaStore, RedditPostsStore, RedditCommentsStore } from "../schema";
import type { Result } from "../utils";
import { createMemoryProviderState, simulateErrors, type MemoryProviderState, type MemoryProviderControls } from "./memory-base";
import type { RedditFetchResult } from "./reddit";
import type { ProviderError } from "./types";

export type RedditMemoryConfig = {
  username?: string;
  meta?: Partial<RedditMetaStore>;
  posts?: RedditPostsStore["posts"];
  comments?: RedditCommentsStore["comments"];
};

export class RedditMemoryProvider implements MemoryProviderControls {
  readonly platform = "reddit";
  private config: RedditMemoryConfig;
  private state: MemoryProviderState;

  constructor(config: RedditMemoryConfig = {}) {
    this.config = config;
    this.state = createMemoryProviderState();
  }

  async fetch(_token: string): Promise<Result<RedditFetchResult, ProviderError>> {
    return simulateErrors(this.state, () => {
      const username = this.config.username ?? "test-user";
      const now = new Date().toISOString();

      return {
        meta: {
          username,
          user_id: "test-user-id",
          total_karma: 1000,
          link_karma: 500,
          comment_karma: 500,
          created_utc: Date.now() / 1000 - 86400 * 365,
          is_gold: false,
          subreddits_active: [],
          fetched_at: now,
          ...this.config.meta,
        },
        posts: {
          username,
          posts: this.config.posts ?? [],
          total_posts: this.config.posts?.length ?? 0,
          fetched_at: now,
        },
        comments: {
          username,
          comments: this.config.comments ?? [],
          total_comments: this.config.comments?.length ?? 0,
          fetched_at: now,
        },
      };
    });
  }

  setPosts(posts: RedditPostsStore["posts"]): void {
    this.config.posts = posts;
  }

  setComments(comments: RedditCommentsStore["comments"]): void {
    this.config.comments = comments;
  }

  getCallCount = () => this.state.call_count;
  reset = () => { this.state.call_count = 0; };
  setSimulateRateLimit = (value: boolean) => { this.state.simulate_rate_limit = value; };
  setSimulateAuthExpired = (value: boolean) => { this.state.simulate_auth_expired = value; };
}
```

### Test fixtures in `__tests__/integration/fixtures.ts`

```typescript
export const makeRedditPost = (overrides: Partial<RedditPost> = {}): RedditPost => ({
  id: uuid().slice(0, 7),
  name: `t3_${uuid().slice(0, 7)}`,
  title: "Test Reddit Post",
  selftext: "This is a test post",
  url: "https://reddit.com/r/test/...",
  permalink: "/r/test/comments/abc123/test_post/",
  subreddit: "test",
  subreddit_prefixed: "r/test",
  author: "testuser",
  created_utc: Date.now() / 1000,
  score: 42,
  num_comments: 5,
  is_self: true,
  is_video: false,
  over_18: false,
  spoiler: false,
  stickied: false,
  locked: false,
  archived: false,
  ...overrides,
});

export const makeRedditComment = (overrides: Partial<RedditComment> = {}): RedditComment => ({
  id: uuid().slice(0, 7),
  name: `t1_${uuid().slice(0, 7)}`,
  body: "This is a test comment",
  permalink: "/r/test/comments/abc123/test_post/def456/",
  link_id: "t3_abc123",
  link_title: "Parent Post Title",
  link_permalink: "/r/test/comments/abc123/test_post/",
  subreddit: "test",
  subreddit_prefixed: "r/test",
  author: "testuser",
  created_utc: Date.now() / 1000,
  score: 10,
  is_submitter: false,
  stickied: false,
  edited: false,
  parent_id: "t3_abc123",
  ...overrides,
});

export const REDDIT_FIXTURES = {
  singlePost: () => [makeRedditPost()],
  multiplePosts: (count = 3) => Array.from({ length: count }, (_, i) =>
    makeRedditPost({ 
      title: `Post ${i + 1}`,
      score: i * 10,
      created_utc: Date.now() / 1000 - i * 3600,
    })
  ),
  singleComment: () => [makeRedditComment()],
  multipleComments: (count = 3) => Array.from({ length: count }, (_, i) =>
    makeRedditComment({
      body: `Comment ${i + 1}`,
      score: i * 5,
    })
  ),
  empty: () => [],
};
```

## Task Breakdown

### Phase 1: Schema & Storage (can be parallelized)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 1.1 Create `src/schema/reddit-posts.ts` | ~40 | None |
| 1.2 Create `src/schema/reddit-comments.ts` | ~35 | None |
| 1.3 Create `src/schema/reddit-meta.ts` | ~25 | None |
| 1.4 Update `src/schema/index.ts` exports | ~5 | 1.1, 1.2, 1.3 |
| 1.5 Update `src/schema/timeline.ts` with Reddit types | ~30 | None |
| 1.6 Add storage helpers to `src/storage.ts` | ~60 | 1.1, 1.2, 1.3 |

**Total Phase 1:** ~195 LOC

### Phase 2: Provider & Cron (sequential)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 2.1 Create `src/platforms/reddit.ts` | ~200 | Phase 1 |
| 2.2 Create `src/cron-reddit.ts` | ~120 | 2.1 |
| 2.3 Create `src/timeline-reddit.ts` | ~80 | Phase 1 |
| 2.4 Update `src/cron.ts` to handle Reddit | ~30 | 2.2, 2.3 |

**Total Phase 2:** ~430 LOC

### Phase 3: API & Frontend (can be parallelized after Phase 2)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 3.1 Update `src/routes.ts` with Reddit endpoints | ~50 | Phase 2 |
| 3.2 Update `src/schema/database.ts` Platform type | ~5 | None |
| 3.3 Create `RedditSettings.tsx` component | ~100 | Phase 2 |
| 3.4 Update `api-client.ts` with Reddit methods | ~15 | 3.1 |
| 3.5 Update `src/bindings.ts` | ~5 | None |

**Total Phase 3:** ~175 LOC

### Phase 4: Testing (after Phase 2)
| Task | Est. LOC | Dependencies |
|------|----------|--------------|
| 4.1 Create `src/platforms/reddit-memory.ts` | ~70 | Phase 2 |
| 4.2 Add Reddit fixtures to `fixtures.ts` | ~60 | Phase 1 |
| 4.3 Add Reddit tests to `cron-workflow.test.ts` | ~100 | 4.1, 4.2 |
| 4.4 Create `__tests__/unit/reddit-normalize.test.ts` | ~60 | 2.3 |

**Total Phase 4:** ~290 LOC

### Total Estimated LOC: ~1,090

## Critical Approval Points

1. **Schema Design** - Before implementing, confirm:
   - Should comments be a separate timeline type or use existing "post" type?
   - Should we track crosspost information?
   - NSFW content handling policy

2. **OAuth Flow** - Needs frontend callback page implementation (not scoped here)

## Limitations

1. **No real-time updates** - Uses polling during cron, not Reddit's streaming API
2. **Historical limit** - Reddit API limits history to ~1000 items per type
3. **No private messages** - Only public posts/comments (would require additional scope)
4. **No saved posts** - Only user's own content
5. **Vote history** - Cannot access user's upvotes/downvotes
