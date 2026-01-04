# SSR Architecture Migration Plan for `media-timeline`

## Executive Summary

This plan migrates `media-timeline` to the reference SSR architecture pattern, implementing internal API handler routing for SSR requests (avoiding HTTP roundtrips), proper type declarations for Astro's runtime environment, and SSR-safe component patterns with initial data hydration.

**Key Changes:**
1. Inject `API_HANDLER` into Astro environment for internal SSR requests
2. Add proper `RuntimeEnv` and `App.Locals` type declarations
3. Update `api.ts` to use internal routing when `API_HANDLER` is available
4. Refactor Astro pages to fetch data at SSR time and pass to components
5. Update Solid components to accept `initialData` props and skip redundant fetches

---

## Task Breakdown

### Critical Path Dependencies
```
Phase 1 (Infrastructure) → Phase 2 (API Layer) → Phase 3 (Pages) → Phase 4 (Components)
```

Phase 1 and 2 must be completed in order. Within Phase 3 & 4, individual pages/components can be done in parallel.

---

## Phase 1: Core Infrastructure (~150 LOC)

### Task 1.1: Update `worker.ts` with API_HANDLER Injection
**File:** `packages/server/src/worker.ts`  
**Type:** Modify  
**Estimate:** ~40 LOC  
**Dependencies:** None  
**Priority:** CRITICAL (blocks all other changes)

**Changes:**
1. Define `ApiHandler` type
2. Create internal API handler that forwards requests to Hono app
3. Pass `API_HANDLER` to Astro via modified environment

```typescript
/// <reference types="@cloudflare/workers-types" />

import { createApiApp } from "./app";
import { type Bindings, createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import { defaultProviderFactory } from "./platforms";

// Type for internal API handler that Astro can use
export type ApiHandler = {
  fetch: (request: Request) => Promise<Response>;
};

type AstroHandler = {
  fetch: (request: Request, env: AstroEnv, ctx: ExecutionContext) => Promise<Response>;
};

// Extended bindings that Astro receives, including internal API handler
type AstroEnv = Bindings & {
  API_HANDLER: ApiHandler;
};

const API_PREFIX = "/media/api";
const HEALTH_PATH = "/media/health";

export const createUnifiedApp = (env: Bindings, astroHandler: AstroHandler) => {
  const mediaApp = createApiApp(env, {
    basePath: "/media",
    providerFactory: defaultProviderFactory,
  });

  // Create internal API handler for SSR requests
  const apiHandler: ApiHandler = {
    fetch: async (request: Request) => {
      // Rewrite URL to remove /media prefix for internal routing
      const url = new URL(request.url);
      const path = url.pathname;
      
      // Only rewrite if the path starts with /media
      if (path.startsWith("/media")) {
        url.pathname = path.replace(/^\/media/, "");
        const rewrittenRequest = new Request(url.toString(), request);
        return mediaApp.fetch(rewrittenRequest, env, {} as ExecutionContext);
      }
      
      return mediaApp.fetch(request, env, {} as ExecutionContext);
    },
  };

  return {
    async fetch(request: Request, _env: Bindings, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      // Route API requests directly to Hono
      if (path.startsWith(API_PREFIX) || path === HEALTH_PATH) {
        const rewrittenUrl = new URL(request.url);
        rewrittenUrl.pathname = path.replace(/^\/media/, "");
        const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
        return mediaApp.fetch(rewrittenRequest, env, ctx);
      }

      // Pass API handler to Astro for internal SSR requests
      const envWithApi: AstroEnv = { ...env, API_HANDLER: apiHandler };
      return astroHandler.fetch(request, envWithApi, ctx);
    },
  };
};

export const handleScheduled = async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
  const appCtx = createContextFromBindings(env, defaultProviderFactory);
  ctx.waitUntil(handleCron(appCtx));
};

export type UnifiedApp = ReturnType<typeof createUnifiedApp>;
export type { ApiHandler, AstroEnv };
```

---

### Task 1.2: Update `env.d.ts` with RuntimeEnv and App.Locals
**File:** `apps/website/src/env.d.ts`  
**Type:** Modify  
**Estimate:** ~50 LOC  
**Dependencies:** Task 1.1 (needs ApiHandler type)

