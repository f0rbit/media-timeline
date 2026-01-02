# Media Timeline - High-Impact Refactoring Plan

> Generated: 2026-01-02
> Status: Pre-production, no backwards compatibility concerns

## Executive Summary

After analyzing the entire codebase, I've identified several significant opportunities to simplify the architecture. The project has evolved through iterations and accumulated some complexity that can be reduced now that we have no backwards compatibility concerns.

**Total Potential Reduction:** ~1,000 lines (~15% of server package)

---

## Priority 1: Critical Simplifications

### 1.1 Duplicate Auth Middleware - Consolidate `auth.ts` and `devpad-auth.ts`

**Current State:**
- Two separate auth files with 540+ combined lines
- `auth.ts` (290 lines) - the main auth middleware
- `devpad-auth.ts` (252 lines) - newer DevPad-specific auth
- Both files duplicate: `extractJWTFromAuthHeader()`, `extractBearerToken()`, `getDevpadUrl()`, user syncing logic
- Both define their own `DevpadUser` type (lines 28-34 in auth.ts, lines 11-17 in devpad-auth.ts)
- Both have `JWT_PREFIX`, `DEFAULT_DEVPAD_URL` constants

**Proposed Solution:**
Merge into a single `auth.ts` with:
- One middleware that handles all auth methods
- Shared helper functions
- Single set of types

**Impact:**
- ~150 lines of code reduction
- Single source of truth for authentication
- Easier to maintain and reason about

**Risk:** Low - the logic is already nearly identical

**Files to modify:**
- `packages/server/src/auth.ts`
- `packages/server/src/devpad-auth.ts` (delete)
- `packages/server/src/index.ts` (update exports)

---

### 1.2 Schema Files Explosion - Consolidate Platform Schemas

**Current State:**
```
packages/schema/src/
├── github-commits.ts   # 37 lines
├── github-meta.ts      # 44 lines  
├── github-prs.ts       # 35 lines
├── reddit-comments.ts  # 38 lines
├── reddit-meta.ts      # 22 lines
├── reddit-posts.ts     # 44 lines
├── twitter-meta.ts     # 47 lines
├── twitter-tweets.ts   # 90 lines
└── index.ts            # 194 lines of re-exports!
```

Each platform has 2-4 tiny files that could be one. The `index.ts` is 194 lines of pure re-exports.

**Proposed Solution:**
Consolidate per-platform:
```
packages/schema/src/
├── platforms/
│   ├── github.ts    # All GitHub schemas
│   ├── reddit.ts    # All Reddit schemas  
│   ├── twitter.ts   # All Twitter schemas
│   └── index.ts     # Single barrel export
├── database.ts
├── timeline.ts
└── index.ts         # Much simpler
```

**Impact:**
- Reduce from 12+ files to 6-7
- `index.ts` from 194 lines → ~50 lines
- Easier navigation, better cohesion

**Risk:** Low - structural change only

**Files to modify:**
- Create `packages/schema/src/platforms/` directory
- Create consolidated platform files
- Delete individual platform files
- Update `packages/schema/src/index.ts`

---

### 1.3 Timeline Processing Files Duplication

**Current State:**
```
packages/server/src/
├── timeline.ts         # Timeline grouping (201 lines)
├── timeline-github.ts  # GitHub normalization (120 lines)
├── timeline-reddit.ts  # Reddit normalization (95 lines)
├── timeline-twitter.ts # Twitter normalization (74 lines)
├── timeline-profile.ts # Profile timeline generation
```

Each `timeline-{platform}.ts` follows the same pattern:
1. `loadXXXDataForAccount()` - loads from corpus stores
2. `normalizeXXX()` - converts to `TimelineItem[]`

**Proposed Solution:**
Create a single normalized structure:
```typescript
// timeline/normalizers.ts
const normalizers: Record<Platform, NormalizeFunction> = {
  github: normalizeGitHub,
  reddit: normalizeReddit,
  twitter: normalizeTwitter,
  // ...
}

// timeline/loaders.ts  
const loaders: Record<Platform, LoadFunction> = {
  github: loadGitHubData,
  reddit: loadRedditData,
  twitter: loadTwitterData,
}
```

**Impact:**
- ~100 lines reduction through pattern consolidation
- Easier to add new platforms
- Single place to understand the normalization contract

**Risk:** Low - refactoring internal structure

**Files to modify:**
- Create `packages/server/src/timeline/` directory
- Consolidate timeline files into directory
- Update imports throughout server package

---

## Priority 2: Significant Improvements

### 2.1 Cron Processing Files Duplication

**Current State:**
```
cron.ts         (604 lines) - main orchestrator
cron-github.ts  (169 lines)
cron-reddit.ts  (130 lines)  
cron-twitter.ts (97 lines)
```

