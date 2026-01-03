# Media Timeline - Implementation Plan

## Executive Summary

The Media Timeline project is a **well-architected, production-ready Cloudflare Worker** that aggregates activity from multiple platforms (GitHub, Bluesky, YouTube, Devpad, Reddit, Twitter) into a unified chronological timeline. The core functionality is **fully implemented** with comprehensive test coverage using in-memory backends.

### Project Maturity: **~95% Complete**

The following core features are fully implemented and tested:
- Multi-platform data aggregation (6 platforms: GitHub, Bluesky, YouTube, Devpad, Reddit, Twitter/X)
- Versioned storage with content-addressed deduplication (@f0rbit/corpus)
- **Profiles system with account ownership** (accounts belong to profiles, not users directly)
- **Devpad authentication** (session cookies + API key validation)
- Rate limiting with circuit breaker pattern
- Token encryption at rest (AES-GCM-256)
- API key authentication
- Cron-based data fetching (every 5 minutes)
- Timeline grouping (commits by repo/day, date grouping)
- OAuth flows for Reddit, Twitter/X, and GitHub (PKCE)
- Connections UI with platform cards, settings, pause/resume functionality
- **Profile filters** (include/exclude by repo, subreddit, keyword, twitter_account)
- **Landing page** with hero, features, how-it-works, timeline preview, CTA sections
- **Dashboard** with stats, platform distribution, activity chart, content types, recent activity
- **GitHub commit/PR fetching** with per-repo stores and PR-commit deduplication
- Structured logging with `createLogger`

**What remains**: OAuth for YouTube, additional platforms (Mastodon, Linear, Notion), search, export, and operational tooling.

---

## Feature Status Matrix

### Core Features (All Implemented)

| Feature | Status | Notes |
|---------|--------|-------|
| GitHub Provider | **Implemented** | Multi-repo commits/PRs with separate stores per repo |
| Bluesky Provider | **Implemented** | AT Protocol feed fetching |
| YouTube Provider | **Implemented** | Playlist items API |
| Devpad Provider | **Implemented** | Tasks API |
| Reddit Provider | **Implemented** | OAuth, posts, comments, timeline normalization |
| Twitter/X Provider | **Implemented** | OAuth PKCE, tweets, timeline normalization |
| Memory Providers (testing) | **Implemented** | All 6 platforms with error simulation |
| Timeline Normalization | **Implemented** | Platform -> TimelineItem conversion |
| Commit Grouping | **Implemented** | Groups commits by repo+date |
| Date Grouping | **Implemented** | Groups entries by date |
| Versioned Storage | **Implemented** | @f0rbit/corpus with D1+R2 backend |
| Content Deduplication | **Implemented** | SHA-256 content hashing |
| Parent References | **Implemented** | Lineage tracking in timeline |
| Token Encryption | **Implemented** | AES-GCM-256 with PBKDF2 |
| Devpad Auth Integration | **Implemented** | Session cookies + API keys via devpad.tools |
| Profiles System | **Implemented** | Users own profiles, profiles own accounts |
| Profile Filters | **Implemented** | Include/exclude by repo, subreddit, keyword, twitter_account |
| Rate Limiting | **Implemented** | Per-account tracking, headers parsing |
| Circuit Breaker | **Implemented** | 3 failure threshold, 5 min cooldown |
| Cron Job | **Implemented** | 5-minute schedule, parallel processing |
| Timeline API | **Implemented** | GET /api/v1/profiles/:slug/timeline |
| Profile API | **Implemented** | CRUD for profiles and filters |
| Connections API | **Implemented** | CRUD for accounts |
| SST Infrastructure | **Implemented** | D1, R2, Worker, Secrets |
| Landing Page | **Implemented** | Hero, features, how-it-works, timeline preview, CTA |
| Dashboard | **Implemented** | Stats, charts, activity visualization |
| Structured Logging | **Implemented** | createLogger utility with debug/info/warn/error |

### Remaining Features

| Feature | Status | Priority | Complexity |
|---------|--------|----------|------------|
| **Planned Platforms** | | | |
| Mastodon (ActivityPub) | Not Started | Medium | Medium (~200 LOC) |
| LinkedIn (Posts/Articles) | Not Started | Low | High (~300 LOC) |
| Notion (Page updates) | Not Started | Low | Medium (~200 LOC) |
| Linear (Issue updates) | Not Started | Medium | Medium (~200 LOC) |
| **Feature Extensions** | | | |
| YouTube OAuth Flow | Not Started | Medium | Medium (~150 LOC) |
| Search (Full-text) | Not Started | Medium | High (~400 LOC) |
| Export (JSON/CSV) | Not Started | Low | Low (~100 LOC) |
| **Technical Improvements** | | | |
| Refresh Token Rotation | Not Started | Medium | Medium (~200 LOC) |
| Incremental Sync | Not Started | Medium | High (~400 LOC) |
| Edge Caching | Not Started | Low | Medium (~150 LOC) |
| **Infrastructure** | | | |
| Alerts (High failure rates) | Not Started | Medium | Low (~100 LOC) |
| Admin UI | Not Started | Low | High (~800 LOC) |

---

## Completed This Session

The following major features were completed during this session:

### 1. Profiles System Redesign (Complete)
- **Schema changes**: `profile_id` foreign key on accounts, removed `accountMembers` and `profileVisibility` tables
- **Ownership model**: Users → Profiles → Accounts (simplified from previous 3-table model)
- **Profile CRUD**: Full API for creating, reading, updating, deleting profiles
- **Profile filters**: Include/exclude filtering by repo, subreddit, keyword, twitter_account
- **Profile timeline**: `GET /api/v1/profiles/:slug/timeline` with filtering

