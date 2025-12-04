# Media Timeline

A self-hosted service that aggregates your activity across multiple platforms (GitHub, Bluesky, YouTube, Devpad) into a unified, chronological timeline. Built with TypeScript, Cloudflare Workers, and a functional programming approach.

## Features

- **Multi-platform aggregation**: GitHub commits, Bluesky posts, YouTube videos, Devpad tasks
- **Intelligent grouping**: Commits to the same repository on the same day are grouped together
- **Versioned storage**: Full history of raw data and generated timelines with content-addressed deduplication
- **Multi-tenant**: Support for shared accounts across users with role-based access
- **Rate limit aware**: Circuit breaker pattern prevents hammering rate-limited APIs
- **Encrypted tokens**: Platform access tokens encrypted at rest with AES-GCM-256

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Cloudflare Worker                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   GitHub    │  │   Bluesky   │  │   YouTube   │  │   Devpad    │        │
│  │  Provider   │  │  Provider   │  │  Provider   │  │  Provider   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                                   ▼                                         │
│                          ┌───────────────┐                                  │
│                          │  Normalizers  │  Platform-specific → TimelineItem│
│                          └───────┬───────┘                                  │
│                                  │                                          │
│                                  ▼                                          │
│                          ┌───────────────┐                                  │
│                          │   Groupers    │  Commits grouped by repo/day    │
│                          └───────┬───────┘                                  │
│                                  │                                          │
│                                  ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         @f0rbit/corpus                                 │ │
│  │  Versioned, content-addressed storage with lineage tracking           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                    │                              │                         │
│                    ▼                              ▼                         │
│           ┌───────────────┐              ┌───────────────┐                 │
│           │  Cloudflare   │              │  Cloudflare   │                 │
│           │      D1       │              │      R2       │                 │
│           │  (metadata)   │              │    (data)     │                 │
│           └───────────────┘              └───────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
packages/
├── core/           # Business logic, Result pattern, utilities
│   ├── normalizer  # Platform data → TimelineItem conversion
│   ├── grouper     # Commit grouping, date grouping
│   ├── encryption  # AES-GCM-256 token encryption
│   ├── rate-limit  # Circuit breaker state machine
│   └── utils       # Result type, functional combinators
│
├── schema/         # Type definitions and validation
│   ├── timeline    # Zod schemas for timeline types
│   ├── platforms   # Platform-specific raw data schemas
│   └── database    # Drizzle ORM table definitions
│
├── providers/      # Platform API clients
│   ├── github      # GitHub Events API
│   ├── bluesky     # AT Protocol
│   ├── youtube     # YouTube Data API
│   ├── devpad      # Devpad API
│   └── memory/     # In-memory implementations for testing
│
└── worker/         # Cloudflare Worker
    ├── routes/     # Hono HTTP handlers
    ├── middleware/ # Authentication
    ├── cron        # Scheduled data fetching
    └── corpus      # Storage abstraction
```

## Types & Schema

### Core Domain Types

```typescript
// Supported platforms
type Platform = "github" | "bluesky" | "youtube" | "devpad";

// Unified timeline item
type TimelineItem = {
  id: string;                    // Unique identifier
  platform: Platform;
  type: "commit" | "post" | "video" | "task";
  timestamp: string;             // ISO 8601
  title: string;
  url?: string;
  payload: CommitPayload | PostPayload | VideoPayload | TaskPayload;
};

// Commits grouped by repository and day
type CommitGroup = {
  type: "commit_group";
  repo: string;
  date: string;                  // "YYYY-MM-DD"
  commits: TimelineItem[];
  latestTimestamp: string;
};

// Timeline organized by date
type DateGroup = {
  date: string;
  entries: Array<TimelineItem | CommitGroup>;
};
```

### Payload Types (Discriminated Union)

```typescript
type CommitPayload = {
  type: "commit";
  sha: string;
  message: string;
  repo: string;
};

type PostPayload = {
  type: "post";
  content: string;
  author_handle: string;
  like_count?: number;
  repost_count?: number;
};

type VideoPayload = {
  type: "video";
  channel_id: string;
  channel_title: string;
  thumbnail_url?: string;
};