All three platform crons follow identical patterns:
1. Fetch from provider
2. Merge with existing data
3. Store meta + content stores

**Proposed Solution:**
Extract a generic `processPlatformAccount()` that takes:
- Provider instance
- Merge strategy
- Store configuration

```typescript
// cron/platform-processor.ts
type PlatformProcessor<TFetch, TStore> = {
  fetch: (token: string) => Promise<Result<TFetch, ProviderError>>;
  merge: (existing: TStore | null, incoming: TFetch) => TStore;
  stores: StoreConfig[];
};

export const processAccount = async <T, S>(
  backend: Backend,
  accountId: string, 
  token: string,
  processor: PlatformProcessor<T, S>
): Promise<Result<ProcessResult, ProcessError>> => {
  // Generic implementation
};
```

**Impact:**
- ~200 lines reduction
- Single tested code path
- Trivial to add new platforms

**Risk:** Medium - need to ensure type safety across platforms

**Files to modify:**
- Create `packages/server/src/cron/` directory
- Create generic processor
- Refactor platform-specific cron files
- Update `cron.ts` to use new structure

---

### 2.2 Storage.ts Over-Engineering

**Current State:**
`storage.ts` is 317 lines with:
- 10 different store ID types (`RawStoreId`, `TimelineStoreId`, `GitHubMetaStoreId`, etc.)
- 10 create functions (`createRawStore`, `createTimelineStore`, `createGitHubMetaStore`, etc.)
- 10 store ID helper functions (`rawStoreId`, `timelineStoreId`, `githubMetaStoreId`, etc.)
- Rate limit state management (doesn't belong here)

**Proposed Solution:**
1. Split rate limiting into `rate-limits.ts`
2. Create a generic store factory:
```typescript
// storage.ts - simplified
const createStore = <T>(backend: Backend, storeId: string, schema: Parser<T>) => 
  createTypedStore(backend, storeId, schema);

// Store ID patterns as a simple map
const STORE_PATTERNS = {
  raw: (platform: string, accountId: string) => `media/raw/${platform}/${accountId}`,
  timeline: (userId: string) => `media/timeline/${userId}`,
  githubMeta: (accountId: string) => `media/github/${accountId}/meta`,
  // ...
};
```

**Impact:**
- ~100 lines reduction
- Cleaner separation of concerns
- Rate limiting logic in appropriate location

**Risk:** Low - internal restructuring

**Files to modify:**
- `packages/server/src/storage.ts`
- Create `packages/server/src/rate-limits.ts`
- Update imports in cron files

---

### 2.3 API Routes Have Too Much Logic

**Current State:**
Routes like `routes/connections.ts` (224 lines) contain:
- Request validation
- Auth checking
- Business logic in the delete handler (lines 94-121)
- Background task spawning

The delete handler has an inline function that regenerates timelines - this logic should be in the service layer.

**Proposed Solution:**
Move ALL business logic to services. Routes should only:
1. Parse/validate request
2. Call service function
3. Return response

```typescript
// routes/connections.ts - simplified
connectionRoutes.delete("/:account_id", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accId = accountId(c.req.param("account_id"));
  
  const result = await deleteConnectionWithTimelineRegen(ctx, userId(auth.user_id), accId);
  
  if (result.backgroundTask) {
    safeWaitUntil(c, result.backgroundTask, "connection-delete");
  }
  
  return handleResult(c, result);
});
```

**Impact:**
- Routes become thin and predictable
- Business logic is testable in isolation
- ~50 lines moved to appropriate layer

**Risk:** Low - moving code, not changing logic

**Files to modify:**
- `packages/server/src/routes/connections.ts`
- `packages/server/src/services/connections.ts`

---

### 2.4 Evaluate Corpus Tables Usage

**Current State:**
The database has:
- `media_corpus_snapshots` - tracking snapshot versions
- `media_corpus_parents` - tracking parent-child relationships

These appear to be for the Corpus library's versioning system, but looking at the actual usage, the app only ever calls `get_latest()` - it doesn't use version history or parent tracking.

**Proposed Solution:**
If we're not using corpus versioning features:
1. Remove these tables from the schema
2. Simplify to just storing the latest data in R2
3. Or keep using Corpus but acknowledge these tables are for library internals

**Impact:**
- Simpler schema if we don't need versioning
- Fewer tables to worry about

**Risk:** High - need to verify Corpus library requirements

**Action Required:** Investigate Corpus library requirements before proceeding

---

## Priority 3: Nice-to-Have Improvements

### 3.1 Frontend API Client Duplication

**Current State:**
```
apps/website/src/utils/
├── api.ts        (58 lines) - base URL helpers + fetchApi
├── api-client.ts (201 lines) - typed API calls
├── api-server.ts (53 lines) - server-side fetching
```

Three files for what could be one. `api-server.ts` duplicates logic from `api-client.ts`.

**Proposed Solution:**
Single `api.ts` with:
- Isomorphic fetch wrapper
- Typed endpoint functions
- SSR-compatible auth handling

**Impact:**
- ~100 lines reduction
- Single API interface
- Easier to keep client/server in sync

**Risk:** Low

**Files to modify:**
- Consolidate into single `apps/website/src/utils/api.ts`
- Update imports throughout website

---

### 3.2 Evaluate `apiKeys` Table

**Current State:**
The `media_api_keys` table exists for API key authentication, but the app primarily uses DevPad JWT authentication. API keys seem to be a legacy/alternative auth method that may not be needed.

**Proposed Solution:**
If DevPad auth is the primary auth:
1. Remove `apiKeys` table
2. Remove API key validation from `auth.ts`
3. Simplify auth to just DevPad JWT/cookie

**Impact:**
- Simpler auth flow
- Fewer tables
- ~50 lines in auth.ts

**Risk:** Medium - need to verify API keys aren't used in production

**Action Required:** Verify API key usage before proceeding

---

### 3.3 Platform Registry Unification

**Current State:**
`platforms/registry.ts` defines `PLATFORM_REGISTRY` with capabilities, but:
- `cron.ts` has its own `getPlatformProcessor()` switch statement
- Provider factory pattern is separate
- Each platform is configured in multiple places

**Proposed Solution:**
Unify platform configuration:
```typescript
// platforms/registry.ts - single source of truth
export const PLATFORM_REGISTRY: Record<Platform, PlatformConfig> = {
  github: {
    ...capabilities,
    provider: (config) => new GitHubProvider(config),
    normalizer: normalizeGitHub,
    loader: loadGitHubData,
    cronProcessor: processGitHubAccount,
  },
  // ...
};
```

**Impact:**
- Adding a platform = adding one config object
- Removes multiple switch statements
- Single place for platform behavior

**Risk:** Low

**Files to modify:**
- `packages/server/src/platforms/registry.ts`
- `packages/server/src/cron.ts`
- Platform-specific files

---

## Summary Table

| Priority | Issue | Lines Saved | Complexity Reduction | Risk |
|----------|-------|-------------|---------------------|------|
| P1 | Merge auth files | ~150 | High | Low |
| P1 | Consolidate schema files | ~100 | High | Low |
| P1 | Merge timeline-{platform} files | ~100 | Medium | Low |
| P2 | Generic cron processor | ~200 | High | Medium |
| P2 | Simplify storage.ts | ~100 | Medium | Low |
| P2 | Thin route handlers | ~50 | Medium | Low |
| P2 | Evaluate corpus tables | ~30 | Low | High |
| P3 | Merge frontend API files | ~100 | Medium | Low |
| P3 | Evaluate API keys table | ~50 | Low | Medium |
| P3 | Unified platform registry | ~100 | High | Low |

---

## Things That Are Fine As-Is

After review, these areas are appropriately structured:

1. **Test Infrastructure** - The `setup.ts` and `test-builder.ts` pattern is excellent for integration testing
2. **Service Layer** - Good separation, just needs routes to fully delegate to it
3. **Memory Providers** - Well-structured for testing different platforms
4. **Result/Error Types** - Using `@f0rbit/corpus` Result type consistently
5. **Database Schema** - Core tables are well-designed with appropriate indexes

---

## Recommended Execution Order

### Week 1: P1 Items (Low Risk, High Impact)
1. Auth consolidation (`auth.ts` + `devpad-auth.ts`)
2. Schema consolidation (platform files)
3. Timeline files consolidation

### Week 2: P2 Items (Medium Risk, High Impact)
1. Cron processor generification
2. Storage.ts cleanup + rate-limits extraction
3. Route handler cleanup

### Week 3: P3 Items + Investigation
1. Frontend API consolidation
2. Platform registry unification
3. **Investigate:** Corpus tables usage
4. **Investigate:** API keys necessity

---

## Checklist

- [ ] P1.1: Consolidate auth middleware
- [ ] P1.2: Consolidate schema platform files
- [ ] P1.3: Consolidate timeline processing files
- [ ] P2.1: Create generic cron processor
- [ ] P2.2: Simplify storage.ts
- [ ] P2.3: Move business logic from routes to services
- [ ] P2.4: Investigate corpus tables
- [ ] P3.1: Consolidate frontend API files
- [ ] P3.2: Investigate API keys table
- [ ] P3.3: Unify platform registry