**Changes:**
1. Define `RuntimeEnv` type with all Cloudflare bindings
2. Define `ApiHandler` type (mirror from server)
3. Declare `App.Locals` namespace for Astro runtime

```typescript
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// API Handler type for internal SSR routing
type ApiHandler = {
  fetch: (request: Request) => Promise<Response>;
};

// Runtime environment available in Astro SSR context
type RuntimeEnv = {
  // Internal API handler for SSR requests (injected by unified worker)
  API_HANDLER?: ApiHandler;
  
  // Cloudflare assets binding
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  
  // Raw D1 database (use via Drizzle in application code)
  DB: D1Database;
  
  // Raw R2 bucket (use via Corpus in application code)
  CORPUS_BUCKET: R2Bucket;
  
  // Environment variables
  ENVIRONMENT: string;
  ENCRYPTION_KEY: string;
  API_URL: string;
  FRONTEND_URL: string;
  DEVPAD_URL?: string;
  
  // OAuth secrets
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

// Astro App namespace declarations
declare namespace App {
  interface Locals {
    runtime: {
      env: RuntimeEnv;
      cf: CfProperties;
      ctx: ExecutionContext;
      caches: CacheStorage;
    };
  }
}
```

---

### Task 1.3: Export Types from Server Package
**File:** `packages/server/src/index.ts`  
**Type:** Modify  
**Estimate:** ~10 LOC  
**Dependencies:** Task 1.1

**Changes:**
Add exports for `ApiHandler` and `AstroEnv` types so they can be imported by consuming packages.

```typescript
// In packages/server/src/index.ts, add:
export type { ApiHandler, AstroEnv } from "./worker";
```

---

## Phase 2: API Layer (~80 LOC)

### Task 2.1: Update `api.ts` with Internal Routing
**File:** `apps/website/src/utils/api.ts`  
**Type:** Modify  
**Estimate:** ~80 LOC  
**Dependencies:** Phase 1 complete

**Changes:**
1. Update `ssr` method signature to accept optional `runtime` parameter
2. Check for `API_HANDLER` and use internal routing when available
3. Fallback to HTTP fetch for development/non-worker environments

**Updated `api.ssr` implementation:**

```typescript
// Add to existing api.ts

/**
 * Runtime context passed from Astro SSR
 */
type SSRRuntime = {
  env?: {
    API_HANDLER?: {
      fetch: (request: Request) => Promise<Response>;
    };
  };
};

export const api = {
  // ... existing methods (get, post, put, patch, delete) stay unchanged ...

  /**
   * Make an SSR request to the API.
   * If running in unified worker, uses direct internal call (no HTTP roundtrip).
   * Otherwise falls back to HTTP fetch.
   * 
   * @param path - API path (e.g., "/media/api/v1/profiles")
   * @param incomingRequest - The original request from Astro (for cookie forwarding)
   * @param options - Additional fetch options
   * @param runtime - Optional Astro runtime context with API_HANDLER
   */
  ssr: async (
    path: string,
    incomingRequest: Request,
    options: RequestInit = {},
    runtime?: SSRRuntime
  ): Promise<Response> => {
    const url = new URL(path, incomingRequest.url);
    const cookie = incomingRequest.headers.get("cookie") ?? "";
    const origin = new URL(incomingRequest.url).origin;

    // Build headers with forwarded cookies and origin
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      Origin: origin,
    };
    if (cookie) {
      headers.Cookie = cookie;
    }

    // If we have access to internal API handler, use it directly
    const apiHandler = runtime?.env?.API_HANDLER;
    if (apiHandler) {
      const internalRequest = new Request(url.toString(), {
        ...options,
        headers,
      });
      return apiHandler.fetch(internalRequest);
    }

    // Fallback to HTTP fetch (for development or when handler unavailable)
    return fetch(url.toString(), {
      ...options,
      headers,
    });
  },
  
  /**
   * Helper to make typed SSR requests that parse JSON response
   */
  ssrJson: async <T>(
    path: string,
    incomingRequest: Request,
    options: RequestInit = {},
    runtime?: SSRRuntime
  ): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> => {
    try {
      const response = await api.ssr(path, incomingRequest, options, runtime);
      
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
        return {
          ok: false,
          error: (errorBody as { message?: string }).message ?? `HTTP ${response.status}`,
          status: response.status,
        };
      }
      
      const data = await response.json() as T;
      return { ok: true, data };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
        status: 0,
      };
    }
  },
};
```

