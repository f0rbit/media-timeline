# Media Timeline Deployment Strategy

## Executive Summary

This document outlines the deployment strategy for the Media Timeline aggregator project to `media.devpad.tools`. The strategy is designed for **immediate production deployment** while laying the groundwork for **seamless future migration** into a unified devpad monorepo.

### Current State

- **Framework**: Cloudflare Workers + D1 + Hono + SST (Ion)
- **Frontend**: Astro + SolidJS (separate Cloudflare Pages deployment)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (for corpus snapshots)
- **Cron**: Cloudflare Workers scheduled triggers (every 5 minutes)

### Target Architecture

```
media.devpad.tools
├── / (Landing, Dashboard, Settings) → Astro/Cloudflare Pages
└── /media/api/* → Cloudflare Workers API
```

---

## Part 1: Immediate Deployment (Do Now)

### 1.1 SST Configuration for Production

The current `sst.config.ts` is already well-structured. Update for production domains:

```typescript
// sst.config.ts
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "media-timeline",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "cloudflare",
    };
  },
  async run() {
    const isProduction = $app.stage === "production";

    // Resources
    const db = new sst.cloudflare.D1("DB");
    const bucket = new sst.cloudflare.Bucket("BUCKET");
    const encryptionKey = new sst.Secret("EncryptionKey");

    // OAuth Secrets (per-environment)
    const redditClientId = new sst.Secret("RedditClientId");
    const redditClientSecret = new sst.Secret("RedditClientSecret");
    const twitterClientId = new sst.Secret("TwitterClientId");
    const twitterClientSecret = new sst.Secret("TwitterClientSecret");
    const githubClientId = new sst.Secret("GitHubClientId");
    const githubClientSecret = new sst.Secret("GitHubClientSecret");

    // Environment-specific URLs
    // Production uses custom domain, staging/preview use auto-generated Cloudflare URLs
    const apiUrl = isProduction ? "https://media.devpad.tools" : "http://localhost:8787";
    const frontendUrl = isProduction ? "https://media.devpad.tools" : "http://localhost:4321";

    const worker = new sst.cloudflare.Worker("Api", {
      handler: "src/index.ts",
      url: true,
      link: [db, bucket, encryptionKey],
      environment: {
        ENVIRONMENT: isProduction ? "production" : "development",
        MEDIA_API_URL: apiUrl,
        MEDIA_FRONTEND_URL: frontendUrl,
      },
      transform: {
        worker: (args) => {
          args.scheduledTriggers = [{ cron: "*/5 * * * *" }];
        },
      },
    });

    // Astro website deployment
    // Only production gets a custom domain; staging/preview use auto-generated *.pages.dev URLs
    const website = new sst.cloudflare.Astro("Website", {
      path: "apps/website",
      environment: {
        PUBLIC_API_URL: apiUrl,
        PUBLIC_DEVPAD_URL: "https://devpad.tools",
      },
      domain: isProduction ? "media.devpad.tools" : undefined,
    });

    return {
      api: worker.url,
      website: website.url,
      databaseId: db.databaseId,
      bucketName: bucket.name,
    };
  },
});
```

### 1.2 Wrangler Configuration Updates

Create environment-specific wrangler configs:

```toml
# wrangler.toml (base config)
name = "media-timeline"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[triggers]
crons = ["*/5 * * * *"]

[vars]
ENVIRONMENT = "development"

# Note: D1 and R2 bindings are managed by SST
# This file is primarily used for local development with `wrangler dev`
```

```toml
# wrangler.production.toml (for manual deploys if needed)
name = "media-timeline-production"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[triggers]
crons = ["*/5 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "media-timeline-production-db"
database_id = "${PRODUCTION_D1_ID}"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "media-timeline-production"

[vars]
ENVIRONMENT = "production"
MEDIA_API_URL = "https://media.devpad.tools"
MEDIA_FRONTEND_URL = "https://media.devpad.tools"

# Secrets are set via `wrangler secret put` or SST
```

### 1.3 GitHub Actions CI/CD Pipeline

Update the deployment workflow for production:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      stage:
        description: 'Deployment stage'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

