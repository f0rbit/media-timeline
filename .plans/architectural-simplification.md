# Architectural Simplification Plan - media-timeline

> **Generated:** 2026-01-05
> **Focus:** Reducing abstraction layers and "go-to-definition" jumps for debugging
> **Status:** ~50% Complete
> **Last Updated:** January 2026

---

## Implementation Progress

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Eliminate sync/ directory | ✅ Complete |
| Phase 2 | Flatten refresh-service.ts | ✅ Complete |
| Phase 3 | Inline platform registry | ✅ Complete |
| Phase 4 | Consolidate storage factories | ⏳ Pending |
| Phase 5 | Colocate platform timeline code | ⏳ Pending |

### Files Deleted
- ✅ `sync/index.ts` - merged into `sync.ts`
- ✅ `sync/account-processor.ts` - merged into `sync.ts`
- ✅ `sync/timeline-builder.ts` - merged into `sync.ts`
- ✅ `refresh-service.ts` - absorbed into `services/connections.ts`
- ✅ `platforms/registry.ts` - replaced with direct switch statements

### Changes Made
- Created `packages/server/src/sync.ts` (~521 lines) - consolidated from sync/ directory
- `sync.ts` now uses direct switch statements for platform dispatch
- Types moved to point of use: `LoadFunction` → loaders.ts, `NormalizeFunction` → normalizers.ts, `CronProcessor` → sync.ts
- `PLATFORM_CAPABILITIES` and `MULTI_STORE_PLATFORMS` inlined in sync.ts
- Removed export from `platforms/index.ts`

### Verification
- ✅ `bun run typecheck` passes
- ✅ `bun test` passes (399 tests)

---

## Executive Summary

After comprehensive codebase analysis, I've identified that the primary source of debugging friction is **over-abstraction in the data flow paths**. When an error occurs in production, developers must navigate through multiple layers of indirection:

**Current Error Tracing Path (worst case):**
```
Route → Service → Sync → CronProcessor → PlatformProcessor → Provider → Storage → Corpus
   8 files to trace a single GitHub sync error
```

**Target Error Tracing Path:**
```
Route → Service → Platform
   3 files max for any operation
```

### Key Metrics
- **Server package:** 8,279 LOC across 63 source files
- **Avg file jumps to trace error:** 5-8 files
- **Target file jumps:** 2-3 files
- **Estimated code reduction:** ~1,500 LOC (18%)

---

## Analysis: Over-Engineering Patterns Identified

### Pattern 1: Excessive Layer Splitting (CRITICAL)

**The Problem:** Business logic is scattered across too many thin layers that add indirection without adding value.

**Evidence - Connection Refresh Flow:**
```
routes/connections.ts:89  → refreshConnection()
  ↓
services/connections.ts:358 → refreshSingleAccount()  (just a delegation!)
  ↓
refresh-service.ts:251 → refreshSingleAccount() (actual logic)
  ↓
  → lookupAccount()
  → determineRefreshStrategy()
  → processGitHubRefresh() / processRedditRefresh() / processGenericRefresh()
    ↓
    sync/account-processor.ts → processAccount()
      ↓
      platforms/registry.ts → getCronProcessor()
      cron/index.ts → registered processors
      cron/processors/github.ts → processGitHubAccount()
```

**The service layer delegates to refresh-service which delegates to sync which delegates to cron processors.** This is 4 layers of abstraction for what is essentially: "fetch data from API, store it."

### Pattern 2: Registry Over-Engineering

**The Problem:** The platform registry pattern adds runtime indirection when compile-time type safety would suffice.

**Evidence - Platform Registry:**
```typescript
// platforms/registry.ts - runtime lookup
export const PLATFORM_REGISTRY: Record<Platform, PlatformConfig> = {...}
export const getCronProcessor = (platform: Platform): CronProcessor | undefined => 
  PLATFORM_REGISTRY[platform]?.cronProcessor;

// cron/index.ts - registration at module load
registerCronProcessor("github", {...});
registerCronProcessor("reddit", {...});
registerCronProcessor("twitter", {...});

// sync/account-processor.ts - runtime dispatch
const processor = getCronProcessor(platform);
if (!processor) {
  return processGenericAccount(ctx, account);
}
```

