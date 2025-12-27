# Media Timeline UI Implementation Plan

## Executive Summary

This plan details the implementation of a frontend UI for the Media Timeline project, deployed to Cloudflare Pages at `media.devpad.tools`. The UI will allow users to manage their platform integrations and view their aggregated activity timeline.

### Key Decisions
- **Framework**: Astro + SolidJS (matching devpad design system)
- **Deployment**: Cloudflare Pages (separate from Worker API)
- **Local Dev**: `bun dev` boots both API (in-memory) and UI
- **Auth**: Mock user for local testing; external auth in production

---

## Project Structure

```
media-timeline/
├── apps/
│   └── website/                     # Frontend app (NEW)
│       ├── public/
│       │   └── favicon.svg
│       ├── src/
│       │   ├── components/
│       │   │   ├── solid/           # SolidJS interactive components
│       │   │   │   ├── ConnectionCard.tsx
│       │   │   │   ├── ConnectionForm.tsx
│       │   │   │   ├── ConnectionList.tsx
│       │   │   │   ├── LoadingIndicator.tsx
│       │   │   │   ├── PlatformIcon.tsx
│       │   │   │   ├── RefreshButton.tsx
│       │   │   │   ├── RawDataViewer.tsx
│       │   │   │   ├── TimelineItem.tsx
│       │   │   │   ├── TimelineList.tsx
│       │   │   │   ├── ToastManager.tsx
│       │   │   │   └── ViewToggle.tsx
│       │   │   └── PlatformBadge.astro
│       │   ├── layouts/
│       │   │   ├── Layout.astro      # Base HTML shell
│       │   │   └── AppLayout.astro   # App chrome (nav, footer)
│       │   ├── pages/
│       │   │   ├── index.astro       # Dashboard/timeline view
│       │   │   ├── connections/
│       │   │   │   ├── index.astro   # List connections
│       │   │   │   └── new.astro     # Add connection form
│       │   │   └── debug/
│       │   │       └── raw.astro     # Raw JSON viewer
│       │   ├── utils/
│       │   │   ├── api-client.ts     # API wrapper
│       │   │   └── auth.ts           # Mock user helpers
│       │   ├── main.css              # Copy from devpad
│       │   └── env.d.ts
│       ├── astro.config.mjs
│       ├── package.json
│       └── tsconfig.json
├── src/                             # Existing API code
│   └── ...
├── __tests__/
│   ├── integration/
│   │   ├── setup.ts                 # Existing test setup
│   │   └── ui-integration.test.ts   # NEW: UI + API tests
│   └── unit/
│       └── timeline-rendering.test.ts # NEW: Timeline component tests
├── scripts/
│   └── dev.ts                       # NEW: Unified dev server
├── package.json                     # Updated with workspaces
└── ...
```

---

## Technology Stack

### Frontend (apps/website)
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | Astro 5.x | Matches devpad, great DX |
| UI Library | SolidJS | Matches devpad, reactive |
| Styling | CSS Variables | Copy from devpad main.css |
| Icons | lucide-solid | Matches devpad |
| Build | Vite (via Astro) | Fast, standard |
| Deploy | Cloudflare Pages | Pair with Workers |

### Dependencies to Add
```json
{
  "dependencies": {
    "@astrojs/solid-js": "5.0.4",
    "astro": "^5.13.7",
    "lucide-solid": "^0.454.0",
    "solid-js": "^1.9.3",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.4",
    "typescript": "^5.9.3"
  }
}
```

---

## CSS Files to Copy from Devpad

Copy `/Users/tom/dev/devpad/packages/app/src/main.css` to `apps/website/src/main.css`.

### Key CSS Patterns to Reuse
1. **CSS Variables** (lines 1-42) - Color scheme with dark mode
2. **Form Inputs** (lines 291-324) - Consistent input styling
3. **Card Pattern** (lines 556-561) - `.card` class for containers
4. **Timeline Pattern** (lines 475-514) - Timeline dots and lines
5. **Flex Utilities** (lines 206-231) - `.flex-row`, `.flex-col`
6. **Loading States** (lines 866-886) - `.spinner`, success/error icons