concurrency:
  group: deploy-${{ github.event.inputs.stage || (github.event_name == 'release' && 'production') || 'staging' }}
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun run typecheck
      - run: bun test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.stage || (github.event_name == 'release' && 'production') || 'staging' }}
    
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install

      - name: Determine stage
        id: stage
        run: |
          if [ "${{ github.event_name }}" = "release" ]; then
            echo "stage=production" >> $GITHUB_OUTPUT
          elif [ -n "${{ github.event.inputs.stage }}" ]; then
            echo "stage=${{ github.event.inputs.stage }}" >> $GITHUB_OUTPUT
          else
            echo "stage=staging" >> $GITHUB_OUTPUT
          fi

      - name: Deploy to ${{ steps.stage.outputs.stage }}
        run: bunx sst deploy --stage ${{ steps.stage.outputs.stage }}
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_DEFAULT_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
          SST_SECRET_ENCRYPTIONKEY: ${{ secrets.ENCRYPTION_KEY }}
          SST_SECRET_REDDITCLIENTID: ${{ secrets.REDDIT_CLIENT_ID }}
          SST_SECRET_REDDITCLIENTSECRET: ${{ secrets.REDDIT_CLIENT_SECRET }}
          SST_SECRET_TWITTERCLIENTID: ${{ secrets.TWITTER_CLIENT_ID }}
          SST_SECRET_TWITTERCLIENTSECRET: ${{ secrets.TWITTER_CLIENT_SECRET }}
          SST_SECRET_GITHUBCLIENTID: ${{ secrets.GITHUB_CLIENT_ID }}
          SST_SECRET_GITHUBCLIENTSECRET: ${{ secrets.GITHUB_CLIENT_SECRET }}

      - name: Run D1 migrations
        if: success()
        run: |
          STAGE="${{ steps.stage.outputs.stage }}"
          DB_NAME="media-timeline-${STAGE}-dbdatabase"
          
          FULL_DB_NAME=$(bunx wrangler d1 list --json | jq -r ".[] | select(.name | startswith(\"$DB_NAME\")) | .name" | head -1)
          
          if [ -n "$FULL_DB_NAME" ]; then
            echo "Running migrations on $FULL_DB_NAME"
            bunx wrangler d1 migrations apply "$FULL_DB_NAME" --remote
          else
            echo "::warning::Could not find D1 database starting with $DB_NAME"
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Post deployment summary
        if: success()
        run: |
          echo "## Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "| Property | Value |" >> $GITHUB_STEP_SUMMARY
          echo "|----------|-------|" >> $GITHUB_STEP_SUMMARY
          echo "| Stage | ${{ steps.stage.outputs.stage }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Trigger | ${{ github.event_name }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Commit | \`${{ github.sha }}\` |" >> $GITHUB_STEP_SUMMARY
          if [ "${{ github.event_name }}" = "release" ]; then
            echo "| Release | ${{ github.event.release.tag_name }} |" >> $GITHUB_STEP_SUMMARY
          fi

  notify-failure:
    needs: [test, deploy]
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Notify on failure
        run: |
          echo "::error::Deployment failed for ${{ github.event_name }}"
          # Add Slack/Discord notification here if needed
```

### 1.4 Environment Variables & Secrets

#### Required GitHub Secrets

| Secret Name | Description | Required For |
|-------------|-------------|--------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers/D1/R2 permissions | All stages |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | All stages |
| `CLOUDFLARE_ZONE_ID` | Zone ID for `devpad.tools` domain | Production only |
| `ENCRYPTION_KEY` | AES-256 encryption key for token storage | All stages |
| `REDDIT_CLIENT_ID` | Reddit OAuth app client ID | All stages |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth app client secret | All stages |
| `TWITTER_CLIENT_ID` | Twitter/X OAuth 2.0 client ID | All stages |
| `TWITTER_CLIENT_SECRET` | Twitter/X OAuth 2.0 client secret | All stages |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | All stages |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | All stages |

#### Setting Secrets

```bash
# Via SST (recommended for production)
bunx sst secret set EncryptionKey "your-256-bit-key-here" --stage production
bunx sst secret set RedditClientId "your-client-id" --stage production
bunx sst secret set RedditClientSecret "your-client-secret" --stage production
# ... repeat for other OAuth providers