---

## Phase 3: Astro Pages (~200 LOC)

All tasks in Phase 3 can be done **in parallel** after Phase 2 is complete.

### Task 3.1: Update `AppLayout.astro` (Already Partially Done)
**File:** `apps/website/src/layouts/AppLayout.astro`  
**Type:** Modify  
**Estimate:** ~20 LOC (minor cleanup)  
**Dependencies:** Phase 2

**Current State:** Already uses direct DB access via `getSSRAuth`. This is actually fine since it's reading from the database directly. However, we should ensure the type annotations are correct.

**Changes:**
1. Add proper type annotation for runtime
2. Consider using SSR API route instead of direct DB access for consistency (optional)

```astro
---
// Replace the @ts-expect-error with proper typing
const runtime = Astro.locals.runtime as App.Locals['runtime'] | undefined;
---
```

---

### Task 3.2: Update `dashboard/index.astro`
**File:** `apps/website/src/pages/dashboard/index.astro`  
**Type:** Modify  
**Estimate:** ~40 LOC  
**Dependencies:** Phase 2, Task 4.1 (Dashboard component)

**Changes:**
1. Fetch timeline data at SSR time
2. Pass initial data to Dashboard component
3. Handle errors gracefully (show component with empty state)

```astro
---
import Dashboard from "../../components/solid/Dashboard/Dashboard";
import AppLayout from "../../layouts/AppLayout.astro";
import { api, type ProfileTimelineResponse } from "../../utils/api";

const profileSlug = Astro.url.searchParams.get("profile");

// SSR data fetching
let initialTimeline: ProfileTimelineResponse | null = null;

if (profileSlug) {
  try {
    const runtime = Astro.locals.runtime;
    const result = await api.ssrJson<ProfileTimelineResponse>(
      `/media/api/v1/profiles/${profileSlug}/timeline`,
      Astro.request,
      {},
      runtime
    );
    
    if (result.ok) {
      initialTimeline = result.data;
    }
  } catch {
    // SSR fetch failed, component will fetch client-side
  }
}
---

<AppLayout 
  title="Dashboard | Media Timeline"
  description="Your activity overview and insights across connected platforms."
  noindex={true}
>
  <section>
    <h1 class="page-title">Dashboard</h1>
    <p class="description">Your activity overview and insights.</p>
  </section>
  <Dashboard 
    client:load 
    profileSlug={profileSlug} 
    initialTimeline={initialTimeline}
  />
</AppLayout>
```

---

### Task 3.3: Update `timeline/index.astro`
**File:** `apps/website/src/pages/timeline/index.astro`  
**Type:** Modify  
**Estimate:** ~50 LOC  
**Dependencies:** Phase 2, Task 4.2 (TimelineList component)

**Changes:**
1. Fetch timeline data at SSR time
2. Pass initial data to TimelineList component
3. Change from `client:only` to `client:load` for hydration with SSR data

```astro
---
import TimelineList from "../../components/solid/TimelineList";
import AppLayout from "../../layouts/AppLayout.astro";
import { api, type ProfileTimelineResponse, type TimelineGroup } from "../../utils/api";

const profileSlug = Astro.url.searchParams.get("profile");

// SSR data fetching
let initialGroups: TimelineGroup[] = [];

if (profileSlug) {
  try {
    const runtime = Astro.locals.runtime;
    const result = await api.ssrJson<ProfileTimelineResponse>(
      `/media/api/v1/profiles/${profileSlug}/timeline`,
      Astro.request,
      {},
      runtime
    );
    
    if (result.ok) {
      initialGroups = result.data.data.groups;
    }
  } catch {
    // SSR fetch failed, component will fetch client-side
  }
}
---

<AppLayout 
  title="Timeline | Media Timeline"
  description="Your aggregated activity feed from GitHub, Reddit, Twitter, and more."
  noindex={true}
>
  <section>
    <h1 class="page-title">Timeline</h1>
    <p class="description">Your aggregated activity across all connected platforms.</p>
  </section>
  <div class="timeline-skeleton">
    <TimelineList 
      client:load
      profileSlug={profileSlug}
      initialGroups={initialGroups}
    />
  </div>
</AppLayout>

<style>
  .timeline-skeleton {
    min-height: 200px;
  }
</style>
```

