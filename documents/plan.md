# Media Timeline - Implementation Plan

## Executive Summary

The Media Timeline project is a **well-architected, production-ready Cloudflare Worker** that aggregates activity from multiple platforms (GitHub, Bluesky, YouTube, Devpad) into a unified chronological timeline. The core functionality is **fully implemented** with comprehensive test coverage using in-memory backends.

### Project Maturity: **~90% Complete**

The following core features are fully implemented and tested:
- Multi-platform data aggregation (6 platforms: GitHub, Bluesky, YouTube, Devpad, Reddit, Twitter/X)
- Versioned storage with content-addressed deduplication (@f0rbit/corpus)
- Multi-tenant support with role-based access
- Rate limiting with circuit breaker pattern
- Token encryption at rest (AES-GCM-256)
- API key authentication
- Cron-based data fetching (every 5 minutes)
- Timeline grouping (commits by repo/day, date grouping)
- OAuth flows for Reddit and Twitter/X (PKCE)
- Connections UI with platform cards, settings, pause/resume functionality
- Partial filters implementation (hidden repos for GitHub, hidden subreddits for Reddit)

**What remains**: OAuth flows for remaining platforms (GitHub, YouTube), additional platforms (Mastodon, Linear, Notion), full filter support, search, export, analytics, and operational tooling.

---

## Feature Status Matrix

### Core Features

| Feature | Status | Notes |
|---------|--------|-------|
| GitHub Provider | **Implemented** | Events API, PushEvent normalization |
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
| API Key Authentication | **Implemented** | SHA-256 hashed keys |
| Multi-tenant | **Implemented** | Owner/member roles, shared accounts |
| Rate Limiting | **Implemented** | Per-account tracking, headers parsing |
| Circuit Breaker | **Implemented** | 3 failure threshold, 5 min cooldown |
| Cron Job | **Implemented** | 5-minute schedule, parallel processing |
| Timeline API | **Implemented** | GET /api/v1/timeline/:user_id |
| Raw Data API | **Implemented** | GET /api/v1/timeline/:user_id/raw/:platform |
| Connections API | **Implemented** | CRUD for accounts + members |
| SST Infrastructure | **Implemented** | D1, R2, Worker, Secrets |

### Planned Features (README TODOs)

| Feature | Status | Priority | Complexity |
|---------|--------|----------|------------|
| **Planned Platforms** | | | |
| Mastodon (ActivityPub) | Not Started | Medium | Medium (~200 LOC) |
| LinkedIn (Posts/Articles) | Not Started | Low | High (~300 LOC) |
| Notion (Page updates) | Not Started | Low | Medium (~200 LOC) |
| Linear (Issue updates) | Not Started | Medium | Medium (~200 LOC) |
| **Feature Extensions** | | | |
| OAuth Flows (Web UI) | **Partial** | High | High (~500 LOC) | Reddit & Twitter implemented; GitHub/YouTube pending |
| Connections UI | **Implemented** | High | Medium (~400 LOC) | Platform cards, settings, pause/resume |
| Webhooks (Real-time) | Not Started | Medium | High (~400 LOC) |
| Filters (Exclude repos/channels) | **Partial** | Medium | Low (~150 LOC) | Hidden repos (GitHub), hidden subreddits (Reddit) |
| Search (Full-text) | Not Started | Medium | High (~400 LOC) |
| Export (JSON/CSV) | Not Started | Low | Low (~100 LOC) |
| Analytics (Heatmaps/trends) | Not Started | Low | Medium (~300 LOC) |
| **Technical Improvements** | | | |
| Refresh Token Rotation | Not Started | High | Medium (~200 LOC) |
| Batch Processing | Partial | Medium | Low (~100 LOC) |
| Incremental Sync | Not Started | High | High (~400 LOC) |
| Compression (R2 data) | Not Started | Low | Low (~50 LOC) |
| Edge Caching | Not Started | Medium | Medium (~150 LOC) |
| **Infrastructure** | | | |
| Observability (Logging/Metrics) | Not Started | High | Medium (~200 LOC) |
| Alerts (High failure rates) | Not Started | Medium | Low (~100 LOC) |
| Admin UI | Not Started | Low | High (~800 LOC) |
| Multi-region | Not Started | Low | Low (~50 LOC) |

---

## Implementation Plan

### Phase 1: Core Hardening (Priority: High)

These features improve reliability and developer experience for the existing system.

#### Task 1.1: Refresh Token Rotation
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes | **Dependency**: None

Automatically refresh expired OAuth tokens for platforms that support it.