# Via Wrangler (for manual deploys)
bunx wrangler secret put EncryptionKey --env production
```

### 1.5 DNS & Domain Configuration

#### Required DNS Records (Cloudflare)

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `media` | `<pages-deployment>.pages.dev` | Proxied |

**Note:** Staging and preview deployments use auto-generated Cloudflare URLs (`*.workers.dev` and `*.pages.dev`) and don't require custom DNS records.

#### Custom Domain Setup

SST automatically configures custom domains when specified. The API is served from the same domain as the frontend (`media.devpad.tools/media/api/*`), so no separate worker domain is needed.

### 1.6 First Deployment Checklist

```markdown
- [ ] Generate 256-bit encryption key: `openssl rand -base64 32`
- [ ] Create OAuth apps for all platforms (Reddit, Twitter, GitHub)
- [ ] Set OAuth redirect URIs:
  - Reddit: `https://media.devpad.tools/media/api/auth/reddit/callback`
  - Twitter: `https://media.devpad.tools/media/api/auth/twitter/callback`
  - GitHub: `https://media.devpad.tools/media/api/auth/github/callback`
- [ ] Configure GitHub Secrets (see section 1.4)
- [ ] Run initial deployment: `bunx sst deploy --stage production`
- [ ] Run D1 migrations manually for first deploy
- [ ] Verify DNS propagation
- [ ] Test OAuth flows end-to-end
- [ ] Verify cron job is running (check Workers dashboard)
```

---

## Part 2: Future-Proofing (Do Now)

### 2.1 Database Table Prefixing

**Status: ALREADY DONE**

The database schema in `src/schema/database.ts` already uses the `media_` prefix:

```typescript
export const users = sqliteTable("media_users", { ... });
export const profiles = sqliteTable("media_profiles", { ... });
export const accounts = sqliteTable("media_accounts", { ... });
export const apiKeys = sqliteTable("media_api_keys", { ... });
export const rateLimits = sqliteTable("media_rate_limits", { ... });
export const accountSettings = sqliteTable("media_account_settings", { ... });
export const corpusSnapshots = sqliteTable("media_corpus_snapshots", { ... });
export const corpusParents = sqliteTable("media_corpus_parents", { ... });
export const profileFilters = sqliteTable("media_profile_filters", { ... });
```

**CRITICAL**: The current migration file (`0000_slippery_frank_castle.sql`) does NOT have these prefixes. A new migration is required before production deployment.

#### Action Required: Create Migration for Prefixed Tables

```bash
# Generate new migration with prefixed tables
bun run db:generate

# This will create a new migration that renames all tables
```

If the database is empty (first production deploy), regenerate migrations:

```bash
# Delete old migration
rm migrations/0000_slippery_frank_castle.sql

# Generate fresh migration
bun run db:generate
```

### 2.2 Route Prefixing

**Status: ALREADY DONE**

The Hono router in `src/index.ts` already mounts at `/media`:

```typescript
// src/index.ts
const mediaApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
// ... middleware and routes setup ...

app.route("/media", mediaApp);  // All routes under /media prefix
```

This means all API routes are already accessible at:
- `/media/api/auth/*`
- `/media/api/v1/timeline/*`
- `/media/api/v1/connections/*`
- `/media/api/v1/profiles/*`

### 2.3 Shared Bindings Pattern

Create an exportable bindings interface for monorepo consumption:

```typescript
// src/bindings.ts (updated)
/// <reference types="@cloudflare/workers-types" />

import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import type { AppContext } from "./infrastructure";
import type { ProviderFactory } from "./platforms/types";
import * as schema from "./schema/database";

// === Exportable Types for Monorepo ===

/**
 * Media-specific bindings that this module requires.
 * In the monorepo, the parent app will provide these from the shared D1/R2.
 */
export type MediaBindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  EncryptionKey: string;
  ENVIRONMENT: string;
  MEDIA_REDDIT_CLIENT_ID?: string;
  MEDIA_REDDIT_CLIENT_SECRET?: string;
  MEDIA_TWITTER_CLIENT_ID?: string;
  MEDIA_TWITTER_CLIENT_SECRET?: string;
  MEDIA_GITHUB_CLIENT_ID?: string;
  MEDIA_GITHUB_CLIENT_SECRET?: string;
  MEDIA_API_URL?: string;
  MEDIA_FRONTEND_URL?: string;
};

// Legacy alias for backwards compatibility
export type Bindings = MediaBindings;