---

### Task 3.4: Update `connections/index.astro`
**File:** `apps/website/src/pages/connections/index.astro`  
**Type:** Modify  
**Estimate:** ~60 LOC  
**Dependencies:** Phase 2, Task 4.3 & 4.4 (ConnectionList, ProfileList)

**Changes:**
1. Fetch profiles and connections at SSR time
2. Pass initial data to both components
3. Change from `client:only` to `client:load`

```astro
---
import ConnectionList from "../../components/solid/ConnectionList";
import ProfileList from "../../components/solid/ProfileList";
import AppLayout from "../../layouts/AppLayout.astro";
import { 
  api, 
  type ProfilesListResponse, 
  type ConnectionsWithSettingsResponse,
  type ProfileSummary,
  type ConnectionWithSettings
} from "../../utils/api";

const profileSlug = Astro.url.searchParams.get("profile");
const runtime = Astro.locals.runtime;

// SSR data fetching
let initialProfiles: ProfileSummary[] = [];
let initialConnections: ConnectionWithSettings[] = [];
let profileId: string | null = null;

try {
  // Fetch profiles first
  const profilesResult = await api.ssrJson<ProfilesListResponse>(
    "/media/api/v1/profiles",
    Astro.request,
    {},
    runtime
  );
  
  if (profilesResult.ok) {
    initialProfiles = profilesResult.data.profiles;
    
    // Find the current profile ID
    if (profileSlug) {
      const currentProfile = initialProfiles.find(p => p.slug === profileSlug);
      profileId = currentProfile?.id ?? null;
    }
    
    // Fetch connections if we have a profile
    if (profileId) {
      const connectionsResult = await api.ssrJson<ConnectionsWithSettingsResponse>(
        `/media/api/v1/connections?profile_id=${profileId}&include_settings=true`,
        Astro.request,
        {},
        runtime
      );
      
      if (connectionsResult.ok) {
        initialConnections = connectionsResult.data.accounts;
      }
    }
  }
} catch {
  // SSR fetch failed, components will fetch client-side
}
---

<AppLayout 
  title="Connections | Media Timeline"
  description="Connect and manage your GitHub, Twitter, Reddit, Bluesky, and YouTube accounts."
  noindex={true}
>
  <section>
    <h1 class="page-title">Connections</h1>
    <p class="description">Manage your connected platforms and profiles.</p>
  </section>
  
  <section class="connections-section">
    <h2 class="section-title">Profiles</h2>
    <p class="section-description">Create profiles to share different views of your activity via API.</p>
    <div class="content-skeleton">
      <ProfileList 
        client:load
        initialProfiles={initialProfiles}
      />
    </div>
  </section>
  
  <section class="connections-section">
    <h2 class="section-title">Connected Platforms</h2>
    <p class="section-description">Connect your accounts to aggregate activity.</p>
    <div class="content-skeleton">
      <ConnectionList 
        client:load
        profileSlug={profileSlug}
        initialProfiles={initialProfiles}
        initialConnections={initialConnections}
      />
    </div>
  </section>
</AppLayout>

<style>
  .connections-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .section-title {
    font-size: 1rem;
    font-weight: 500;
  }
  
  .section-description {
    color: var(--text-tertiary);
    font-size: 0.875rem;
  }
  
  .content-skeleton {
    min-height: 100px;
  }
</style>
```

---

## Phase 4: Solid Components (~300 LOC)

All tasks in Phase 4 can be done **in parallel** after their corresponding Phase 3 task.

### Task 4.1: Update `Dashboard/Dashboard.tsx`
**File:** `apps/website/src/components/solid/Dashboard/Dashboard.tsx`  
**Type:** Modify  
**Estimate:** ~60 LOC  
**Dependencies:** Task 3.2

**Changes:**
1. Add `initialTimeline` prop
2. Skip initial fetch if SSR data provided
3. Use `createResource` with conditional fetching