**Sub-tasks**:
1. Add `token_expires_at` handling in cron job (~50 LOC)
2. Implement refresh logic per platform:
   - GitHub: App-based token refresh (~40 LOC)
   - Bluesky: Session refresh via ATP (~40 LOC)
   - YouTube: OAuth2 refresh_token flow (~40 LOC)
3. Update account record on refresh (~30 LOC)

**Files to modify**:
- `src/cron.ts` - Check expiry before fetch
- `src/platforms/*.ts` - Add refresh method to Provider interface

---

#### Task 1.2: Observability (Structured Logging)
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes | **Dependency**: None

Add structured JSON logging for debugging and monitoring.

**Sub-tasks**:
1. Create logging utility with request context (~80 LOC)
2. Add log points to cron workflow (~60 LOC)
3. Add log points to API routes (~40 LOC)
4. Configure log levels by environment (~20 LOC)

**Files to create/modify**:
- `src/logging.ts` (new)
- `src/cron.ts`
- `src/routes.ts`
- `src/auth.ts`

---

#### Task 1.3: Incremental Sync
**Complexity**: High (~400 LOC) | **Parallel**: No (depends on Task 1.1) | **Dependency**: Token rotation

Only fetch new data since last sync to reduce API calls and improve efficiency.

**Sub-tasks**:
1. Add `last_cursor`/`since_id` to accounts table (~50 LOC)
2. Modify platform providers to support cursor-based fetching:
   - GitHub: Use `If-None-Match` / event IDs (~80 LOC)
   - Bluesky: Use cursor from feed response (~60 LOC)
   - YouTube: Use `publishedAfter` param (~60 LOC)
   - Devpad: Use `since` param if available (~40 LOC)
3. Update cron to merge new data with existing (~80 LOC)
4. Handle pagination for catch-up scenarios (~50 LOC)

**Files to modify**:
- `migrations/0002_add_cursors.sql` (new)
- `src/schema/database.ts`
- `src/platforms/*.ts`
- `src/cron.ts`

---

### Phase 2: OAuth & User Experience (Priority: High)

#### Task 2.1: OAuth Flow Infrastructure
**Complexity**: High (~500 LOC) | **Parallel**: Yes | **Dependency**: None

Web-based OAuth flows for connecting accounts without manual token entry.

**Sub-tasks**:
1. Add OAuth state management:
   - Create `oauth_states` table (~30 LOC)
   - Add state generation/validation utils (~50 LOC)
2. Implement OAuth routes:
   - `GET /oauth/:platform/start` - Redirect to platform (~80 LOC)
   - `GET /oauth/:platform/callback` - Handle callback (~100 LOC)
3. Platform-specific OAuth handlers:
   - GitHub OAuth App flow (~60 LOC)
   - Bluesky doesn't use OAuth (skip)
   - YouTube OAuth2 flow (~80 LOC)
4. Frontend redirect handling (~50 LOC)
5. Tests for OAuth flows (~50 LOC)

**Files to create**:
- `src/oauth.ts` (new)
- `migrations/0002_oauth_states.sql` (new)

**Files to modify**:
- `src/index.ts` - Mount OAuth routes
- `src/routes.ts` - Or create separate oauth routes file

**APPROVAL REQUIRED**: OAuth requires understanding of:
- Which platforms to prioritize (GitHub, YouTube most complex)
- Callback URL strategy (custom domain vs worker URL)
- Session/cookie handling for web flow

---

#### Task 2.2: Filters (Exclude Repos/Channels)
**Complexity**: Low (~150 LOC) | **Parallel**: Yes | **Dependency**: None

Allow users to filter out specific repos, channels, or content types.

**Sub-tasks**:
1. Add `filters` JSON column to `account_members` or new table (~30 LOC)
2. Create filter schema (Zod) (~40 LOC)
3. Apply filters during timeline generation (~50 LOC)
4. API endpoints to manage filters (~30 LOC)

**Files to modify**:
- `src/schema/database.ts`
- `src/cron.ts` - Apply filters
- `src/routes.ts` - Add filter endpoints

---

### Phase 3: Additional Platforms (Priority: Medium)

These can be done in parallel by different developers.

#### Task 3.1: Mastodon Provider
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Create Mastodon schema types (~40 LOC)
2. Implement MastodonProvider class (~80 LOC)
3. Implement normalizer (~40 LOC)
4. Create MastodonMemoryProvider (~30 LOC)
5. Add tests (~50 LOC - fixtures + integration)

**Files to create**:
- `src/platforms/mastodon.ts`
- `src/schema/platforms.ts` - Add Mastodon types

---

#### Task 3.2: Linear Provider
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Create Linear schema types (~40 LOC)
2. Implement LinearProvider class (GraphQL API) (~100 LOC)
3. Implement normalizer (~30 LOC)
4. Create LinearMemoryProvider (~30 LOC)
5. Add tests (~50 LOC)