This could be a simple switch statement that's easier to debug:
```typescript
switch(platform) {
  case "github": return processGitHubAccount(ctx, account);
  case "reddit": return processRedditAccount(ctx, account);
  // ...
}
```

### Pattern 3: Unnecessary Service Delegation

**The Problem:** Service functions that just call other functions with slight signature changes.

**Evidence:**
```typescript
// services/connections.ts:358-360
export const refreshConnection = async (ctx, accountIdStr, uid) => 
  refreshSingleAccount(ctx, accountIdStr, uid);

export const refreshAllUserConnections = async (ctx, uid) => 
  refreshAllAccounts(ctx, uid);
```

These are pure delegation - zero value added.

### Pattern 4: Fragmented Storage Abstraction

**The Problem:** Storage operations are split across multiple files with too many factory functions.

**Evidence - Creating a GitHub store:**
```
storage.ts:131 → createGitHubMetaStore()
  ↓ uses
storage.ts:48 → STORE_PATTERNS.githubMeta()
  ↓ uses
storage.ts:35-43 → createTypedStore()
  ↓ uses
@f0rbit/corpus → create_corpus().with_backend().with_store().build()
```

Plus we have:
- 10 different `createXXXStore()` functions
- 10 different store ID types
- 10 store ID pattern functions

### Pattern 5: Sync/Cron Duplication

**The Problem:** Nearly identical code in `sync/` and `cron/` directories.

**Evidence:**
- `sync/account-processor.ts` - processes accounts
- `cron/index.ts` - also processes accounts
- `cron/processors/github.ts` - GitHub-specific processing
- `sync/timeline-builder.ts` - timeline generation

Both `sync` and `cron` ultimately do the same thing: fetch from provider, store data, regenerate timeline. The distinction is unclear.

### Pattern 6: Refresh Service Complexity

**The Problem:** `refresh-service.ts` (391 lines) has multiple redundant patterns.

**Evidence - Duplicate timeline regeneration:**
```typescript
// In processGitHubRefresh (line 176-179)
const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
await combineUserTimeline(ctx.backend, userId, snapshots);

// In processRedditRefresh (line 220-222) - IDENTICAL
const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
await combineUserTimeline(ctx.backend, userId, snapshots);

// In processGenericRefresh (line 241-243) - IDENTICAL
const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
await combineUserTimeline(ctx.backend, userId, snapshots);

// In refreshAllAccounts GitHub task (line 304-306) - IDENTICAL
const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
await combineUserTimeline(ctx.backend, userId, snapshots);

// In refreshAllAccounts Reddit task (line 349-351) - IDENTICAL
const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
await combineUserTimeline(ctx.backend, userId, snapshots);
```

**The same 3 lines appear 5 times!**

---

## Proposed Architecture Changes

### Change 1: ELIMINATE the sync/ directory (HIGH IMPACT)

**Current Structure:**
```
packages/server/src/
├── sync/
│   ├── index.ts              (4 lines - re-exports)
│   ├── account-processor.ts  (231 lines)
│   └── timeline-builder.ts   (227 lines)
├── cron/
│   ├── index.ts              (123 lines)
│   ├── platform-processor.ts (94 lines)
│   └── processors/
│       ├── github.ts         (136 lines)
│       ├── reddit.ts         (180 lines)
│       └── twitter.ts        (74 lines)
```

**Proposed Structure:**
```
packages/server/src/
├── sync.ts                   (~300 lines - merged account-processor + timeline-builder)
├── cron.ts                   (~150 lines - simplified, no registry)
├── platforms/
│   ├── github/
│   │   ├── provider.ts       (existing GitHubProvider)
│   │   └── processor.ts      (merged cron processor + normalizer + loader)
│   ├── reddit/
│   │   └── ...
│   └── twitter/
│       └── ...
```