```typescript
import { type DashboardStats as Stats, /* ... */ } from "@/utils/analytics";
import { type ApiResult, type ProfileTimelineResponse, initMockAuth, profiles } from "@/utils/api";
import { Show, createSignal, createResource } from "solid-js";
// ... other imports

type DashboardProps = {
  profileSlug?: string | null;
  initialTimeline?: ProfileTimelineResponse | null;
};

export default function Dashboard(props: DashboardProps) {
  initMockAuth();
  
  // Track if we've triggered a client-side fetch
  const [fetchTrigger, setFetchTrigger] = createSignal(0);

  const [data] = createResource(
    () => {
      const trigger = fetchTrigger();
      const slug = props.profileSlug;
      
      // Skip initial fetch if we have SSR data
      if (trigger === 0 && props.initialTimeline) {
        return null; // Returning null skips the fetch
      }
      
      return slug;
    },
    async (slug): Promise<ProfileTimelineResponse | null> => {
      if (!slug) return null;
      const result: ApiResult<ProfileTimelineResponse> = await profiles.getTimeline(slug);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    { 
      // Use SSR data as initial value
      initialValue: props.initialTimeline ?? undefined 
    }
  );

  // Function to trigger refetch (for refresh actions)
  const refetch = () => setFetchTrigger(prev => prev + 1);

  return (
    <div class="dashboard">
      <Show when={!props.profileSlug}>
        <div class="empty-state">
          <p>Select a profile to view the dashboard.</p>
        </div>
      </Show>

      <Show when={props.profileSlug}>
        <Show when={data.loading && !props.initialTimeline}>
          <p class="tertiary">Loading dashboard...</p>
        </Show>

        <Show when={data.error}>
          <p class="error-icon">Failed to load dashboard: {data.error.message}</p>
        </Show>

        <Show when={data()} keyed>
          {response => <DashboardContent response={response} />}
        </Show>
      </Show>
    </div>
  );
}

// ... rest of DashboardContent unchanged
```

---

### Task 4.2: Update `TimelineList.tsx`
**File:** `apps/website/src/components/solid/TimelineList.tsx`  
**Type:** Modify  
**Estimate:** ~80 LOC  
**Dependencies:** Task 3.3

**Changes:**
1. Add `initialGroups` and `profileSlug` props
2. Remove `getSlugFromUrl()` calls (receive slug as prop)
3. Skip initial fetch if SSR data provided
4. Guard remaining `window` access with `isServer` check

```typescript
import { /* ... */ } from "@/utils/api";
import { formatRelativeTime } from "@/utils/formatters";
import { isServer } from "solid-js/web";
// ... other imports

type TimelineListProps = {
  profileSlug?: string | null;
  initialGroups?: TimelineGroup[];
};

export default function TimelineList(props: TimelineListProps) {
  const [fetchTrigger, setFetchTrigger] = createSignal(0);

  const [data] = createResource(
    () => {
      const trigger = fetchTrigger();
      const slug = props.profileSlug;
      
      // Skip initial fetch if we have SSR data
      if (trigger === 0 && props.initialGroups && props.initialGroups.length > 0) {
        return null;
      }
      
      return slug;
    },
    async (slug): Promise<TimelineData | null> => {
      if (!slug) return null;
      initMockAuth();
      const result: ApiResult<ProfileTimelineResponse> = await profiles.getTimeline(slug);
      if (!result.ok) throw new Error(result.error.message);
      return {
        groups: result.value.data.groups,
        githubUsernames: [],
      };
    },
    {
      initialValue: props.initialGroups 
        ? { groups: props.initialGroups, githubUsernames: [] }
        : undefined,
    }
  );

  return (
    <Show when={props.profileSlug} fallback={<NoProfileSelected />}>
      <div class="timeline">
        <Show when={data.loading && !props.initialGroups?.length}>
          <p class="tertiary">Loading timeline...</p>
        </Show>

        <Show when={data.error}>
          <p class="error-icon">Failed to load timeline: {data.error.message}</p>
        </Show>

        <Show when={data()} keyed>
          {response => (
            <GithubUsernamesContext.Provider value={response.githubUsernames}>
              <TimelineGroups groups={response.groups} />
            </GithubUsernamesContext.Provider>
          )}
        </Show>
      </div>
    </Show>
  );
}

// ... rest of component unchanged
```

---

### Task 4.3: Update `ProfileList.tsx`
**File:** `apps/website/src/components/solid/ProfileList.tsx`  
**Type:** Modify  
**Estimate:** ~40 LOC  
**Dependencies:** Task 3.4

**Changes:**
1. Add `initialProfiles` prop
2. Skip initial fetch if SSR data provided