### Media Timeline Additions
Add these custom styles for platform-specific elements:

```css
/* Platform Colors */
.platform-github { --platform-color: oklch(45% 0.02 290); }
.platform-bluesky { --platform-color: oklch(55% 0.15 230); }
.platform-youtube { --platform-color: oklch(60% 0.2 25); }
.platform-devpad { --platform-color: oklch(55% 0.1 150); }

/* Connection Status */
.status-active { color: var(--item-green); }
.status-inactive { color: var(--text-muted); }
.status-error { color: var(--item-red); }

/* Raw Data Viewer */
.raw-viewer {
  font-family: monospace;
  font-size: 0.85rem;
  background: var(--input-background);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  padding: 12px;
  overflow: auto;
  max-height: 400px;
}
```

---

## Component Breakdown

### 1. Layout Components (~100 LOC total)

#### Layout.astro
Base HTML document. Copy from devpad with modifications:
- Remove devpad-specific meta tags
- Update title/description
- Keep CSS variable system

#### AppLayout.astro
App shell with navigation:
```astro
---
import Layout from './Layout.astro';

const pages = [
  { name: "timeline", href: "/" },
  { name: "connections", href: "/connections" },
];

const active = pages.find(p => 
  p.href === "/" 
    ? Astro.url.pathname === "/" 
    : Astro.url.pathname.startsWith(p.href)
)?.name ?? "timeline";
---

<Layout title="Media Timeline">
  <body>
    <div id="container">
      <header>
        <a href="/"><h5>media timeline</h5></a>
        <nav>
          {pages.map(p => (
            <a href={p.href} class={active === p.name ? "active" : ""}>
              {p.name}
            </a>
          ))}
        </nav>
      </header>
      <slot />
    </div>
    <footer><p>media.devpad.tools</p></footer>
  </body>
</Layout>
```

### 2. Connection Management (~400 LOC total)

#### ConnectionList.tsx (~120 LOC)
Displays all connected platforms with status.

```tsx
import { createResource, For, Show } from "solid-js";
import { getApiClient } from "@/utils/api-client";
import ConnectionCard from "./ConnectionCard";

export default function ConnectionList() {
  const [connections, { refetch }] = createResource(async () => {
    const client = getApiClient();
    const response = await client.get("/connections");
    return response.accounts;
  });

  return (
    <div class="flex-col">
      <Show when={connections.loading}>
        <LoadingIndicator />
      </Show>
      <Show when={connections()}>
        <For each={connections()}>
          {(conn) => (
            <ConnectionCard 
              connection={conn} 
              onRefresh={refetch}
              onDelete={refetch}
            />
          )}
        </For>
      </Show>
      <Show when={connections()?.length === 0}>
        <p class="description">No connections yet.</p>
      </Show>
    </div>
  );
}
```

#### ConnectionCard.tsx (~100 LOC)
Individual connection display with actions.

```tsx
interface Props {
  connection: {
    account_id: string;
    platform: string;
    platform_username: string | null;
    is_active: boolean;
    last_fetched_at: string | null;
  };
  onRefresh: () => void;
  onDelete: () => void;
}

export default function ConnectionCard(props: Props) {
  const [deleting, setDeleting] = createSignal(false);
  
  const handleDelete = async () => {
    setDeleting(true);
    await getApiClient().delete(`/connections/${props.connection.account_id}`);
    props.onDelete();
    setDeleting(false);
  };

  return (
    <div class={`card platform-${props.connection.platform}`}>
      <div class="flex-row">
        <PlatformIcon platform={props.connection.platform} />
        <div class="flex-col" style={{ gap: "2px" }}>
          <h6>{props.connection.platform}</h6>
          <span class="description">
            {props.connection.platform_username ?? "Connected"}
          </span>
        </div>
        <div style={{ "margin-left": "auto" }} class="flex-row icons">
          <RefreshButton accountId={props.connection.account_id} />
          <button onClick={handleDelete} disabled={deleting()}>
            <Trash2 />
          </button>
        </div>
      </div>
      <Show when={props.connection.last_fetched_at}>
        <small class="description">
          Last synced: {formatRelativeTime(props.connection.last_fetched_at)}
        </small>
      </Show>
    </div>
  );
}
```

