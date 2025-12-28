# Media Timeline

A self-hosted service that aggregates your activity across multiple platforms (GitHub, Reddit, Twitter/X, Bluesky, YouTube, Devpad) into a unified, chronological timeline. Built with TypeScript, Cloudflare Workers, and a functional programming approach.

## Features

- **Multi-platform aggregation**: GitHub commits, Reddit posts/comments, Twitter/X tweets, Bluesky posts, YouTube videos, Devpad tasks
- **Intelligent grouping**: Commits to the same repository on the same day are grouped together
- **Versioned storage**: Full history of raw data and generated timelines with content-addressed deduplication
- **Multi-tenant**: Support for shared accounts across users with role-based access
- **Rate limit aware**: Circuit breaker pattern prevents hammering rate-limited APIs
- **Encrypted tokens**: Platform access tokens encrypted at rest with AES-GCM-256
- **OAuth integration**: Reddit and Twitter support full OAuth 2.0 flows

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Cloudflare Worker                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ GitHub  │ │ Reddit  │ │ Twitter │ │ Bluesky │ │ YouTube │ │ Devpad  │   │
│  │Provider │ │Provider │ │Provider │ │Provider │ │Provider │ │Provider │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       │          │          │          │          │          │            │
│       └──────────┴──────────┴──────────┴──────────┴──────────┘            │
│                                  │                                         │
│                                  ▼                                         │
│                          ┌───────────────┐                                 │
│                          │  Normalizers  │  Platform-specific → TimelineItem
│                          └───────┬───────┘                                 │
│                                  │                                         │
│                                  ▼                                         │
│                          ┌───────────────┐                                 │
│                          │   Groupers    │  Commits grouped by repo/day    │
│                          └───────┬───────┘                                 │
│                                  │                                         │
│                                  ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         @f0rbit/corpus                                │ │
│  │  Versioned, content-addressed storage with lineage tracking          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                    │                              │                        │
│                    ▼                              ▼                        │
│           ┌───────────────┐              ┌───────────────┐                 │
│           │  Cloudflare   │              │  Cloudflare   │                 │
│           │      D1       │              │      R2       │                 │
│           │  (metadata)   │              │    (data)     │                 │
│           └───────────────┘              └───────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
├── apps/
│   └── website/          # Astro + SolidJS frontend
├── src/
│   ├── platforms/        # Platform API clients
│   ├── schema/           # Zod schemas + Drizzle tables
│   └── ...               # Worker routes, cron, utils
├── scripts/
│   └── dev-server.ts     # Local development server
├── __tests__/
│   └── integration/      # Integration tests
└── migrations/           # Drizzle migrations
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EncryptionKey` | Yes | 32-byte key for AES-GCM-256 token encryption (SST secret) |
| `REDDIT_CLIENT_ID` | For Reddit | Reddit app client ID |
| `REDDIT_CLIENT_SECRET` | For Reddit | Reddit app client secret |
| `TWITTER_CLIENT_ID` | For Twitter | Twitter/X app client ID |
| `TWITTER_CLIENT_SECRET` | For Twitter | Twitter/X app client secret |
| `APP_URL` | For OAuth | API base URL for OAuth callbacks |
| `FRONTEND_URL` | For OAuth | Frontend URL for redirects |

## Types & Schema

### Core Domain Types

```typescript
// Supported platforms
type Platform = "github" | "reddit" | "twitter" | "bluesky" | "youtube" | "devpad";