**Why:** The `sync/` directory exists only to provide re-exports and minor abstractions over `cron/`. By merging:
- We eliminate the `sync/index.ts` barrel export
- We colocate account processing with timeline building
- We reduce file jumps from 4 → 2

**Estimated LOC reduction:** ~150 lines

---

### Change 2: FLATTEN refresh-service.ts into services/connections.ts (HIGH IMPACT)

**Current:**
- `services/connections.ts` → delegates to `refresh-service.ts`
- `refresh-service.ts` → 391 lines of refresh logic

**Proposed:**
- Move all refresh logic directly into `services/connections.ts`
- Eliminate `refresh-service.ts` entirely
- Extract the duplicate timeline regeneration into one helper

```typescript
// services/connections.ts - new helper
const regenerateUserTimeline = async (ctx: AppContext, userId: string) => {
  const accounts = await fetchActiveAccountsForUser(ctx.db, userId);
  const snapshots = await gatherLatestSnapshots(ctx.backend, accounts);
  await combineUserTimeline(ctx.backend, userId, snapshots);
};

// Then all refresh operations use it:
await processAccount(ctx, account);
await regenerateUserTimeline(ctx, userId);
```

**Estimated LOC reduction:** ~200 lines (5 duplicate blocks → 1)

---

### Change 3: INLINE platform registry into direct switch statements (MEDIUM IMPACT)

**Current:**
```typescript
// Multiple files involved in platform dispatch
registerCronProcessor("github", {...});
const processor = getCronProcessor(platform);
if (!processor) return processGenericAccount();
return processor.processAccount(backend, accountId, token, provider, account);
```

**Proposed:**
```typescript
// Direct dispatch in cron.ts
const processAccountForPlatform = async (ctx, account): Promise<RawSnapshot | null> => {
  const token = await decrypt(account.access_token_encrypted, ctx.encryptionKey);
  if (!token.ok) return null;
  
  switch(account.platform as Platform) {
    case "github":
      return processGitHubAccount(ctx.backend, account.id, token.value);
    case "reddit":
      return processRedditAccount(ctx.backend, account.id, token.value);
    case "twitter":
      return processTwitterAccount(ctx.backend, account.id, token.value);
    default:
      return processGenericAccount(ctx, account);
  }
};
```

**Why:** Switch statements are:
- Exhaustiveness-checked by TypeScript
- Trivial to debug (Cmd+Click goes directly to processor)
- No runtime lookup overhead
- Self-documenting

**Estimated LOC reduction:** ~50 lines

---

### Change 4: CONSOLIDATE storage factory functions (MEDIUM IMPACT)

**Current:** 10 separate `createXXXStore()` functions, each nearly identical.

**Proposed:** One generic factory with type overloads:

```typescript
// storage.ts - simplified
type StoreType = 'raw' | 'timeline' | 'github_meta' | 'github_commits' | 'github_prs' | 
                 'reddit_meta' | 'reddit_posts' | 'reddit_comments' | 
                 'twitter_meta' | 'twitter_tweets';

type StoreData<T extends StoreType> = 
  T extends 'raw' ? RawData :
  T extends 'timeline' ? TimelineData :
  T extends 'github_meta' ? GitHubMetaStore :
  // ... etc

type StoreIdParams<T extends StoreType> = 
  T extends 'raw' ? { platform: string; accountId: string } :
  T extends 'timeline' ? { userId: string } :
  T extends 'github_commits' | 'github_prs' ? { accountId: string; owner: string; repo: string } :
  { accountId: string };

export const createStore = <T extends StoreType>(
  backend: Backend, 
  type: T, 
  params: StoreIdParams<T>
): Result<{ store: Store<StoreData<T>>; id: string }, CorpusError> => {
  const id = STORE_PATTERNS[type](params);
  const schema = STORE_SCHEMAS[type];
  return createTypedStore(backend, id, schema);
};
```