#### ConnectionForm.tsx (~150 LOC)
Form for adding new connections.

```tsx
import { createSignal, For } from "solid-js";

const PLATFORMS = ["github", "bluesky", "youtube", "devpad"] as const;

export default function ConnectionForm(props: { onSuccess: () => void }) {
  const [platform, setPlatform] = createSignal<string>("github");
  const [accessToken, setAccessToken] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await getApiClient().post("/connections", {
        platform: platform(),
        access_token: accessToken(),
        platform_username: username() || undefined,
      });
      props.onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add connection");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} class="flex-col">
      <section>
        <label>Platform</label>
        <select value={platform()} onChange={e => setPlatform(e.target.value)}>
          <For each={PLATFORMS}>
            {(p) => <option value={p}>{p}</option>}
          </For>
        </select>
      </section>
      
      <section>
        <label>Access Token</label>
        <input
          type="password"
          value={accessToken()}
          onInput={e => setAccessToken(e.target.value)}
          placeholder="Your platform access token"
          required
        />
      </section>

      <section>
        <label>Username (optional)</label>
        <input
          type="text"
          value={username()}
          onInput={e => setUsername(e.target.value)}
          placeholder="Display username"
        />
      </section>

      <Show when={error()}>
        <p class="error-icon">{error()}</p>
      </Show>

      <button type="submit" disabled={submitting()}>
        {submitting() ? "Adding..." : "Add Connection"}
      </button>
    </form>
  );
}
```

### 3. Timeline Display (~500 LOC total)

#### TimelineList.tsx (~200 LOC)
Main timeline component with date grouping.

```tsx
import { createResource, For, Show, createSignal } from "solid-js";
import TimelineItem from "./TimelineItem";

export default function TimelineList(props: { userId: string }) {
  const [view, setView] = createSignal<"rendered" | "raw">("rendered");
  
  const [timeline] = createResource(async () => {
    const client = getApiClient();
    return client.get(`/timeline/${props.userId}`);
  });

  return (
    <div class="flex-col">
      <div class="flex-row">
        <ViewToggle 
          value={view()} 
          onChange={setView} 
          options={["rendered", "raw"]}
        />
      </div>

      <Show when={timeline.loading}>
        <LoadingIndicator state={() => "loading"} idle={null} />
      </Show>

      <Show when={view() === "rendered" && timeline()}>
        <div class="timeline-container">
          <For each={timeline().data.groups}>
            {(group) => (
              <div class="date-group">
                <h6 class="date-highlighted">{formatDate(group.date)}</h6>
                <For each={group.items}>
                  {(item) => <TimelineItem item={item} />}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={view() === "raw" && timeline()}>
        <RawDataViewer data={timeline()} />
      </Show>
    </div>
  );
}
```

#### TimelineItem.tsx (~150 LOC)
Individual timeline entry rendering.

