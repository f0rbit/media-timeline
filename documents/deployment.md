# Media Timeline Deployment Strategy

## Executive Summary

This document outlines the deployment strategy for the Media Timeline aggregator project to `media.devpad.tools`. The deployment uses Wrangler for Cloudflare Workers deployment.

### Current State

- **Framework**: Cloudflare Workers + D1 + Hono + Wrangler
- **Frontend**: Astro + SolidJS (unified build with Worker)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (for corpus snapshots)
- **Cron**: Cloudflare Workers scheduled triggers (every 5 minutes)

### Target Architecture

```
media.devpad.tools
├── / (Landing, Dashboard, Settings) → Astro (served from Worker assets)
└── /media/api/* → Cloudflare Workers API
```

---

## Part 1: Deployment Configuration

### 1.1 Wrangler Configuration

The `wrangler.toml` configuration uses environment sections for preview and production:

```toml
name = "media-timeline-api"
main = "dist/_worker.js"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "dist"
binding = "ASSETS"

[triggers]
crons = ["*/5 * * * *"]

# Production environment (default)
[vars]
ENVIRONMENT = "production"
API_URL = "https://media.devpad.tools"
FRONTEND_URL = "https://media.devpad.tools"

[[d1_databases]]
binding = "DB"
database_name = "media-timeline-db"
database_id = "<production-db-id>"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "CORPUS_BUCKET"
bucket_name = "media-timeline-corpus"

routes = [
  { pattern = "media.devpad.tools", custom_domain = true }
]

# Preview environment
[env.preview]
name = "media-timeline-api-preview"

[env.preview.vars]
ENVIRONMENT = "preview"
API_URL = "https://media-preview.devpad.tools"
FRONTEND_URL = "https://media-preview.devpad.tools"

[[env.preview.d1_databases]]
binding = "DB"
database_name = "media-timeline-db-preview"
database_id = "<preview-db-id>"
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "CORPUS_BUCKET"
bucket_name = "media-timeline-corpus-preview"
```

### 1.2 GitHub Actions CI/CD Pipeline

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
        default: 'preview'
        type: choice
        options:
          - preview
          - production

concurrency:
  group: deploy-${{ github.event.inputs.stage || (github.event_name == 'release' && 'production') || 'preview' }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.stage || (github.event_name == 'release' && 'production') || 'preview' }}
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun test
      
      - name: Determine stage
        id: stage
        run: |
          if [ "${{ github.event_name }}" = "release" ]; then
            echo "stage=production" >> $GITHUB_OUTPUT
          elif [ -n "${{ github.event.inputs.stage }}" ]; then
            echo "stage=${{ github.event.inputs.stage }}" >> $GITHUB_OUTPUT
          else
            echo "stage=preview" >> $GITHUB_OUTPUT
          fi

      - name: Build
        run: bun run build

      - name: Run D1 migrations
        run: |
          if [ "${{ steps.stage.outputs.stage }}" = "production" ]; then
            bunx wrangler d1 migrations apply media-timeline-db --remote
          else
            bunx wrangler d1 migrations apply media-timeline-db-preview --remote --env preview
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy
        run: |
          if [ "${{ steps.stage.outputs.stage }}" = "production" ]; then
            bunx wrangler deploy
          else
            bunx wrangler deploy --env preview
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### 1.3 Environment Variables & Secrets

#### Required GitHub Secrets

| Secret Name | Description | Required For |
|-------------|-------------|--------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers/D1/R2 permissions | All stages |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | All stages |

#### Wrangler Secrets (set via CLI)

Secrets are set using `wrangler secret put`:

```bash
# Set secrets for production
wrangler secret put ENCRYPTION_KEY
wrangler secret put REDDIT_CLIENT_ID
wrangler secret put REDDIT_CLIENT_SECRET
wrangler secret put TWITTER_CLIENT_ID
wrangler secret put TWITTER_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Set secrets for preview
wrangler secret put ENCRYPTION_KEY --env preview
wrangler secret put REDDIT_CLIENT_ID --env preview
# ... etc
```

### 1.4 First Deployment Checklist

```markdown
- [ ] Generate 256-bit encryption key: `openssl rand -base64 32`
- [ ] Create Cloudflare D1 databases for production and preview
- [ ] Create Cloudflare R2 buckets for production and preview
- [ ] Update wrangler.toml with correct database_id values
- [ ] Create OAuth apps for all platforms (Reddit, Twitter, GitHub)
- [ ] Set OAuth redirect URIs:
  - Reddit: `https://media.devpad.tools/media/api/auth/reddit/callback`
  - Twitter: `https://media.devpad.tools/media/api/auth/twitter/callback`
  - GitHub: `https://media.devpad.tools/media/api/auth/github/callback`
- [ ] Configure GitHub Secrets (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
- [ ] Set Wrangler secrets via CLI
- [ ] Run initial deployment: `bun run deploy:production`
- [ ] Verify DNS propagation
- [ ] Test OAuth flows end-to-end
- [ ] Verify cron job is running (check Workers dashboard)
```

---

## Part 2: Database & Bindings

### 2.1 Database Table Prefixing

The database schema in `src/schema/database.ts` uses the `media_` prefix:

```typescript
export const users = sqliteTable("media_users", { ... });
export const profiles = sqliteTable("media_profiles", { ... });
export const accounts = sqliteTable("media_accounts", { ... });
// ... etc
```

### 2.2 Bindings Interface

```typescript
// src/bindings.ts
export type Bindings = {
  DB: D1Database;
  CORPUS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
  API_URL: string;
  FRONTEND_URL: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};
```

---

## Part 3: Operational Considerations

### 3.1 Environments

| Aspect | Preview | Production |
|--------|---------|------------|
| Domain | Auto-generated or custom | `media.devpad.tools` |
| D1 Database | `media-timeline-db-preview` | `media-timeline-db` |
| R2 Bucket | `media-timeline-corpus-preview` | `media-timeline-corpus` |
| Cron | Enabled (5 min) | Enabled (5 min) |

### 3.2 Rollback Strategies

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

---

## Appendix A: OAuth Redirect URIs

### Production

| Platform | Redirect URI |
|----------|--------------|
| Reddit | `https://media.devpad.tools/media/api/auth/reddit/callback` |
| Twitter | `https://media.devpad.tools/media/api/auth/twitter/callback` |
| GitHub | `https://media.devpad.tools/media/api/auth/github/callback` |

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
- **Workers R2 Storage**: Edit
- **D1**: Edit
- **Zone Settings**: Read
- **DNS**: Edit (for custom domains)