**Estimated LOC reduction:** ~80 lines

---

### Change 5: MERGE timeline/* into per-platform files (MEDIUM IMPACT)

**Current:**
```
timeline/
├── index.ts           (8 lines - re-exports)
├── loaders.ts         (133 lines)
├── normalizers.ts     (174 lines)
├── grouping.ts        (exists)
├── profile.ts         (406 lines)
```

Each platform's loader and normalizer is in separate files but they're tightly coupled.

**Proposed:**
```
platforms/
├── github/
│   ├── index.ts       (re-export)
│   ├── provider.ts    (fetch from GitHub API)
│   ├── types.ts       (GitHub-specific types)
│   └── timeline.ts    (loader + normalizer together)
├── reddit/
│   └── ...
timeline/
├── grouping.ts        (date grouping logic - stays)
├── profile.ts         (profile timeline - stays)
```

**Why:** Loaders and normalizers are always used together and only make sense in the context of their platform. Colocating them:
- Reduces mental overhead
- Makes platform additions self-contained
- Eliminates cross-file dependencies

**Estimated LOC reduction:** ~30 lines (mostly re-export elimination)

---

### Change 6: SIMPLIFY route helpers and error handling (LOW IMPACT)

**Current:**
```typescript
// utils/route-helpers.ts - complex error mapping
const ERROR_MAPPINGS: Record<ServiceError["kind"], ErrorMapping> = {...};
const mapServiceErrorToResponse = (error: ServiceError): ErrorResponse => {...};
export const handleResult = <T>(c: Context, result: Result<T, ServiceError>): Response => {...};
export const handleResultWith = <T, R>(c: Context, result: Result<T, ServiceError>, mapper: (value: T) => R): Response => {...};
export const handleResultNoContent = <T>(c: Context, result: Result<T, ServiceError>): Response => {...};
```

**Proposed:** Inline the common case, keep helpers simple:

```typescript
// Much simpler inline handling
connectionRoutes.delete("/:account_id", async c => {
  const result = await deleteConnection(ctx, userId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, httpStatusFor(result.error));
  }
  return c.json(result.value);
});
```

**Why:** The abstraction `handleResult()` obscures what HTTP status is returned, making debugging harder. Direct handling is clearer.

**Estimated LOC reduction:** ~30 lines

---

## Summary: File Changes

### Files to DELETE (6 files, ~800 LOC)
| File | Lines | Reason |
|------|-------|--------|
| `sync/index.ts` | 4 | Pure re-export |
| `sync/account-processor.ts` | 231 | Merge into sync.ts |
| `sync/timeline-builder.ts` | 227 | Merge into sync.ts |
| `refresh-service.ts` | 391 | Merge into services/connections.ts |
| `platforms/registry.ts` | 108 | Replace with direct switch |
| `infrastructure/index.ts` | 2 | Unnecessary barrel |