```typescript
type ProfileListProps = {
  initialProfiles?: ProfileSummary[];
};

export default function ProfileList(props: ProfileListProps) {
  const [fetchTrigger, setFetchTrigger] = createSignal(0);
  
  const [profileList, { refetch }] = createResource(
    () => {
      const trigger = fetchTrigger();
      if (trigger === 0 && props.initialProfiles && props.initialProfiles.length > 0) {
        return null;
      }
      return trigger;
    },
    async () => {
      initMockAuth();
      const result = await profiles.list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.profiles;
    },
    { initialValue: props.initialProfiles ?? [] }
  );
  
  // ... rest of component
}
```

---

### Task 4.4: Update `ConnectionList.tsx`
**File:** `apps/website/src/components/solid/ConnectionList.tsx`  
**Type:** Modify  
**Estimate:** ~80 LOC  
**Dependencies:** Task 3.4

**Changes:**
1. Add `initialProfiles` and `initialConnections` props
2. Receive `profileSlug` as prop instead of reading from URL
3. Skip initial fetches if SSR data provided

```typescript
type ConnectionListProps = {
  profileSlug?: string | null;
  initialProfiles?: ProfileSummary[];
  initialConnections?: ConnectionWithSettings[];
};

export default function ConnectionList(props: ConnectionListProps) {
  const [profileFetchTrigger, setProfileFetchTrigger] = createSignal(0);
  const [connectionFetchTrigger, setConnectionFetchTrigger] = createSignal(0);
  
  const [profileId, setProfileId] = createSignal<string | null>(null);

  const [profileList] = createResource(
    () => {
      if (profileFetchTrigger() === 0 && props.initialProfiles?.length) {
        return null;
      }
      return profileFetchTrigger();
    },
    async () => {
      initMockAuth();
      const result = await profiles.list();
      if (!result.ok) return [];
      return result.value.profiles;
    },
    { initialValue: props.initialProfiles ?? [] }
  );

  const currentProfile = () => {
    const slug = props.profileSlug;
    const list = profileList();
    if (!slug || !list) return null;
    return list.find(p => p.slug === slug) ?? null;
  };

  // Update profileId when profile changes
  createEffect(
    on(
      () => [props.profileSlug, profileList()] as const,
      ([slug, list]) => {
        if (!slug || !list) {
          setProfileId(null);
          return;
        }
        const profile = list.find(p => p.slug === slug);
        setProfileId(profile?.id ?? null);
      }
    )
  );

  const [data, { refetch }] = createResource(
    () => {
      const id = profileId();
      if (connectionFetchTrigger() === 0 && props.initialConnections?.length) {
        return null;
      }
      return id;
    },
    async id => {
      if (!id) return [];
      initMockAuth();
      const result = await connections.listWithSettings(id);
      if (!result.ok) throw new Error(result.error.message);
      return result.value.accounts;
    },
    { initialValue: props.initialConnections ?? [] }
  );

  // ... rest of component
}
```

---

### Task 4.5: Update `ProfileSelector.tsx` (Minor)
**File:** `apps/website/src/components/solid/ProfileSelector.tsx`  
**Type:** Modify  
**Estimate:** ~20 LOC  
**Dependencies:** None (already supports SSR pattern)

**Current State:** Already accepts `initialProfiles` and `isAuthenticated` props. Just needs minor cleanup.

**Changes:**
1. Remove `typeof window === "undefined"` checks where possible (use `isServer`)
2. Ensure consistent pattern with other components

```typescript
import { isServer } from "solid-js/web";

const getSlugFromUrl = () => {
  if (isServer) return null;
  return new URLSearchParams(window.location.search).get("profile");
};
```

---

## Appendix A: Files Summary