// Unified timeline item
type TimelineItem = {
  id: string;                    // Unique identifier
  platform: Platform;
  type: "commit" | "post" | "video" | "task" | "tweet" | "comment";
  timestamp: string;             // ISO 8601
  title: string;
  url?: string;
  payload: CommitPayload | PostPayload | VideoPayload | TaskPayload | TweetPayload;
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
  platform TEXT NOT NULL,
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

## API

### Authentication

All API requests require a Bearer token:

```bash
curl -H "Authorization: Bearer mt_your_api_key_here" \
  https://your-worker.workers.dev/api/v1/timeline/user-123
```

### Endpoints

#### Get Timeline

```http
GET /api/v1/timeline/:user_id?from=2024-01-01&to=2024-12-31
```

Returns the user's aggregated timeline, optionally filtered by date range.

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

#### OAuth Flows

```http
GET /api/auth/reddit/login        # Initiate Reddit OAuth
GET /api/auth/reddit/callback     # Reddit OAuth callback
GET /api/auth/twitter/login       # Initiate Twitter OAuth
GET /api/auth/twitter/callback    # Twitter OAuth callback
```

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Cloudflare account (for deployment)

### Local Development

```bash
# 1. Install dependencies
bun install

# 2. Apply database migrations (creates local/dev.db)
bun db:migrate:local

# 3. Start the API server (uses local SQLite + file-based corpus)
bun dev:api
# API runs at http://localhost:8787
# Dev API key is printed on startup (mt_dev_xxxxx)

# 4. In a separate terminal, start the frontend
bun dev:app
# Frontend runs at http://localhost:4321

# OR start both concurrently
bun dev:all
```

To authenticate in the browser:
1. Open browser console on http://localhost:4321
2. Run: `localStorage.setItem('apiKey', 'mt_dev_xxxxx')` (use key from dev:api output)
3. Refresh the page

The local dev server uses:
- **Database**: `local/dev.db` (SQLite)
- **Corpus storage**: `local/corpus/` (file-based)

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun dev:api` | Start API server with local SQLite |
| `bun dev:app` | Start frontend dev server |
| `bun dev:all` | Start both API and frontend |
| `bun dev:sst` | Start with SST (uses Cloudflare) |
| `bun build` | Build frontend for production |
| `bun test` | Run tests |
| `bun lint` | Lint with Biome |
| `bun typecheck` | TypeScript type checking |
| `bun db:generate` | Generate Drizzle migrations |
| `bun db:migrate:local` | Apply migrations to local SQLite |

### Database Migrations

The project uses [Drizzle ORM](https://orm.drizzle.team/) for database schema management.

```bash
# Generate migrations from schema changes
bun db:generate

# Apply migrations to local SQLite database
bun db:migrate:local
```

The schema is defined in `src/schema/database.ts`. When you make changes:

1. Edit the schema in `src/schema/database.ts`
2. Run `bun db:generate` to create a new migration
3. Run `bun db:migrate:local` to apply to local dev database

### Testing

The test suite uses in-memory implementations:

- **SQLite** via `bun:sqlite` for D1
- **Memory providers** for platform APIs
- **Memory backend** for corpus storage

```bash
# Run all tests
bun test

# Run with coverage
bun test:coverage
```

## Deployment

This project uses [SST](https://sst.dev) for infrastructure management and deployment.

### Prerequisites

1. Set your Cloudflare API token:
```bash
export CLOUDFLARE_API_TOKEN=your-api-token
export CLOUDFLARE_DEFAULT_ACCOUNT_ID=your-account-id
```

2. Set the encryption key secret:
```bash
npx sst secret set EncryptionKey your-32-byte-key-here
```

For production:
```bash
npx sst secret set EncryptionKey your-32-byte-key-here --stage production
```

### Deploy

```bash
# Deploy to dev stage
bun run deploy

# Deploy to production
bun run deploy:prod
```

### D1 Migrations

Migrations are generated by Drizzle Kit and stored in `migrations/`.

```bash
# Generate new migration from schema changes
bun db:generate

# Apply to local SQLite (development)
bun db:migrate:local

# Apply to Cloudflare D1 (use wrangler)
bunx wrangler d1 migrations apply <database-name> --remote
```

### SST Outputs

After deployment, SST outputs:
- `api`: Worker URL
- `databaseId`: D1 database ID  
- `bucketName`: R2 bucket name

## Platform Setup

### GitHub
Requires a Personal Access Token with `repo` and `read:user` scopes.

### Reddit
1. Create app at https://www.reddit.com/prefs/apps
2. Select "web app" type
3. Set redirect URI to `http://localhost:8787/api/auth/reddit/callback`
4. Set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`

### Twitter/X
1. Create app at https://developer.twitter.com
2. Enable OAuth 2.0 with PKCE
3. Set callback URL to `http://localhost:8787/api/auth/twitter/callback`
4. Set `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET`
5. Note: Requires Basic API tier ($100/month) for user tweet access

### Bluesky
Requires app password from Bluesky settings.

### YouTube
Requires YouTube Data API key or OAuth credentials.

## Extensions & TODOs

### Planned Platforms

- [ ] **Mastodon**: ActivityPub posts
- [ ] **LinkedIn**: Posts and articles
- [ ] **Notion**: Page updates
- [ ] **Linear**: Issue updates

### Planned Features

- [ ] **OAuth flows**: GitHub and YouTube OAuth (Reddit/Twitter done)
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