```tsx
import { Match, Switch } from "solid-js";

interface TimelineItemData {
  id: string;
  platform: string;
  type: "commit" | "post" | "video" | "task";
  timestamp: string;
  title: string;
  url?: string;
  payload: Record<string, unknown>;
}

interface CommitGroupData {
  type: "commit_group";
  repo: string;
  date: string;
  commits: TimelineItemData[];
  total_additions?: number;
  total_deletions?: number;
}

type ItemOrGroup = TimelineItemData | CommitGroupData;

export default function TimelineItem(props: { item: ItemOrGroup }) {
  return (
    <div class="timeline-item">
      <Switch>
        <Match when={props.item.type === "commit_group"}>
          <CommitGroupView group={props.item as CommitGroupData} />
        </Match>
        <Match when={props.item.type === "commit"}>
          <CommitView item={props.item as TimelineItemData} />
        </Match>
        <Match when={props.item.type === "post"}>
          <PostView item={props.item as TimelineItemData} />
        </Match>
        <Match when={props.item.type === "video"}>
          <VideoView item={props.item as TimelineItemData} />
        </Match>
        <Match when={props.item.type === "task"}>
          <TaskView item={props.item as TimelineItemData} />
        </Match>
      </Switch>
    </div>
  );
}

function CommitGroupView(props: { group: CommitGroupData }) {
  return (
    <details class="boxed">
      <summary class="flex-row">
        <PlatformIcon platform="github" />
        <span>{props.group.repo}</span>
        <span class="description">
          {props.group.commits.length} commits
        </span>
        <Show when={props.group.total_additions}>
          <span class="priority-low">+{props.group.total_additions}</span>
        </Show>
        <Show when={props.group.total_deletions}>
          <span class="priority-high">-{props.group.total_deletions}</span>
        </Show>
      </summary>
      <ul>
        <For each={props.group.commits}>
          {(commit) => (
            <li>
              <a href={commit.url} target="_blank" class="task-title">
                {commit.payload.message}
              </a>
            </li>
          )}
        </For>
      </ul>
    </details>
  );
}

function PostView(props: { item: TimelineItemData }) {
  const payload = props.item.payload as {
    content: string;
    author_handle: string;
    like_count?: number;
    repost_count?: number;
  };
  
  return (
    <div class="card">
      <div class="flex-row">
        <PlatformIcon platform="bluesky" />
        <span>@{payload.author_handle}</span>
        <span class="description">{formatTime(props.item.timestamp)}</span>
      </div>
      <p>{payload.content}</p>
      <Show when={payload.like_count || payload.repost_count}>
        <div class="flex-row description">
          <Show when={payload.like_count}>
            <span>{payload.like_count} likes</span>
          </Show>
          <Show when={payload.repost_count}>
            <span>{payload.repost_count} reposts</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
```

#### RawDataViewer.tsx (~50 LOC)
JSON viewer for debugging.

```tsx
import { createSignal } from "solid-js";

export default function RawDataViewer(props: { data: unknown }) {
  const [collapsed, setCollapsed] = createSignal(false);
  
  const formattedJson = () => 
    JSON.stringify(props.data, null, 2);

  return (
    <div class="raw-viewer">
      <div class="flex-row" style={{ "margin-bottom": "8px" }}>
        <button onClick={() => setCollapsed(!collapsed())}>
          {collapsed() ? "Expand" : "Collapse"}
        </button>
        <button onClick={() => navigator.clipboard.writeText(formattedJson())}>
          Copy
        </button>
      </div>
      <Show when={!collapsed()}>
        <pre><code>{formattedJson()}</code></pre>
      </Show>
    </div>
  );
}
```

### 4. Utility Components (~150 LOC total)

#### RefreshButton.tsx (~60 LOC)
Trigger manual refresh for a connection.

```tsx
import { createSignal } from "solid-js";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";

type State = "idle" | "loading" | "success" | "error";

export default function RefreshButton(props: { accountId: string }) {
  const [state, setState] = createSignal<State>("idle");

  const handleRefresh = async () => {
    setState("loading");
    try {
      // Note: This endpoint needs to be added to the API
      await getApiClient().post(`/connections/${props.accountId}/refresh`);
      setState("success");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <button 
      onClick={handleRefresh} 
      disabled={state() === "loading"}
      title="Refresh data from platform"
    >
      <Switch>
        <Match when={state() === "loading"}>
          <RefreshCw class="spinner" />
        </Match>
        <Match when={state() === "success"}>
          <Check class="success-icon" />
        </Match>
        <Match when={state() === "error"}>
          <X class="error-icon" />
        </Match>
        <Match when={state() === "idle"}>
          <RefreshCw />
        </Match>
      </Switch>
    </button>
  );
}
```