/**
 * Configuration options when mounting the media app.
 * Allows the parent monorepo to customize behavior.
 */
export type MediaAppConfig = {
  /** Base path for API routes (default: "/media") */
  basePath?: string;
  /** Override CORS origins */
  corsOrigins?: string[];
  /** Custom provider factory for testing */
  providerFactory?: ProviderFactory;
};

// ... rest of bindings.ts
```

### 2.4 Module Boundaries / Exportable App

Create an exportable Hono app for monorepo mounting:

```typescript
// src/app.ts (NEW FILE)
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MediaBindings, MediaAppConfig } from "./bindings";
import { createContextFromBindings } from "./bindings";
import { authMiddleware, getAuth } from "./auth";
import { defaultProviderFactory } from "./platforms";
import { authRoutes, connectionRoutes, profileRoutes, timelineRoutes } from "./routes";
import { users } from "./schema";
import { eq } from "drizzle-orm";

type Variables = {
  auth: { user_id: string; key_id: string };
  appContext: AppContext;
};

/**
 * Creates the Media Timeline Hono app.
 * 
 * This can be used standalone or mounted in a parent monorepo app:
 * 
 * ```typescript
 * // Standalone
 * export default { fetch: createMediaApp().fetch };
 * 
 * // Mounted in monorepo
 * const parent = new Hono();
 * parent.route("/media", createMediaApp({ basePath: "/media" }));
 * ```
 */
export function createMediaApp(config: MediaAppConfig = {}) {
  const { 
    basePath = "/media",
    corsOrigins,
    providerFactory = defaultProviderFactory 
  } = config;

  const app = new Hono<{ Bindings: MediaBindings; Variables: Variables }>();

  // CORS middleware
  app.use("*", cors({
    origin: (origin) => {
      const defaultOrigins = [
        "http://localhost:4321",
        "http://localhost:3000",
        "https://media.devpad.tools",
        "https://devpad.tools",
      ];
      const allowed = corsOrigins ?? defaultOrigins;
      if (!origin || allowed.includes(origin)) return origin;
      if (origin.endsWith(".workers.dev")) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }));

  // Context middleware
  app.use("/api/*", async (c, next) => {
    const ctx = createContextFromBindings(c.env, providerFactory);
    c.set("appContext", ctx);
    await next();
  });

  // Auth middleware (skip auth routes)
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith(`${basePath}/api/auth`)) {
      return next();
    }
    return authMiddleware(c, next);
  });

  // Mount routes
  app.route("/api/auth", authRoutes);
  app.route("/api/v1/timeline", timelineRoutes);
  app.route("/api/v1/connections", connectionRoutes);
  app.route("/api/v1/profiles", profileRoutes);

  // User info endpoint
  app.get("/api/v1/me", async (c) => {
    const auth = getAuth(c);
    const ctx = c.get("appContext");
    const user = await ctx.db.select().from(users).where(eq(users.id, auth.user_id)).get();
    if (!user) return c.json({ error: "User not found" }, 404);
    return c.json({ id: user.id, name: user.name, email: user.email });
  });

  app.post("/api/auth/logout", (c) => {
    return c.json({ redirect: "https://devpad.tools/logout" });
  });

  return app;
}

// Export types and utilities for external consumers
export { MediaBindings, MediaAppConfig } from "./bindings";
export { AppContext } from "./infrastructure";
export * as schema from "./schema";
```

Update `src/index.ts` to use the new exportable app:

```typescript
// src/index.ts
import { Hono } from "hono";
import { createMediaApp } from "./app";
import type { Bindings } from "./bindings";
import { createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import { defaultProviderFactory } from "./platforms";

const app = new Hono<{ Bindings: Bindings }>();

// Health check at root
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Mount media app at /media
app.route("/media", createMediaApp({ basePath: "/media" }));

// 404 handler
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", message: err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, executionCtx: ExecutionContext) {
    const appCtx = createContextFromBindings(env, defaultProviderFactory);
    executionCtx.waitUntil(handleCron(appCtx));
  },
};

// Re-export for monorepo consumers
export { createMediaApp } from "./app";
export type { MediaBindings, MediaAppConfig } from "./bindings";
```

### 2.5 Configuration Externalization

Create a config module that can accept external configuration:

```typescript
// src/config.ts (NEW FILE)