type TaskPayload = {
  type: "task";
  status: "todo" | "in_progress" | "done" | "archived";
  priority?: "low" | "medium" | "high";
  project?: string;
};
```

### Database Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Platform accounts (tokens encrypted)
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,           -- "github" | "bluesky" | "youtube" | "devpad"
  platform_user_id TEXT,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  is_active INTEGER DEFAULT 1,
  last_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Many-to-many: users can share accounts
CREATE TABLE account_members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL,               -- "owner" | "member"
  created_at TEXT NOT NULL,
  UNIQUE(user_id, account_id)
);

-- API key authentication (SHA-256 hashed)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

-- Rate limit tracking with circuit breaker
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  remaining INTEGER,
  limit_total INTEGER,
  reset_at TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  circuit_open_until TEXT,
  updated_at TEXT NOT NULL
);
```

## Functional Approach

### The Result Pattern

All fallible operations return `Result<T, E>` instead of throwing exceptions:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Constructors
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### Combinators

Transform and chain Results without manual error checking:

```typescript
// Transform success value
mapResult(result, value => transform(value))

// Chain operations that can fail
flatMapResult(result, value => anotherOperation(value))

// Transform error type
mapErr(result, error => newError)

// Side effects without changing the result
tapResult(result, value => console.log(value))
tapErr(result, error => logError(error))

// Pattern match on result
matchResult(result, 
  value => handleSuccess(value),
  error => handleError(error)
)
```

### Pipeline Builders

Fluent API for chaining multiple operations:

```typescript
// Synchronous pipeline
const result = pipeResult(initialResult)
  .map(x => x + 1)
  .flatMap(x => validate(x))
  .mapErr(e => ({ ...e, context: "validation" }))
  .tap(x => console.log("Valid:", x))
  .result();

// Asynchronous pipeline
const result = await pipeResultAsync(fetchData())
  .mapAsync(data => processAsync(data))
  .flatMapAsync(data => saveAsync(data))
  .tapErr(e => logError(e))
  .tapAsync(data => notifyAsync(data))
  .result();
```

### Error Handling Utilities

```typescript
// Wrap throwing functions
const result = tryCatch(
  () => JSON.parse(input),
  e => ({ kind: "parse_error", message: String(e) })
);

// Wrap async throwing functions
const result = await tryCatchAsync(
  () => fetch(url).then(r => r.json()),
  e => ({ kind: "fetch_error", cause: e })
);

// Specialized fetch with automatic error handling
const result = await fetchResult(
  "https://api.example.com/data",
  { headers: { Authorization: `Bearer ${token}` } },
  e => e.type === "http" 
    ? { kind: "api_error", status: e.status }
    : { kind: "network_error", message: String(e.cause) }
);
```

### Real-World Example

From the cron job, processing an account:

```typescript
const result = await pipeResultAsync(decrypt(account.access_token_encrypted, env.ENCRYPTION_KEY))
  .mapErr((e): ProcessError => ({ kind: "decryption_failed", message: e.message }))
  .flatMapAsync(token => 
    pipeResultAsync(providerFactory.create(account.platform, token))
      .mapErr(toProcessError)
      .tapErrAsync(() => recordFailure(env, account.id))
      .result()
  )
  .flatMap(rawData =>
    pipeResult(createRawStore(account.platform, account.id, env))
      .mapErr((e): ProcessError => ({ kind: "store_failed", store_id: e.store_id }))
      .map(({ store }) => ({ rawData, store }))
      .result()
  )
  .flatMapAsync(({ rawData, store }) =>
    pipeResultAsync(store.put(rawData, { tags: [`platform:${account.platform}`] }))
      .mapErr((e): ProcessError => ({ kind: "put_failed", message: String(e) }))
      .map(({ version }) => ({ rawData, version }))
      .result()
  )
  .tapErr(logProcessError(account.id))
  .tapAsync(() => recordSuccess(env, account.id))
  .map(({ rawData, version }): RawSnapshot => ({
    account_id: account.id,
    platform: account.platform,
    version,
    data: rawData,
  }))
  .result();

return matchResult(result, snapshot => snapshot, () => null);
```

## API

### Authentication

All API requests require a Bearer token:

```bash
curl -H "Authorization: Bearer mtl_your_api_key_here" \
  https://your-worker.workers.dev/api/v1/timeline/user-123
```

### Endpoints

#### Get Timeline

```http
GET /api/v1/timeline/:user_id?from=2024-01-01&to=2024-12-31
```

Returns the user's aggregated timeline, optionally filtered by date range.