#### PlatformIcon.tsx (~40 LOC)
Platform-specific icons.

```tsx
import Github from "lucide-solid/icons/github";
import Cloud from "lucide-solid/icons/cloud";  // Bluesky
import Youtube from "lucide-solid/icons/youtube";
import ClipboardList from "lucide-solid/icons/clipboard-list"; // Devpad

export default function PlatformIcon(props: { platform: string; size?: number }) {
  const size = props.size ?? 18;
  
  switch (props.platform) {
    case "github":
      return <Github size={size} />;
    case "bluesky":
      return <Cloud size={size} />;
    case "youtube":
      return <Youtube size={size} />;
    case "devpad":
      return <ClipboardList size={size} />;
    default:
      return <span>?</span>;
  }
}
```

### 5. API Client (~100 LOC)

#### api-client.ts

```typescript
// API client for media-timeline

interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  mockUser?: boolean;
}

let config: ApiClientConfig = {
  baseUrl: import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787",
  mockUser: import.meta.env.DEV,
};

export function configureApi(newConfig: Partial<ApiClientConfig>) {
  config = { ...config, ...newConfig };
}

export function getApiClient() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // In development, use mock user API key
  if (config.mockUser) {
    headers["Authorization"] = `Bearer ${getMockApiKey()}`;
  } else if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const request = async (method: string, path: string, body?: unknown) => {
    const url = `${config.baseUrl}/api/v1${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Unknown error" }));
      throw new Error(error.message ?? `HTTP ${response.status}`);
    }

    return response.json();
  };

  return {
    get: (path: string) => request("GET", path),
    post: (path: string, body?: unknown) => request("POST", path, body),
    delete: (path: string) => request("DELETE", path),
  };
}

// Mock user for local development
const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = "mt_mock_" + btoa(MOCK_USER_ID).slice(0, 24);

export function getMockApiKey(): string {
  return MOCK_API_KEY;
}

export function getMockUserId(): string {
  return MOCK_USER_ID;
}
```

---

## API Endpoints Needed

### Existing Endpoints (from src/routes.ts)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/timeline/:user_id` | Get user's timeline |
| GET | `/api/v1/timeline/:user_id/raw/:platform?account_id=` | Get raw platform data |
| GET | `/api/v1/connections` | List user's connections |
| POST | `/api/v1/connections` | Add new connection |
| DELETE | `/api/v1/connections/:account_id` | Remove connection |
| POST | `/api/v1/connections/:account_id/members` | Add member to connection |

### New Endpoints Needed (~100 LOC in src/routes.ts)

#### POST `/api/v1/connections/:account_id/refresh`
Trigger immediate refresh for a specific connection.

```typescript
connectionRoutes.post("/:account_id/refresh", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");

  // Verify ownership
  const membership = await ctx.db
    .select({ role: accountMembers.role })
    .from(accountMembers)
    .where(and(
      eq(accountMembers.user_id, auth.user_id),
      eq(accountMembers.account_id, accountId)
    ))
    .get();

  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  // Get account details
  const account = await ctx.db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();

  if (!account || !account.is_active) {
    return c.json({ error: "Account not active" }, 400);
  }

  // Process the account (reuse cron logic)
  // This would need to be extracted from cron.ts
  try {
    await processAccountImmediate(ctx, account);
    return c.json({ status: "refreshed" });
  } catch (e) {
    return c.json({ error: "Refresh failed", message: String(e) }, 500);
  }
});
```

#### POST `/api/v1/connections/refresh-all`
Trigger refresh for all user's connections.