### 2. Devpad Authentication (Complete)
- **Session cookie auth**: Validates via devpad.tools `/api/auth/verify`
- **API key auth**: Bearer token validation via devpad API
- **User sync**: Creates/updates local user on first auth
- **Middleware**: `devpadAuthMiddleware` for protected routes

### 3. GitHub Commit/PR Fetching Redesign (Complete)
- **Multi-store architecture**: Separate stores per repo (`github/{account_id}/commits/{owner}/{repo}`)
- **Schema files**: `github-meta.ts`, `github-commits.ts`, `github-prs.ts`
- **PR-commit deduplication**: Excludes commits that belong to PRs from timeline
- **Merge logic**: Incremental merging of new commits/PRs with existing data

### 4. Landing Page (Complete)
- **Components**: HeroSection, FeaturesSection, HowItWorksSection, TimelinePreviewSection, CTASection
- **Animations**: PlatformOrbit.tsx with floating platform icons
- **Timeline preview**: Mock timeline data display
- **Styling**: landing.css with gradients, glassmorphism effects

### 5. Dashboard (Complete)
- **Components**: Dashboard, StatCard, DashboardStats, PlatformDistribution, ActivityChart, ContentTypeList, RecentActivity
- **Analytics utilities**: `calculateDashboardStats`, `calculatePlatformDistribution`, `calculateActivityByDay`, `calculateContentTypes`
- **Activity heatmap**: Weekly activity visualization similar to GitHub contribution graph

### 6. Test Coverage (Complete)
- **204 tests passing**
- **Test files**: `devpad-auth.test.ts`, `profiles-timeline.test.ts`, `github-oauth.test.ts`, plus existing tests updated

---

## Remaining Implementation Tasks

### Priority 1: Medium-term Features

#### Task: YouTube OAuth Flow
**Complexity**: Medium (~150 LOC) | **Parallel**: Yes

Currently YouTube uses manual token entry. Implement OAuth2 flow:
1. OAuth state management (~30 LOC)
2. YouTube OAuth2 flow with `oauth-helpers.ts` pattern (~80 LOC)
3. Token storage and refresh (~40 LOC)

**Files to modify**:
- `src/routes.ts` - Add YouTube OAuth routes

---

#### Task: Refresh Token Rotation
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes

Automatically refresh expired OAuth tokens:
1. Check `token_expires_at` before fetch (~50 LOC)
2. Platform-specific refresh logic (~100 LOC)
3. Update account record on refresh (~50 LOC)

**Files to modify**:
- `src/cron.ts`
- `src/refresh-service.ts`

---

### Priority 2: Additional Platforms (Parallelizable)

#### Task: Mastodon Provider
**Complexity**: Medium (~200 LOC)

1. Create Mastodon schema types (~40 LOC)
2. Implement MastodonProvider class (~80 LOC)
3. Implement normalizer (~40 LOC)
4. Create MastodonMemoryProvider (~30 LOC)
5. Add tests (~50 LOC)

---

#### Task: Linear Provider
**Complexity**: Medium (~200 LOC)

1. Create Linear schema types (~40 LOC)
2. Implement LinearProvider class (GraphQL API) (~100 LOC)
3. Implement normalizer (~30 LOC)
4. Create LinearMemoryProvider (~30 LOC)

---

### Priority 3: Data Access Features

#### Task: Export (JSON/CSV)
**Complexity**: Low (~100 LOC)

1. Add export route: `GET /api/v1/profiles/:slug/timeline/export?format=json|csv` (~60 LOC)
2. Implement CSV serializer for timeline data (~40 LOC)

---

#### Task: Search (Full-text)
**Complexity**: High (~400 LOC)

**APPROVAL REQUIRED**: Search strategy decision needed.
Options:
- D1 FTS5 (if supported)
- Cloudflare Vectorize
- Simple LIKE queries (limited)

---

## Test Coverage Status

| Test File | Coverage Area | Status |
|-----------|---------------|--------|
| `api-routes.test.ts` | HTTP endpoints, auth, CRUD | Complete |
| `cron-workflow.test.ts` | Cron job, provider factory, timeline gen | Complete |
| `multi-tenant.test.ts` | Account sharing, isolation, permissions | Complete |
| `resilience.test.ts` | Rate limiting, circuit breaker, errors | Complete |
| `timeline-consistency.test.ts` | Grouping, sorting, dedup, normalizers | Complete |
| `devpad-auth.test.ts` | Devpad session/API key auth | Complete |
| `profiles-timeline.test.ts` | Profile CRUD, filters, timeline generation | Complete |
| `github-oauth.test.ts` | GitHub OAuth flow | Complete |
| `connections-settings.test.ts` | Connection settings management | Complete |
| `reddit-workflow.test.ts` | Reddit OAuth and timeline | Complete |

**Total: 204 tests passing**

---

## Summary

The Media Timeline project is essentially feature-complete for its core functionality. All planned features from the original documents have been implemented:

- ✅ Profiles system with account ownership redesign
- ✅ Devpad authentication integration
- ✅ GitHub commit/PR multi-store architecture
- ✅ Landing page
- ✅ Dashboard with analytics
- ✅ Profile filters
- ✅ All 6 platform providers

**Remaining work** is primarily:
1. YouTube OAuth (medium priority)
2. Refresh token rotation (medium priority)
3. Additional platforms: Mastodon, Linear (low priority)
4. Export functionality (low priority)
5. Search (requires approval)

Total estimated effort for remaining features: **~1,200 LOC** / **2-3 weeks** with 1 developer.