export type MediaConfig = {
  // API URLs
  apiUrl: string;
  frontendUrl: string;
  devpadUrl: string;

  // Feature flags
  enableCron: boolean;
  enableOAuth: {
    reddit: boolean;
    twitter: boolean;
    github: boolean;
    youtube: boolean;
  };

  // Rate limiting
  cronIntervalMinutes: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMinutes: number;
};

const defaultConfig: MediaConfig = {
  apiUrl: "http://localhost:8787",
  frontendUrl: "http://localhost:4321",
  devpadUrl: "https://devpad.tools",
  enableCron: true,
  enableOAuth: {
    reddit: true,
    twitter: true,
    github: true,
    youtube: false,
  },
  cronIntervalMinutes: 5,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMinutes: 5,
};

let currentConfig: MediaConfig = { ...defaultConfig };

export function configureMedia(overrides: Partial<MediaConfig>): void {
  currentConfig = { ...currentConfig, ...overrides };
}

export function getConfig(): MediaConfig {
  return currentConfig;
}

// Environment-based configuration
export function configureFromEnv(env: {
  ENVIRONMENT?: string;
  MEDIA_API_URL?: string;
  MEDIA_FRONTEND_URL?: string;
}): void {
  const isProduction = env.ENVIRONMENT === "production";
  
  configureMedia({
    apiUrl: env.MEDIA_API_URL ?? (isProduction ? "https://media.devpad.tools" : defaultConfig.apiUrl),
    frontendUrl: env.MEDIA_FRONTEND_URL ?? (isProduction ? "https://media.devpad.tools" : defaultConfig.frontendUrl),
  });
}
```

### 2.6 Package.json Exports for Monorepo

Update `package.json` to support monorepo consumption:

```json
{
  "name": "@devpad/media-timeline",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts"
    },
    "./app": {
      "types": "./dist/app.d.ts",
      "import": "./src/app.ts"
    },
    "./schema": {
      "types": "./dist/schema/index.d.ts",
      "import": "./src/schema/index.ts"
    },
    "./config": {
      "types": "./dist/config.d.ts",
      "import": "./src/config.ts"
    }
  },
  "files": ["src", "dist", "migrations"],
  "scripts": {
    "build:types": "tsc --declaration --emitDeclarationOnly --outDir dist"
  }
}
```

### 2.7 Migration Strategy for Shared D1

When multiple projects share a D1 database, migrations need coordination:

#### Approach: Prefixed Migrations Directory

Each project maintains its own migrations in a prefixed folder:

```
migrations/
├── media/           # media-timeline migrations
│   ├── 0001_initial.sql
│   └── 0002_add_filters.sql
├── blog/            # dev-blog migrations
│   └── 0001_initial.sql
└── devpad/          # core devpad migrations
    └── 0001_initial.sql
```

#### Migration Runner Script

```typescript
// scripts/run-migrations.ts
import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

type MigrationProject = "media" | "blog" | "devpad";

async function runMigrations(project: MigrationProject, dbName: string) {
  const migrationsDir = join(process.cwd(), "migrations", project);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`Running ${project}/${file}...`);
    
    // Use wrangler to execute
    execSync(`echo "${sql}" | bunx wrangler d1 execute ${dbName} --remote`, {
      stdio: "inherit",
    });
  }
}

// Run specific project's migrations
const project = process.argv[2] as MigrationProject;
const dbName = process.argv[3];

if (!project || !dbName) {
  console.error("Usage: bun run-migrations.ts <project> <db-name>");
  process.exit(1);
}

runMigrations(project, dbName);
```

#### Drizzle Configuration Update

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/database.ts",
  out: "./migrations/media",  // Project-specific migrations
  dialect: "sqlite",
  tablesFilter: ["media_*"],  // Only manage media_ prefixed tables
  ...(process.env.DATABASE_URL && {
    dbCredentials: {
      url: process.env.DATABASE_URL,
    },
  }),
});
```

---

## Part 3: Future Migration to Monorepo

### 3.1 Monorepo Structure Vision