```typescript
connectionRoutes.post("/refresh-all", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);

  const userAccounts = await ctx.db
    .select({ account_id: accountMembers.account_id })
    .from(accountMembers)
    .where(eq(accountMembers.user_id, auth.user_id));

  const results = await Promise.allSettled(
    userAccounts.map(({ account_id }) => 
      processAccountImmediate(ctx, account_id)
    )
  );

  const succeeded = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;

  return c.json({ 
    status: "completed",
    succeeded,
    failed,
    total: userAccounts.length 
  });
});
```

---

## Local Development Setup

### 1. Update Root package.json

```json
{
  "name": "media-timeline",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "bun run scripts/dev.ts",
    "dev:api": "sst dev",
    "dev:ui": "bun --filter @media-timeline/website dev",
    "build": "bun --filter @media-timeline/website build",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "typecheck": "tsc --noEmit && bun --filter @media-timeline/website check"
  }
}
```

### 2. Create scripts/dev.ts (~100 LOC)

```typescript
#!/usr/bin/env bun
/**
 * Unified development server
 * Boots both the API (with in-memory backends) and the UI
 */

import { spawn } from "bun";
import { createTestContext, seedUser, seedApiKey } from "../__tests__/integration/setup";

const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = "mt_mock_" + btoa(MOCK_USER_ID).slice(0, 24);

async function startDevServer() {
  console.log("Starting Media Timeline Development Server...\n");

  // Create test context with in-memory backends
  const ctx = createTestContext();
  
  // Seed mock user
  await seedUser(ctx, { id: MOCK_USER_ID, email: "dev@localhost" });
  await seedApiKey(ctx, MOCK_USER_ID, MOCK_API_KEY, "dev-key");

  console.log("Mock user created:");
  console.log(`  User ID: ${MOCK_USER_ID}`);
  console.log(`  API Key: ${MOCK_API_KEY}\n`);

  // Start API server (in-memory mode)
  const apiProcess = spawn({
    cmd: ["bun", "run", "wrangler", "dev", "--local", "--persist-to=.wrangler/dev"],
    env: {
      ...process.env,
      DEV_MODE: "memory",
      DEV_USER_ID: MOCK_USER_ID,
      DEV_API_KEY: MOCK_API_KEY,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  console.log("API server starting on http://localhost:8787");

  // Wait for API to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start UI server
  const uiProcess = spawn({
    cmd: ["bun", "run", "--filter", "@media-timeline/website", "dev"],
    env: {
      ...process.env,
      PUBLIC_API_URL: "http://localhost:8787",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  console.log("UI server starting on http://localhost:4321\n");
  console.log("Press Ctrl+C to stop both servers.\n");

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    apiProcess.kill();
    uiProcess.kill();
    ctx.cleanup();
    process.exit(0);
  });
}

startDevServer().catch(console.error);
```

### 3. Create apps/website/package.json

```json
{
  "name": "@media-timeline/website",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "check": "astro check",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/check": "0.9.4",
    "@astrojs/solid-js": "5.0.4",
    "astro": "^5.13.7",
    "lucide-solid": "^0.454.0",
    "solid-js": "^1.9.3",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

### 4. Create apps/website/astro.config.mjs

```javascript
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  integrations: [solidJs()],
  vite: {
    resolve: {
      alias: {
        "@": "/src",
      },
    },
  },
});
```

---

## Mock User Implementation

### Option 1: Header-Based (Development Only)
The API checks for `X-Dev-Mode: true` header and auto-injects mock user.

**In src/auth.ts:**
```typescript
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  // Development bypass
  if (c.env.ENVIRONMENT === "development" && c.req.header("X-Dev-Mode") === "true") {
    c.set("auth", { 
      user_id: c.env.DEV_USER_ID ?? "mock-user-001",
      key_id: "dev-key" 
    });
    return next();
  }
  // ... rest of auth logic
};
```

### Option 2: Pre-seeded API Key
During `bun dev`, a mock user and API key are seeded into the in-memory database.

```typescript
// In scripts/dev.ts
const MOCK_USER_ID = "mock-user-001";
const MOCK_API_KEY = "mt_mock_" + btoa(MOCK_USER_ID).slice(0, 24);