**Response:**
```json
{
  "meta": {
    "version": "v1_abc123",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "data": {
    "groups": [
      {
        "date": "2024-01-15",
        "entries": [
          {
            "type": "commit_group",
            "repo": "user/project",
            "date": "2024-01-15",
            "commits": [...]
          },
          {
            "id": "bluesky:post:abc123",
            "platform": "bluesky",
            "type": "post",
            "timestamp": "2024-01-15T09:00:00Z",
            "title": "Hello world!",
            "payload": { "type": "post", "content": "...", ... }
          }
        ]
      }
    ]
  }
}
```

#### List Connections

```http
GET /api/v1/connections
```

#### Add Connection

```http
POST /api/v1/connections
Content-Type: application/json

{
  "platform": "github",
  "access_token": "ghp_xxxx",
  "refresh_token": "ghr_xxxx"  // optional
}
```

#### Remove Connection

```http
DELETE /api/v1/connections/:account_id
```

## Data Flow

### Cron Job (every 5 minutes)

1. **Query active accounts** from D1 with user associations
2. **Check rate limits** and circuit breaker state
3. **Decrypt access tokens** using AES-GCM-256
4. **Fetch raw data** from each platform's API
5. **Store raw snapshots** in corpus (content-addressed, versioned)
6. **Normalize** platform-specific data to `TimelineItem[]`
7. **Group commits** by repository and date
8. **Group by date** for final timeline structure
9. **Store combined timeline** with references to source snapshots

### Rate Limiting

The system respects platform rate limits and implements a circuit breaker:

```typescript
type RateLimitState = {
  remaining: number | null;       // Requests remaining
  reset_at: Date | null;          // When limit resets
  consecutive_failures: number;   // Circuit breaker counter
  circuit_open_until: Date | null; // When circuit closes
};

// Circuit opens after 3 consecutive failures
// Stays open for 5 minutes before retrying
```

### Encryption

Access tokens are encrypted at rest:

- **Algorithm**: AES-GCM-256
- **Key derivation**: PBKDF2 with 100,000 iterations
- **IV**: 12 random bytes, prepended to ciphertext
- **Output**: Base64-encoded (IV || ciphertext)

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Cloudflare account (for deployment)

### Setup

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Type check all packages
bun run --filter='./packages/*' typecheck

# Format code
bunx @biomejs/biome check --write .
```

### Local Development

```bash
# Set up local D1 database
cd packages/worker
./scripts/setup-local.sh

# Seed test data
bun run scripts/seed-local.ts

# Start worker locally
bunx wrangler dev
```

### Testing

The test suite uses in-memory implementations:

- **SQLite** via `bun:sqlite` for D1
- **Memory providers** for platform APIs
- **Memory backend** for corpus storage

```bash
# Run all tests
bun run test

# Run with coverage
bun run test --coverage
```

## Deployment

### Environment Variables

```bash
# In Cloudflare dashboard or wrangler.toml
ENCRYPTION_KEY=your-32-byte-key-here
ENVIRONMENT=production
```

### Deploy

```bash
cd packages/worker
bunx wrangler deploy
```

## Extensions & TODOs

### Planned Platforms

- [ ] **Mastodon**: ActivityPub posts
- [ ] **LinkedIn**: Posts and articles
- [ ] **Twitter/X**: Tweets (if API access available)
- [ ] **Notion**: Page updates
- [ ] **Linear**: Issue updates

### Planned Features

- [ ] **OAuth flows**: Web UI for connecting accounts
- [ ] **Webhooks**: Real-time updates instead of polling
- [ ] **Filters**: Exclude certain repos, channels, etc.
- [ ] **Search**: Full-text search across timeline
- [ ] **Export**: Download timeline as JSON/CSV
- [ ] **Analytics**: Activity heatmaps, trends

### Technical Improvements

- [ ] **Refresh token rotation**: Auto-refresh expired tokens
- [ ] **Batch processing**: Process accounts in parallel batches
- [ ] **Incremental sync**: Only fetch new data since last sync
- [ ] **Compression**: Compress stored data in R2
- [ ] **Caching**: Edge caching for timeline reads

### Infrastructure

- [ ] **Observability**: Structured logging, metrics, tracing
- [ ] **Alerts**: Notify on high failure rates
- [ ] **Admin UI**: Manage users, view system health
- [ ] **Multi-region**: Deploy to multiple Cloudflare regions

## License

MIT