```
devpad/
├── packages/
│   ├── media-timeline/      # This project (moved)
│   │   ├── src/
│   │   ├── migrations/
│   │   └── package.json
│   ├── dev-blog/            # Blog package
│   └── shared/              # Shared utilities
│       ├── db/              # D1 connection factory
│       ├── auth/            # Devpad auth module
│       └── ui/              # Shared UI components
├── apps/
│   ├── api/                 # Unified Worker API
│   │   └── src/
│   │       └── index.ts     # Mounts all package APIs
│   └── web/                 # Unified Astro frontend
├── infrastructure/
│   └── sst.config.ts        # Single SST config for all
└── migrations/
    ├── media/
    ├── blog/
    └── devpad/
```

### 3.2 Unified API Entry Point

```typescript
// apps/api/src/index.ts
import { Hono } from "hono";
import { createMediaApp } from "@devpad/media-timeline/app";
import { createBlogApp } from "@devpad/dev-blog/app";
import type { SharedBindings } from "@devpad/shared/bindings";

const app = new Hono<{ Bindings: SharedBindings }>();

// Health check
app.get("/health", (c) => c.json({ 
  status: "ok", 
  services: ["media", "blog"],
  timestamp: new Date().toISOString() 
}));

// Mount sub-apps
app.route("/media", createMediaApp());
app.route("/blog", createBlogApp());

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
```

### 3.3 Migration Steps (When Moving to Monorepo)

#### Phase 1: Preparation (1-2 days)

1. **Finalize table prefixes**: Ensure all tables use `media_` prefix
2. **Export all modules**: Verify `package.json` exports work
3. **Test mountable app**: Verify `createMediaApp()` works in isolation
4. **Document bindings**: List all required bindings

#### Phase 2: Code Migration (1 day)

1. **Copy to monorepo**: Move project to `packages/media-timeline/`
2. **Update imports**: Change relative imports to package imports
3. **Wire up unified API**: Import and mount in `apps/api/`
4. **Update SST config**: Single config managing all resources

#### Phase 3: Infrastructure Migration (1 day)

1. **Create shared D1**: New database for all projects
2. **Run all migrations**: Execute `media/`, `blog/`, etc.
3. **Migrate data** (if needed): Export/import from old D1
4. **Update DNS**: Point `media.devpad.tools` to new deployment

#### Phase 4: Verification & Cutover (1 day)

1. **Deploy to staging**: Test complete integration
2. **Run E2E tests**: Verify OAuth flows, timeline generation
3. **Blue-green deployment**: Switch production traffic
4. **Monitor**: Watch for errors in first 24h
5. **Decommission old worker**: Remove after confidence period

### 3.4 Database Migration (If Tables Need Renaming)

If the old production database has unprefixed tables:

```sql
-- Migration: Rename tables to prefixed versions
-- 0002_prefix_tables.sql

-- Step 1: Create prefixed tables
CREATE TABLE media_users AS SELECT * FROM users;
CREATE TABLE media_profiles AS SELECT * FROM profiles;
CREATE TABLE media_accounts AS SELECT * FROM accounts;
-- ... repeat for all tables

-- Step 2: Drop old tables
DROP TABLE users;
DROP TABLE profiles;
DROP TABLE accounts;
-- ... repeat for all tables

-- Step 3: Recreate indexes with prefixed names
CREATE UNIQUE INDEX idx_media_users_email ON media_users(email);
-- ... repeat for all indexes
```

**IMPORTANT**: Run this during a maintenance window. D1 doesn't support transactions across DDL statements.

### 3.5 Rollback Strategy

If issues are found after migration:

1. **Keep old Worker deployed** (just not receiving traffic)
2. **DNS rollback**: Update CNAME to point back to old worker
3. **Data sync**: If writes happened to new DB, sync back
4. **Post-mortem**: Document what went wrong

---

## Part 4: Operational Considerations

### 4.1 Staging vs Production Environments

| Aspect | Staging/Preview | Production |
|--------|-----------------|------------|
| Domain | Auto-generated (`*.workers.dev`, `*.pages.dev`) | `media.devpad.tools` |
| API Path | `/media/api/*` | `/media/api/*` |
| D1 Database | Separate instance | Production instance |
| R2 Bucket | Separate bucket | Production bucket |
| OAuth Apps | Test apps (use auto-generated worker URL for callbacks) | Production apps |
| Cron | Enabled (5 min) | Enabled (5 min) |
| Encryption Key | Different key | Production key |

### 4.2 Logging & Observability

#### Structured Logging (Already Implemented)

The project uses `createLogger` for structured logging:

```typescript
const logger = createLogger("cron");
logger.info("Starting cron job", { accounts: accounts.length });
logger.error("Provider failed", { platform, error: err.message });
```

#### Recommended: Cloudflare Logpush

Enable Logpush for production:

```bash
# Via Cloudflare dashboard or API
# Push logs to: Datadog, Splunk, S3, R2, etc.
```

#### Metrics to Track

- **API latency**: P50, P95, P99 for each endpoint
- **Cron success rate**: Failed vs successful runs
- **OAuth flow completion**: Started vs completed
- **Rate limit hits**: Per platform
- **Circuit breaker trips**: Per account

### 4.3 Error Handling & Alerting

#### Recommended: Sentry Integration

```typescript
// src/sentry.ts
import * as Sentry from "@sentry/cloudflare";

export function initSentry(env: { SENTRY_DSN?: string; ENVIRONMENT: string }) {
  if (!env.SENTRY_DSN) return;
  
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    tracesSampleRate: env.ENVIRONMENT === "production" ? 0.1 : 1.0,
  });
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  console.error(error, context);
  Sentry.captureException(error, { extra: context });
}
```

#### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Error rate | > 1% | > 5% |
| Cron failures | 2 consecutive | 5 consecutive |
| P99 latency | > 2s | > 5s |
| Circuit breaker open | 3+ accounts | 10+ accounts |

### 4.4 Rollback Strategies

#### Worker Rollback (Instant)

```bash
# List deployments
bunx wrangler deployments list

# Rollback to previous deployment
bunx wrangler rollback --version <deployment-id>
```

#### Database Rollback (Manual)

D1 supports point-in-time recovery:

```bash
# List available backups
bunx wrangler d1 backups list <database-name>

# Restore from backup
bunx wrangler d1 backups restore <database-name> <backup-id>
```

#### SST Rollback

```bash
# Deploy specific previous state
bunx sst deploy --stage production --from <commit-sha>
```

---

## Summary Checklist

### Immediate Actions (Before First Deploy)

- [ ] Regenerate migrations with `media_` prefixed tables
- [ ] Configure all GitHub Secrets
- [ ] Create OAuth apps with correct redirect URIs
- [ ] Generate and store encryption key
- [ ] Update CI/CD workflow

### Future-Proofing (Do This Week)

- [ ] Create `src/app.ts` with exportable `createMediaApp()`
- [ ] Create `src/config.ts` for externalized configuration
- [ ] Update `package.json` with proper exports
- [ ] Update `drizzle.config.ts` with `tablesFilter`
- [ ] Move migrations to `migrations/media/` subdirectory

### Migration Readiness (Before Monorepo Move)

- [ ] Document all required bindings
- [ ] Test `createMediaApp()` mounting in isolation
- [ ] Create migration script for table renaming (if needed)
- [ ] Plan maintenance window
- [ ] Prepare rollback procedure

---

## Appendix A: OAuth Redirect URIs

### Production

| Platform | Redirect URI |
|----------|--------------|
| Reddit | `https://media.devpad.tools/media/api/auth/reddit/callback` |
| Twitter | `https://media.devpad.tools/media/api/auth/twitter/callback` |
| GitHub | `https://media.devpad.tools/media/api/auth/github/callback` |

### Staging/Preview

Staging and preview deployments use auto-generated Cloudflare URLs. The redirect URI will be based on the deployed worker URL (e.g., `https://<worker-name>.<account>.workers.dev/media/api/auth/<platform>/callback`).

**Note:** You'll need to add the auto-generated worker URL to your OAuth app's allowed redirect URIs after deployment.

### Local Development

| Platform | Redirect URI |
|----------|--------------|
| Reddit | `http://localhost:8787/media/api/auth/reddit/callback` |
| Twitter | `http://localhost:8787/media/api/auth/twitter/callback` |
| GitHub | `http://localhost:8787/media/api/auth/github/callback` |

---

## Appendix B: Cloudflare API Token Permissions

Required permissions for deployment:

- **Account Settings**: Read
- **Workers Scripts**: Edit
- **Workers KV Storage**: Edit (if using KV)
- **Workers R2 Storage**: Edit
- **D1**: Edit
- **Zone Settings**: Read
- **DNS**: Edit (for custom domains)
- **Cloudflare Pages**: Edit