await seedUser(ctx, { id: MOCK_USER_ID, email: "dev@localhost" });
await seedApiKey(ctx, MOCK_USER_ID, MOCK_API_KEY, "dev-key");

// UI sends this key in Authorization header
```

**Recommendation**: Use Option 2 (pre-seeded API key) for consistency with production auth flow.

---

## Testing Plan

### 1. Unit Tests (`__tests__/unit/timeline-rendering.test.ts`) ~100 LOC

Test pure functions for timeline data transformation:

```typescript
import { describe, expect, test } from "bun:test";
import { formatDate, formatRelativeTime, formatTime } from "../../apps/website/src/utils/formatters";

describe("Timeline Formatters", () => {
  test("formatDate renders human-readable date", () => {
    expect(formatDate("2024-12-25")).toBe("December 25, 2024");
  });

  test("formatRelativeTime shows 'just now' for recent times", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  test("formatTime extracts HH:MM", () => {
    expect(formatTime("2024-12-25T14:30:00Z")).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("Platform Icon Selection", () => {
  test("returns correct icon for each platform", () => {
    // Test icon selection logic
  });
});
```

### 2. Integration Tests (`__tests__/integration/ui-integration.test.ts`) ~200 LOC

Test UI components against in-memory API:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createTestContext, createTestApp, seedUser, seedAccount, seedApiKey } from "./setup";

describe("UI Integration", () => {
  let ctx: ReturnType<typeof createTestContext>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    ctx = createTestContext();
    app = createTestApp(ctx);
    
    await seedUser(ctx, { id: "user-1" });
    await seedApiKey(ctx, "user-1", "test-key");
    await seedAccount(ctx, "user-1", {
      id: "acc-1",
      platform: "github",
      access_token: "ghp_test123",
    });
  });

  afterEach(() => ctx.cleanup());

  test("GET /connections returns user's connections", async () => {
    const res = await app.request("/api/v1/connections", {
      headers: { Authorization: "Bearer test-key" },
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].platform).toBe("github");
  });

  test("POST /connections creates new connection", async () => {
    const res = await app.request("/api/v1/connections", {
      method: "POST",
      headers: { 
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        platform: "bluesky",
        access_token: "bsky_token",
        platform_username: "user.bsky.social",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.account_id).toBeDefined();
  });

  test("DELETE /connections/:id removes connection", async () => {
    const res = await app.request("/api/v1/connections/acc-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-key" },
    });

    expect(res.status).toBe(200);
    
    // Verify it's marked inactive
    const listRes = await app.request("/api/v1/connections", {
      headers: { Authorization: "Bearer test-key" },
    });
    const data = await listRes.json();
    expect(data.accounts.filter(a => a.is_active)).toHaveLength(0);
  });
});
```

---

## Implementation Phases

### Phase 1: Foundation (Day 1-2) ~400 LOC
| Task | LOC | Parallel | Dependency |
|------|-----|----------|------------|
| Create apps/website folder structure | 50 | Yes | None |
| Copy and adapt main.css from devpad | 100 | Yes | None |
| Create Layout.astro and AppLayout.astro | 100 | Yes | CSS |
| Create api-client.ts | 100 | Yes | None |
| Create dev server script | 50 | No | api-client |

**Deliverable**: UI project scaffolding, layouts render, API client works.

### Phase 2: Connection Management (Day 2-3) ~450 LOC
| Task | LOC | Parallel | Dependency |
|------|-----|----------|------------|
| Create ConnectionList.tsx | 120 | Yes | api-client |
| Create ConnectionCard.tsx | 100 | Yes | api-client |
| Create ConnectionForm.tsx | 150 | Yes | api-client |
| Create /connections/index.astro page | 40 | No | Components |
| Create /connections/new.astro page | 40 | No | Components |

**Deliverable**: Users can view, add, and remove connections.

### Phase 3: Timeline Display (Day 3-4) ~500 LOC
| Task | LOC | Parallel | Dependency |
|------|-----|----------|------------|
| Create TimelineList.tsx | 200 | Yes | api-client |
| Create TimelineItem.tsx | 150 | Yes | None |
| Create RawDataViewer.tsx | 50 | Yes | None |
| Create ViewToggle.tsx | 30 | Yes | None |
| Create /index.astro (dashboard) | 70 | No | Components |

**Deliverable**: Users can view their timeline in rendered and raw formats.

### Phase 4: Refresh & Polish (Day 4-5) ~300 LOC
| Task | LOC | Parallel | Dependency |
|------|-----|----------|------------|
| Create RefreshButton.tsx | 60 | Yes | api-client |
| Add refresh API endpoints | 100 | No | None |
| Create PlatformIcon.tsx | 40 | Yes | None |
| Create LoadingIndicator.tsx | 30 | Yes | None |
| Create ToastManager.tsx | 70 | Yes | None |

**Deliverable**: Users can manually refresh data, see loading states.

### Phase 5: Testing & Documentation (Day 5-6) ~300 LOC
| Task | LOC | Parallel | Dependency |
|------|-----|----------|------------|
| Unit tests for formatters | 100 | Yes | None |
| Integration tests for UI+API | 200 | No | All components |

**Deliverable**: Test coverage for UI, ready for deployment.

---

## Deployment Configuration

### Cloudflare Pages Setup

**wrangler.toml (for Pages)**:
```toml
name = "media-timeline-ui"
compatibility_date = "2024-12-01"

[env.production]
vars = { PUBLIC_API_URL = "https://media-api.devpad.tools" }

[env.staging]
vars = { PUBLIC_API_URL = "https://media-api-staging.devpad.tools" }
```

**Build Command**: `bun run build`
**Output Directory**: `apps/website/dist`

### GitHub Actions (.github/workflows/deploy-ui.yml)
```yaml
name: Deploy UI

on:
  push:
    branches: [main]
    paths:
      - 'apps/website/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          command: pages deploy apps/website/dist --project-name=media-timeline
```

---

## Limitations

1. **No OAuth UI**: Users must manually obtain tokens. OAuth flows are planned for future.

2. **No Real-time Updates**: Timeline requires manual refresh. WebSocket support is future work.

3. **Single User Focus**: UI assumes one authenticated user. Multi-user switching not implemented.

4. **Static Build**: Astro builds to static files. SSR could be added later if needed.

5. **No Search/Filter**: Timeline shows all data. Filtering is a future feature.

---

## Summary

### Total Estimated Effort
| Category | LOC | Time |
|----------|-----|------|
| Layout & CSS | 200 | 0.5 days |
| Connection Management | 450 | 1.5 days |
| Timeline Display | 500 | 1.5 days |
| Refresh & Utils | 300 | 1 day |
| Testing | 300 | 1 day |
| Dev Server & Config | 150 | 0.5 day |
| **Total** | **~1,900** | **6 days** |

### Critical Approvals Needed
1. **Confirm monorepo structure**: Adding `apps/website` folder
2. **Confirm technology choices**: Astro + SolidJS (vs alternatives)
3. **Mock user approach**: Pre-seeded API key vs header bypass

### Files to Copy from Devpad
- `packages/app/src/main.css` -> `apps/website/src/main.css`
- Component patterns from `packages/app/src/components/solid/`

### Next Steps
1. Create `apps/website` folder structure
2. Copy and adapt CSS from devpad
3. Implement Layout components
4. Implement Connection management
5. Implement Timeline display
6. Add refresh functionality
7. Write tests
8. Configure deployment