### Files to SIGNIFICANTLY MODIFY (5 files)
| File | Current LOC | Change |
|------|-------------|--------|
| `services/connections.ts` | 361 | +200 (absorb refresh-service) |
| `cron/index.ts` | 123 | -50 (remove registry usage) |
| `storage.ts` | 174 | -80 (consolidate factories) |
| `timeline/loaders.ts` | 133 | Move to platforms/* |
| `timeline/normalizers.ts` | 174 | Move to platforms/* |

### New Files to CREATE (0)
None - this is a simplification, not a restructure.

---

## Error Path Analysis: Before vs After

### Before: GitHub Sync Error
```
1. Log shows: "GitHub fetch failed: rate_limited"
2. Search for log message → cron/processors/github.ts:90
3. Look at error source → platforms/github.ts:171 (mapOctokitError)
4. Trace call path → cron/index.ts:70 (processAccount)
5. Find registration → cron/index.ts:38-42 (registerCronProcessor)
6. Find dispatcher → sync/account-processor.ts:127 (processPlatformAccountWithProcessor)
7. Find entry point → refresh-service.ts:175 (processGitHubRefresh)
8. Find route → routes/connections.ts:94 (POST /:account_id/refresh)

Total: 8 file jumps
```

### After: GitHub Sync Error
```
1. Log shows: "GitHub fetch failed: rate_limited"
2. Search → platforms/github/processor.ts (error logged here)
3. Trace call → services/connections.ts (refreshConnection calls processGitHub directly)
4. Find route → routes/connections.ts

Total: 3-4 file jumps
```

---

## Implementation Phases

### Phase 1: Eliminate sync/ directory (PARALLEL-SAFE)
**Tasks:**
1. Create `sync.ts` at `packages/server/src/sync.ts`
2. Merge `sync/account-processor.ts` content
3. Merge `sync/timeline-builder.ts` content  
4. Update all imports from `./sync` to `./sync`
5. Delete `sync/` directory

**Can be parallelized:** No - single file creation

**Verification:** Run `bun test` and `bun run typecheck`

### Phase 2: Flatten refresh-service.ts (PARALLEL-SAFE)
**Tasks:**
1. Add `regenerateUserTimeline()` helper to `services/connections.ts`
2. Move `refreshSingleAccount()` logic to `services/connections.ts`
3. Move `refreshAllAccounts()` logic to `services/connections.ts`
4. Update imports
5. Delete `refresh-service.ts`

**Can be parallelized:** No - depends on Phase 1 completion

**Verification:** Run full test suite, especially `refresh-service.test.ts`

### Phase 3: Inline platform registry (PARALLEL-SAFE)
**Tasks:**
1. Replace `getCronProcessor(platform)` with switch statement in `sync.ts`
2. Remove `registerCronProcessor()` calls from `cron/index.ts`
3. Delete `platforms/registry.ts`
4. Update imports

**Can be parallelized:** Yes - independent of Phase 2

**Verification:** Run cron-related tests

### Phase 4: Consolidate storage factories (PARALLEL-SAFE)
**Tasks:**
1. Create generic `createStore()` function
2. Update all callers to use new API
3. Remove individual `createXXXStore()` functions

**Can be parallelized:** Yes - independent of Phases 2-3

**Verification:** Run storage-related tests

### Phase 5: Colocate platform timeline code (CAN PARALLEL)
**Sub-tasks (can run in parallel):**
- Agent A: Move GitHub loader+normalizer to `platforms/github/timeline.ts`
- Agent B: Move Reddit loader+normalizer to `platforms/reddit/timeline.ts`
- Agent C: Move Twitter loader+normalizer to `platforms/twitter/timeline.ts`
- Agent D: Update all imports

**Verification Agent:** Run full test suite, commit

---

## Task Breakdown for Agent Execution

### Phase 1: Merge sync/ directory
| Task | Est. LOC | Parallel? | Dependencies |
|------|----------|-----------|--------------|
| 1.1 Create sync.ts with merged content | 400 | No | None |
| 1.2 Update imports in cron/index.ts | 20 | No | 1.1 |
| 1.3 Update imports in services/connections.ts | 10 | No | 1.1 |
| 1.4 Update imports in refresh-service.ts | 10 | No | 1.1 |
| 1.5 Delete sync/ directory | 0 | No | 1.2-1.4 |

### Phase 2: Flatten refresh-service.ts
| Task | Est. LOC | Parallel? | Dependencies |
|------|----------|-----------|--------------|
| 2.1 Add regenerateUserTimeline() to connections.ts | 10 | No | Phase 1 |
| 2.2 Move refreshSingleAccount() to connections.ts | 80 | No | 2.1 |
| 2.3 Move refreshAllAccounts() to connections.ts | 120 | No | 2.2 |
| 2.4 Update route imports | 5 | No | 2.3 |
| 2.5 Delete refresh-service.ts | 0 | No | 2.4 |
| 2.6 Update/move refresh-service tests | 50 | No | 2.5 |

### Phase 3: Inline platform registry  
| Task | Est. LOC | Parallel? | Dependencies |
|------|----------|-----------|--------------|
| 3.1 Add switch statement to sync.ts | 30 | Yes | Phase 1 |
| 3.2 Remove registerCronProcessor calls | -20 | Yes | 3.1 |
| 3.3 Delete platforms/registry.ts | -108 | No | 3.2 |

### Phase 4: Consolidate storage
| Task | Est. LOC | Parallel? | Dependencies |
|------|----------|-----------|--------------|
| 4.1 Create generic createStore() | 50 | Yes | None |
| 4.2 Update github processor | 10 | Yes | 4.1 |
| 4.3 Update reddit processor | 10 | Yes | 4.1 |
| 4.4 Update twitter processor | 10 | Yes | 4.1 |
| 4.5 Remove old factory functions | -80 | No | 4.2-4.4 |

### Phase 5: Colocate platform code
| Task | Est. LOC | Parallel? | Dependencies |
|------|----------|-----------|--------------|
| 5.1 Create platforms/github/timeline.ts | 100 | Yes | None |
| 5.2 Create platforms/reddit/timeline.ts | 80 | Yes | None |
| 5.3 Create platforms/twitter/timeline.ts | 70 | Yes | None |
| 5.4 Update sync.ts imports | 10 | No | 5.1-5.3 |
| 5.5 Delete timeline/loaders.ts | -133 | No | 5.4 |
| 5.6 Delete timeline/normalizers.ts | -174 | No | 5.4 |

---

## Risks and Mitigations

### Risk 1: Breaking Changes to Test Helpers
**Mitigation:** Test helpers import from `./sync` barrel - update these first.

### Risk 2: Circular Dependencies
**Mitigation:** The new structure has clearer dependency direction:
- `platforms/*` → no dependencies on upper layers
- `services/*` → depends on platforms
- `routes/*` → depends on services
- `cron.ts` → depends on platforms + services

### Risk 3: Lost Functionality
**Mitigation:** We're not removing any functionality, only reorganizing. All tests must pass before each phase commit.

---

## Success Metrics

| Metric | Before | Target | 
|--------|--------|--------|
| File jumps for GitHub error | 8 | 3-4 |
| Total server LOC | 8,279 | ~6,800 |
| Files in sync+cron dirs | 8 | 4 |
| Storage factory functions | 10 | 1 |
| Re-export files | 5 | 1 |

---

## Things NOT to Change

These patterns are appropriate and should remain:

1. **Result<T, E> error handling** - Excellent for error propagation
2. **pipe() for data transformation** - Clean functional composition
3. **Service layer existence** - Just needs to not delegate unnecessarily
4. **Test infrastructure** - Well-designed, in-memory approach
5. **Platform provider pattern** - Good for testability with memory providers
6. **Hono route organization** - Routes are appropriately thin already

---

## Appendix: Current Import Graph (Simplified)

```
routes/connections.ts
  ├── services/connections.ts
  │     ├── auth-ownership.ts
  │     ├── refresh-service.ts
  │     │     ├── cron/processors/reddit.ts
  │     │     ├── platforms/reddit.ts
  │     │     ├── routes/auth.ts (for refreshRedditToken!)
  │     │     ├── services/connections.ts (circular!)
  │     │     ├── services/credentials.ts
  │     │     └── sync/
  │     │           ├── account-processor.ts
  │     │           └── timeline-builder.ts
  │     ├── storage.ts
  │     └── sync/
  └── utils/route-helpers.ts
```

**Note the circular dependency:** `refresh-service.ts` imports from `services/connections.ts` which imports from `refresh-service.ts`. This is a code smell that will be eliminated by the merge.