**Files to create**:
- `src/platforms/linear.ts`

---

#### Task 3.3: Notion Provider
**Complexity**: Medium (~200 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Create Notion schema types (~50 LOC)
2. Implement NotionProvider class (~80 LOC)
3. Implement normalizer (~40 LOC)
4. Create NotionMemoryProvider (~30 LOC)
5. Add tests (~50 LOC)

**Files to create**:
- `src/platforms/notion.ts`

---

### Phase 4: Data Access Features (Priority: Medium)

#### Task 4.1: Export (JSON/CSV)
**Complexity**: Low (~100 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Add `GET /api/v1/timeline/:user_id/export?format=json|csv` route (~60 LOC)
2. Implement CSV serializer for timeline data (~40 LOC)

**Files to modify**:
- `src/routes.ts`

---

#### Task 4.2: Search (Full-text)
**Complexity**: High (~400 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Decide on search strategy:
   - Option A: D1 FTS5 (if supported) (~100 LOC)
   - Option B: Cloudflare Vectorize (~200 LOC)
   - Option C: Simple LIKE queries (limited) (~50 LOC)
2. Create search index table (~50 LOC)
3. Index timeline items during cron (~100 LOC)
4. Implement search API endpoint (~100 LOC)
5. Add tests (~50 LOC)

**APPROVAL REQUIRED**: Search strategy decision needed.

---

#### Task 4.3: Edge Caching
**Complexity**: Medium (~150 LOC) | **Parallel**: Yes | **Dependency**: None

Cache timeline responses at the edge to reduce D1/R2 reads.

**Sub-tasks**:
1. Implement cache-control headers based on timeline version (~40 LOC)
2. Add Cache API integration for timeline responses (~60 LOC)
3. Cache invalidation on timeline update (~50 LOC)

**Files to modify**:
- `src/routes.ts`
- `src/cron.ts` - Invalidate cache on update

---

### Phase 5: Analytics & Admin (Priority: Low)

#### Task 5.1: Analytics (Activity Heatmaps)
**Complexity**: Medium (~300 LOC) | **Parallel**: Yes | **Dependency**: None

**Sub-tasks**:
1. Create analytics aggregation during cron (~100 LOC)
2. Store daily/weekly summaries (~50 LOC)
3. Add analytics API endpoints (~100 LOC)
4. Add tests (~50 LOC)

**Files to create**:
- `src/analytics.ts`

---

#### Task 5.2: Alerts (High Failure Rates)
**Complexity**: Low (~100 LOC) | **Parallel**: Yes | **Dependency**: Task 1.2 (Observability)

**Sub-tasks**:
1. Add failure rate calculation in cron (~40 LOC)
2. Integrate with external alert service (webhook) (~60 LOC)

---

#### Task 5.3: Admin UI
**Complexity**: High (~800 LOC) | **Parallel**: Yes | **Dependency**: Task 1.2

Likely a separate project/package for admin interface.

**Sub-tasks**:
1. Design admin API endpoints (~200 LOC)
2. Implement user management (~100 LOC)
3. Implement system health views (~100 LOC)
4. Build minimal UI (or CLI) (~400 LOC)

**APPROVAL REQUIRED**: Admin UI scope and technology choice.

---

## Architectural Recommendations

### 1. Testing Architecture (Already Good)

The project follows excellent testing practices:
- In-memory implementations for all providers
- In-memory D1 (bun:sqlite) and R2 (Map-based)
- In-memory corpus backend
- Integration tests cover user workflows

**Recommendation**: Continue this pattern for new features. Each new platform should include:
- `PlatformMemoryProvider` class
- Fixture factories in `__tests__/integration/fixtures.ts`
- Integration tests in cron-workflow.test.ts

### 2. Provider Interface Extension

For incremental sync (Task 1.3), consider extending the Provider interface:

```typescript
interface Provider<TRaw> {
  readonly platform: string;
  fetch(token: string, cursor?: string): Promise<FetchResult<{ data: TRaw; cursor?: string }>>;
  refresh?(refreshToken: string): Promise<FetchResult<{ access_token: string; refresh_token?: string }>>;
}
```

### 3. Schema Evolution

Use D1 migrations for schema changes. The existing `migrations/0001_init.sql` pattern should continue.

### 4. Monorepo Consideration

The current flat structure works well for the project size. If complexity grows significantly (OAuth, Admin UI), consider:

```
packages/
├── core/          # Shared types, utils, storage
├── worker/        # Cloudflare Worker (current src/)
├── admin-api/     # Admin API routes
└── admin-ui/      # Frontend (if needed)
```

**Current recommendation**: Stay with flat structure until Admin UI is prioritized.

---

## Task Dependency Graph

```
                    ┌──────────────────┐
                    │ Task 1.1         │
                    │ Token Rotation   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Task 1.3         │
                    │ Incremental Sync │
                    └──────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Task 1.2         │    │ Task 2.1         │    │ Task 2.2         │
│ Observability    │    │ OAuth Flows      │    │ Filters          │
└────────┬─────────┘    └──────────────────┘    └──────────────────┘
         │
         ▼
┌──────────────────┐
│ Task 5.2         │
│ Alerts           │
└──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              PARALLELIZABLE (No dependencies)                    │
├──────────────────┬──────────────────┬──────────────────────────┤
│ Task 3.1         │ Task 3.2         │ Task 3.3                 │
│ Mastodon         │ Linear           │ Notion                   │
├──────────────────┼──────────────────┼──────────────────────────┤
│ Task 4.1         │ Task 4.3         │ Task 5.1                 │
│ Export           │ Edge Caching     │ Analytics                │
└──────────────────┴──────────────────┴──────────────────────────┘

┌──────────────────┐
│ Task 4.2         │ ← Requires approval on search strategy
│ Search           │
└──────────────────┘

┌──────────────────┐
│ Task 5.3         │ ← Requires approval on scope
│ Admin UI         │
└──────────────────┘
```

---

## Implementation Priority Order

### Immediate (Next Sprint)
1. **Task 1.2: Observability** - Low effort, high value for debugging
2. **Task 1.1: Token Rotation** - Prevents auth failures
3. **Task 2.2: Filters** - Low effort, user-requested feature

### Short-term (2-4 weeks)
4. **Task 1.3: Incremental Sync** - Reduces API calls significantly
5. **Task 4.1: Export** - Low effort, completes data access story
6. **Task 3.1: Mastodon** - Popular platform, moderate effort

### Medium-term (1-2 months)
7. **Task 2.1: OAuth Flows** - Major UX improvement (requires approval)
8. **Task 3.2: Linear** - Developer audience overlap
9. **Task 4.3: Edge Caching** - Performance optimization

### Long-term (Backlog)
10. **Task 4.2: Search** (needs approval)
11. **Task 5.1: Analytics**
12. **Task 3.3: Notion**
13. **Task 5.2: Alerts**
14. **Task 5.3: Admin UI** (needs approval)

---

## Limitations & Notes

1. **Twitter/X**: ~~API access is restricted and expensive. Deprioritized unless API access is confirmed.~~ **Now implemented** with OAuth PKCE flow and tweet timeline normalization.

2. **LinkedIn**: API requires OAuth App approval and has strict usage policies. Consider only if business use case exists.

3. **Batch Processing**: Already implemented via `Promise.allSettled` in cron. No further work needed unless scale issues arise.

4. **Multi-region**: Cloudflare Workers already run globally. No additional work needed for basic multi-region. Only relevant if region-specific D1 is desired.

5. **Compression**: R2 already stores data efficiently. Only implement if storage costs become significant.

---

## Test Coverage Status

| Test File | Coverage Area | Status |
|-----------|---------------|--------|
| `api-routes.test.ts` | HTTP endpoints, auth, CRUD | Complete |
| `cron-workflow.test.ts` | Cron job, provider factory, timeline gen | Complete |
| `multi-tenant.test.ts` | Account sharing, isolation, permissions | Complete |
| `resilience.test.ts` | Rate limiting, circuit breaker, errors | Complete |
| `timeline-consistency.test.ts` | Grouping, sorting, dedup, normalizers | Complete |

**Estimated coverage**: 80%+ on core paths

**Missing coverage** (acceptable):
- Real HTTP provider tests (require mocking fetch)
- Edge cases in encryption/decryption
- Migration scripts

---

## Summary

The Media Timeline project is in excellent shape with **~90% completion**. The core architecture is solid, tested, and production-ready. Major milestones recently completed include:

- **Reddit Provider**: Full implementation with OAuth flow, posts, comments, and hidden subreddits filter
- **Twitter/X Provider**: Full implementation with OAuth PKCE, tweets, and timeline normalization
- **Connections UI**: Complete with platform cards, settings management, pause/resume functionality
- **Partial Filters**: Hidden repos for GitHub, hidden subreddits for Reddit

The remaining work is primarily **feature extensions** rather than foundational changes.

**Recommended next actions**:
1. Implement Task 1.2 (Observability) - 1-2 days
2. Implement Task 1.1 (Token Rotation) - 2-3 days  
3. Complete filters for remaining platforms - 1 day
4. Implement OAuth for GitHub and YouTube - 2-3 days

Total estimated effort for all remaining features: **~2,500 LOC** / **4-5 weeks** with 1-2 developers.