| File | Type | Phase | Est. LOC | Dependencies |
|------|------|-------|----------|--------------|
| `packages/server/src/worker.ts` | Modify | 1 | 40 | None |
| `packages/server/src/index.ts` | Modify | 1 | 10 | Task 1.1 |
| `apps/website/src/env.d.ts` | Modify | 1 | 50 | Task 1.1 |
| `apps/website/src/utils/api.ts` | Modify | 2 | 80 | Phase 1 |
| `apps/website/src/layouts/AppLayout.astro` | Modify | 3 | 20 | Phase 2 |
| `apps/website/src/pages/dashboard/index.astro` | Modify | 3 | 40 | Phase 2 |
| `apps/website/src/pages/timeline/index.astro` | Modify | 3 | 50 | Phase 2 |
| `apps/website/src/pages/connections/index.astro` | Modify | 3 | 60 | Phase 2 |
| `apps/website/src/components/solid/Dashboard/Dashboard.tsx` | Modify | 4 | 60 | Task 3.2 |
| `apps/website/src/components/solid/TimelineList.tsx` | Modify | 4 | 80 | Task 3.3 |
| `apps/website/src/components/solid/ProfileList.tsx` | Modify | 4 | 40 | Task 3.4 |
| `apps/website/src/components/solid/ConnectionList.tsx` | Modify | 4 | 80 | Task 3.4 |
| `apps/website/src/components/solid/ProfileSelector.tsx` | Modify | 4 | 20 | None |

**Total Estimated LOC:** ~630

---

## Appendix B: Parallel Execution Plan

```
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 1: Core Infrastructure (Sequential)                          │
│ Task 1.1 → Task 1.2 → Task 1.3                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 2: API Layer (Sequential)                                     │
│ Task 2.1                                                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Task 3.1        │ │ Task 3.2        │ │ Task 3.3        │ 
│ AppLayout       │ │ Dashboard page  │ │ Timeline page   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                          │                   │
                          ▼                   ▼
                   ┌─────────────────┐ ┌─────────────────┐
                   │ Task 4.1        │ │ Task 4.2        │
                   │ Dashboard.tsx   │ │ TimelineList    │
                   └─────────────────┘ └─────────────────┘
          
          ┌───────────────────────────────────────────────┐
          ▼                                               
┌─────────────────┐                                       
│ Task 3.4        │ ◀──────── Can run in parallel ───────┐
│ Connections pg  │                                       │
└─────────────────┘                                       │
          │                                               │
          ├──────────────┬───────────────┐               │
          ▼              ▼               ▼               │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Task 4.3        │ │ Task 4.4        │ │ Task 4.5        │
│ ProfileList     │ │ ConnectionList  │ │ ProfileSelector │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Appendix C: Risks and Considerations

### 1. **Type Safety with Cloudflare Runtime**
The `Astro.locals.runtime` type isn't perfectly typed by default. Using the `App.Locals` declaration helps, but there may be edge cases where the runtime object structure differs between development (wrangler) and production.

**Mitigation:** Add defensive checks like `runtime?.env?.API_HANDLER` with optional chaining.

### 2. **Cookie Forwarding for Authentication**
The SSR requests must forward cookies correctly for authentication to work. The current implementation extracts cookies from the incoming request and passes them to the internal API handler.

**Mitigation:** Test authentication flows thoroughly after migration.

### 3. **Hydration Mismatch**
When SSR provides initial data, the client must receive the exact same data structure to avoid hydration mismatches. 

**Mitigation:** Serialize data consistently (dates as ISO strings, etc.).

### 4. **Development vs Production Behavior**
In development, the `API_HANDLER` may not be available (depending on Astro's dev server configuration). The fallback to HTTP fetch handles this.

**Mitigation:** The `api.ssr()` method always falls back to HTTP fetch when `API_HANDLER` is unavailable.

### 5. **Breaking `client:only` Directive**
Changing from `client:only="solid-js"` to `client:load` means components will now render on the server. Components must be SSR-safe (no direct `window` access during render).

**Mitigation:** Use `isServer` guard from `solid-js/web` and move browser-only code to `onMount`.

---

## Appendix D: Testing Strategy

### Integration Tests (New)
**File:** `packages/server/__tests__/integration/ssr-routing.test.ts`

Test the `API_HANDLER` injection and internal routing:

```typescript
describe("SSR Internal Routing", () => {
  it("should route SSR requests through internal handler without HTTP", async () => {
    // Create unified app with mock Astro handler
    // Verify API_HANDLER is called directly
    // Verify no external HTTP calls are made
  });
  
  it("should forward cookies correctly for authenticated SSR requests", async () => {
    // Setup auth context
    // Make SSR request through handler
    // Verify auth middleware receives cookies
  });
});
```

### Existing Tests
The existing integration tests in `packages/server/__tests__/integration/` should continue to pass as the API routes themselves are unchanged.
