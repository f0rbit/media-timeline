# Connections UI Redesign - Implementation Plan

## Executive Summary

This plan transforms the connections management experience from a multi-page flow to a single unified page where each platform is represented as a card with contextual states and inline configuration.

### Key Changes
- **Single page**: All connection management on `/connections`
- **Card-per-platform**: Each of the 4 platforms (GitHub, Bluesky, YouTube, Devpad) always shown
- **State-driven UI**: Cards transition between `not_configured`, `inactive`, and `active`
- **Inline configuration**: Platform-specific settings (repo visibility, filters) shown within active cards
- **Delete `/connections/new`**: Add flow moves inline to cards

---

## UI/UX Design

### Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Connections                                        [Refresh All] │
│  Manage your connected platforms                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [GitHub Icon]  GitHub                            ● Active   │ │
│  │ @username · Last synced: 5 minutes ago                      │ │
│  │                                                              │ │
│  │ Repository Visibility                          [⟳] [⏸] [🗑] │ │
│  │ ┌──────────────────────────────────────────────────────────┐│ │
│  │ │ ☑ f0rbit/devpad                              12 commits ││ │
│  │ │ ☑ f0rbit/media-timeline                       8 commits ││ │
│  │ │ ☐ f0rbit/dotfiles                             0 commits ││ │
│  │ └──────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [Bluesky Icon]  Bluesky                        ○ Inactive   │ │
│  │ @user.bsky.social · Paused                                  │ │
│  │                                                   [▶] [🗑]   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [YouTube Icon]  YouTube                      ◯ Not Connected│ │
│  │                                                              │ │
│  │  API Key:  [________________________]                        │ │
│  │  Channel:  [________________________] (optional)             │ │
│  │                                             [Connect YouTube]│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [Devpad Icon]  Devpad                        ◯ Not Connected│ │
│  │                                                              │ │
│  │  API Token: [________________________]                       │ │
│  │  Username:  [________________________] (optional)            │ │
│  │                                               [Connect Devpad]│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Card State Designs

#### State: `not_configured`
```
┌─────────────────────────────────────────────────────────────┐
│ [Icon]  Platform Name                      ◯ Not Connected  │
│                                                             │
│  [Platform-specific credential form]                        │
│                                                             │
│                                    [Connect {Platform}]     │
└─────────────────────────────────────────────────────────────┘
```
- Light border/background
- Credential input form shown inline
- Primary action button to connect

#### State: `inactive`
```
┌─────────────────────────────────────────────────────────────┐
│ [Icon]  Platform Name                        ○ Inactive     │
│ @username · Paused                                          │
│                                                 [▶] [🗑]    │
└─────────────────────────────────────────────────────────────┘
```
- Greyed out / muted styling (opacity: 0.7)
- "Resume" button (play icon)
- "Delete" button (trash icon)
- No configuration section shown

#### State: `active`
```
┌─────────────────────────────────────────────────────────────┐
│ [Icon]  Platform Name                          ● Active     │
│ @username · Last synced: X minutes ago                      │
│                                                             │
│ [Platform-specific configuration]               [⟳] [⏸] [🗑] │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
- Full color, solid border
- "Refresh" button (spinning on action)
- "Pause" button (pause icon)
- "Delete" button (trash icon)
- Platform-specific configuration section

### Platform-Specific Configuration

#### GitHub (Active State)
```
Repository Visibility
─────────────────────────────────────────────────────
☑ f0rbit/devpad                            12 commits
☑ f0rbit/media-timeline                     8 commits
☐ f0rbit/dotfiles (hidden)                  2 commits
─────────────────────────────────────────────────────
Showing 2 of 3 repositories
```

- Toggle to include/exclude repos from timeline
- Shows commit count per repo (from last 30 days)
- Hidden repos greyed out with "(hidden)" label

#### Bluesky (Active State)
```
Content Filters
─────────────────────────────────────────────────────
☑ Include my posts
☑ Include replies
☐ Include reposts
─────────────────────────────────────────────────────
```

#### YouTube (Active State)
```
Channel Settings
─────────────────────────────────────────────────────
Channel: UC_xxxxx (My Channel Name)
☑ Include watch history
☐ Include liked videos
─────────────────────────────────────────────────────
```

#### Devpad (Active State)
```
Project Filters
─────────────────────────────────────────────────────
☑ All projects
○ Select projects:
   ☑ Project A
   ☑ Project B
   ☐ Project C
─────────────────────────────────────────────────────
```

---

## Data Model Changes

### Schema Changes

#### 1. New `account_settings` table

```sql
-- migrations/0002_account_settings.sql
CREATE TABLE account_settings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,  -- JSON-encoded value
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, setting_key)
);

CREATE INDEX idx_account_settings_account ON account_settings(account_id);
```

#### 2. Drizzle Schema Addition

```typescript
// src/schema/database.ts - ADD

export const accountSettings = sqliteTable(
  "account_settings",
  {
    id: text("id").primaryKey(),
    account_id: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    setting_key: text("setting_key").notNull(),
    setting_value: text("setting_value").notNull(), // JSON
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  table => ({
    account_key_idx: uniqueIndex("idx_account_settings_unique").on(
      table.account_id,
      table.setting_key
    ),
    account_idx: index("idx_account_settings_account").on(table.account_id),
  })
);
```

#### 3. Setting Keys by Platform

| Platform | Setting Key | Value Type | Example |
|----------|-------------|------------|---------|
| GitHub | `hidden_repos` | `string[]` | `["f0rbit/dotfiles"]` |
| Bluesky | `include_replies` | `boolean` | `true` |
| Bluesky | `include_reposts` | `boolean` | `false` |
| YouTube | `include_watch_history` | `boolean` | `true` |
| YouTube | `include_liked` | `boolean` | `false` |
| Devpad | `hidden_projects` | `string[]` | `["proj-123"]` |

#### 4. Zod Schemas for Settings

```typescript
// src/schema/settings.ts - NEW FILE

import { z } from "zod";

export const GitHubSettingsSchema = z.object({
  hidden_repos: z.array(z.string()).default([]),
});

export const BlueskySettingsSchema = z.object({
  include_replies: z.boolean().default(true),
  include_reposts: z.boolean().default(false),
});

export const YouTubeSettingsSchema = z.object({
  include_watch_history: z.boolean().default(true),
  include_liked: z.boolean().default(false),
});

export const DevpadSettingsSchema = z.object({
  hidden_projects: z.array(z.string()).default([]),
});

export type GitHubSettings = z.infer<typeof GitHubSettingsSchema>;
export type BlueskySettings = z.infer<typeof BlueskySettingsSchema>;
export type YouTubeSettings = z.infer<typeof YouTubeSettingsSchema>;
export type DevpadSettings = z.infer<typeof DevpadSettingsSchema>;
```

---

## API Changes

### New Endpoints

#### 1. `PATCH /api/v1/connections/:account_id` - Update connection status

```typescript
// Toggle active status (pause/resume)
const UpdateConnectionBodySchema = z.object({
  is_active: z.boolean().optional(),
});

connectionRoutes.patch("/:account_id", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");
  const body = UpdateConnectionBodySchema.parse(await c.req.json());

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

  const now = new Date().toISOString();
  await ctx.db
    .update(accounts)
    .set({ 
      is_active: body.is_active,
      updated_at: now 
    })
    .where(eq(accounts.id, accountId));

  return c.json({ updated: true });
});
```

#### 2. `GET /api/v1/connections/:account_id/settings` - Get platform settings

```typescript
connectionRoutes.get("/:account_id/settings", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");

  // Verify access
  const membership = await ctx.db
    .select()
    .from(accountMembers)
    .where(and(
      eq(accountMembers.user_id, auth.user_id),
      eq(accountMembers.account_id, accountId)
    ))
    .get();

  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const settings = await ctx.db
    .select()
    .from(accountSettings)
    .where(eq(accountSettings.account_id, accountId));

  // Convert to key-value map
  const settingsMap = settings.reduce((acc, s) => {
    acc[s.setting_key] = JSON.parse(s.setting_value);
    return acc;
  }, {} as Record<string, unknown>);

  return c.json({ settings: settingsMap });
});
```

#### 3. `PUT /api/v1/connections/:account_id/settings` - Update platform settings

```typescript
const UpdateSettingsBodySchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

connectionRoutes.put("/:account_id/settings", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");
  const body = UpdateSettingsBodySchema.parse(await c.req.json());

  // Verify ownership (only owners can change settings)
  const membership = await ctx.db
    .select({ role: accountMembers.role })
    .from(accountMembers)
    .where(and(
      eq(accountMembers.user_id, auth.user_id),
      eq(accountMembers.account_id, accountId)
    ))
    .get();

  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const now = new Date().toISOString();

  // Upsert each setting
  for (const [key, value] of Object.entries(body.settings)) {
    const existing = await ctx.db
      .select()
      .from(accountSettings)
      .where(and(
        eq(accountSettings.account_id, accountId),
        eq(accountSettings.setting_key, key)
      ))
      .get();

    if (existing) {
      await ctx.db
        .update(accountSettings)
        .set({ 
          setting_value: JSON.stringify(value),
          updated_at: now 
        })
        .where(eq(accountSettings.id, existing.id));
    } else {
      await ctx.db.insert(accountSettings).values({
        id: crypto.randomUUID(),
        account_id: accountId,
        setting_key: key,
        setting_value: JSON.stringify(value),
        created_at: now,
        updated_at: now,
      });
    }
  }

  return c.json({ updated: true });
});
```

#### 4. `GET /api/v1/connections/:account_id/repos` - Get GitHub repos (metadata)

```typescript
// Only for GitHub - returns discovered repos from raw data
connectionRoutes.get("/:account_id/repos", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const accountId = c.req.param("account_id");

  // Verify access and platform
  const account = await ctx.db
    .select()
    .from(accounts)
    .innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
    .where(and(
      eq(accountMembers.user_id, auth.user_id),
      eq(accounts.id, accountId)
    ))
    .get();

  if (!account) {
    return c.json({ error: "Not found" }, 404);
  }

  if (account.accounts.platform !== "github") {
    return c.json({ error: "Not a GitHub account" }, 400);
  }

  // Get raw data to extract repos
  const rawStore = createRawStore(ctx.backend, "github", accountId);
  const latest = await rawStore.store.get_latest();
  
  if (!latest.ok) {
    return c.json({ repos: [] });
  }

  // Extract unique repos from events
  const repos = extractReposFromGitHubData(latest.value.data);
  
  return c.json({ repos });
});

function extractReposFromGitHubData(data: unknown): Array<{
  name: string;
  commit_count: number;
}> {
  // Extract from GitHub events
  const events = (data as any)?.events ?? [];
  const repoMap = new Map<string, number>();
  
  for (const event of events) {
    if (event.type === "PushEvent" && event.repo?.name) {
      const current = repoMap.get(event.repo.name) ?? 0;
      const commits = event.payload?.commits?.length ?? 1;
      repoMap.set(event.repo.name, current + commits);
    }
  }

  return Array.from(repoMap.entries())
    .map(([name, commit_count]) => ({ name, commit_count }))
    .sort((a, b) => b.commit_count - a.commit_count);
}
```

### Updated Endpoints

#### `GET /api/v1/connections` - Include settings in response

```typescript
// Modify existing endpoint to optionally include settings
connectionRoutes.get("/", async c => {
  const auth = getAuth(c);
  const ctx = getContext(c);
  const includeSettings = c.req.query("include_settings") === "true";

  const results = await ctx.db
    .select({
      account_id: accounts.id,
      platform: accounts.platform,
      platform_username: accounts.platform_username,
      is_active: accounts.is_active,
      last_fetched_at: accounts.last_fetched_at,
      role: accountMembers.role,
      created_at: accountMembers.created_at,
    })
    .from(accountMembers)
    .innerJoin(accounts, eq(accountMembers.account_id, accounts.id))
    .where(eq(accountMembers.user_id, auth.user_id));

  if (!includeSettings) {
    return c.json({ accounts: results });
  }

  // Fetch settings for each account
  const accountsWithSettings = await Promise.all(
    results.map(async account => {
      const settings = await ctx.db
        .select()
        .from(accountSettings)
        .where(eq(accountSettings.account_id, account.account_id));

      const settingsMap = settings.reduce((acc, s) => {
        acc[s.setting_key] = JSON.parse(s.setting_value);
        return acc;
      }, {} as Record<string, unknown>);

      return { ...account, settings: settingsMap };
    })
  );

  return c.json({ accounts: accountsWithSettings });
});
```

---

## Frontend Components

### New Component Structure

```
apps/website/src/components/solid/
├── ConnectionCard.tsx          # REWRITE - State-driven card
├── ConnectionForm.tsx          # DELETE (move into PlatformSetupForm)
├── ConnectionList.tsx          # REWRITE - Show all platforms as cards
├── PlatformCard.tsx            # NEW - Container for each platform
├── PlatformSetupForm.tsx       # NEW - Inline setup form per platform
├── PlatformSettings/           # NEW - Platform-specific settings
│   ├── GitHubSettings.tsx
│   ├── BlueskySettings.tsx
│   ├── YouTubeSettings.tsx
│   └── DevpadSettings.tsx
├── ConnectionActions.tsx       # NEW - Action buttons (refresh, pause, delete)
├── StatusBadge.tsx             # NEW - Active/Inactive/Not Connected indicator
├── PlatformIcon.tsx            # KEEP
├── RawDataViewer.tsx           # KEEP
└── TimelineList.tsx            # KEEP
```

### Component Implementations

#### 1. `PlatformCard.tsx` (~150 LOC)

Main container component that renders different states.

```tsx
import { createSignal, Show, Match, Switch } from "solid-js";
import type { Connection, PlatformSettings } from "@/utils/api-client";
import StatusBadge from "./StatusBadge";
import PlatformIcon from "./PlatformIcon";
import PlatformSetupForm from "./PlatformSetupForm";
import ConnectionActions from "./ConnectionActions";
import GitHubSettings from "./PlatformSettings/GitHubSettings";
import BlueskySettings from "./PlatformSettings/BlueskySettings";
import YouTubeSettings from "./PlatformSettings/YouTubeSettings";
import DevpadSettings from "./PlatformSettings/DevpadSettings";
import { formatPlatformName, formatRelativeTime } from "@/utils/formatters";

type Platform = "github" | "bluesky" | "youtube" | "devpad";

type CardState = "not_configured" | "inactive" | "active";

interface Props {
  platform: Platform;
  connection: Connection | null;
  settings: PlatformSettings | null;
  onConnectionChange: () => void;
}

export default function PlatformCard(props: Props) {
  const state = (): CardState => {
    if (!props.connection) return "not_configured";
    return props.connection.is_active ? "active" : "inactive";
  };

  const cardClass = () => {
    const base = `card platform-${props.platform}`;
    if (state() === "inactive") return `${base} card-inactive`;
    if (state() === "not_configured") return `${base} card-setup`;
    return base;
  };

  return (
    <div class={cardClass()}>
      {/* Header */}
      <div class="flex-row" style={{ "justify-content": "space-between" }}>
        <div class="flex-row" style={{ gap: "12px" }}>
          <PlatformIcon platform={props.platform} size={24} />
          <div class="flex-col" style={{ gap: "2px" }}>
            <h6>{formatPlatformName(props.platform)}</h6>
            <Show when={props.connection}>
              <span class="description">
                {props.connection!.platform_username ?? "Connected"}
                <Show when={state() === "inactive"}> · Paused</Show>
                <Show when={state() === "active" && props.connection!.last_fetched_at}>
                  {" "}· Last synced: {formatRelativeTime(props.connection!.last_fetched_at!)}
                </Show>
              </span>
            </Show>
          </div>
        </div>
        <div class="flex-row" style={{ gap: "8px" }}>
          <StatusBadge state={state()} />
          <Show when={props.connection}>
            <ConnectionActions
              connection={props.connection!}
              state={state()}
              onAction={props.onConnectionChange}
            />
          </Show>
        </div>
      </div>

      {/* Body - varies by state */}
      <Switch>
        <Match when={state() === "not_configured"}>
          <PlatformSetupForm
            platform={props.platform}
            onSuccess={props.onConnectionChange}
          />
        </Match>
        <Match when={state() === "active"}>
          <div class="platform-settings">
            <Switch>
              <Match when={props.platform === "github"}>
                <GitHubSettings
                  accountId={props.connection!.account_id}
                  settings={props.settings as any}
                  onUpdate={props.onConnectionChange}
                />
              </Match>
              <Match when={props.platform === "bluesky"}>
                <BlueskySettings
                  accountId={props.connection!.account_id}
                  settings={props.settings as any}
                  onUpdate={props.onConnectionChange}
                />
              </Match>
              <Match when={props.platform === "youtube"}>
                <YouTubeSettings
                  accountId={props.connection!.account_id}
                  settings={props.settings as any}
                  onUpdate={props.onConnectionChange}
                />
              </Match>
              <Match when={props.platform === "devpad"}>
                <DevpadSettings
                  accountId={props.connection!.account_id}
                  settings={props.settings as any}
                  onUpdate={props.onConnectionChange}
                />
              </Match>
            </Switch>
          </div>
        </Match>
        {/* inactive state shows nothing extra */}
      </Switch>
    </div>
  );
}
```

#### 2. `ConnectionList.tsx` (~80 LOC) - Rewrite

```tsx
import { createResource, For, Show } from "solid-js";
import { connections, initMockAuth, type Connection } from "@/utils/api-client";
import PlatformCard from "./PlatformCard";

const PLATFORMS = ["github", "bluesky", "youtube", "devpad"] as const;
type Platform = (typeof PLATFORMS)[number];

export default function ConnectionList() {
  initMockAuth();

  const [data, { refetch }] = createResource(async () => {
    const result = await connections.listWithSettings();
    if (!result.ok) throw new Error(result.error.message);
    return result.data.accounts;
  });

  const getConnection = (platform: Platform): Connection | null => {
    return data()?.find(c => c.platform === platform) ?? null;
  };

  const getSettings = (platform: Platform) => {
    const conn = getConnection(platform);
    return conn?.settings ?? null;
  };

  return (
    <div class="flex-col">
      <Show when={data.loading}>
        <p class="description">Loading connections...</p>
      </Show>

      <Show when={data.error}>
        <p class="error-icon">Failed to load: {data.error.message}</p>
      </Show>

      <Show when={data()}>
        <For each={PLATFORMS}>
          {platform => (
            <PlatformCard
              platform={platform}
              connection={getConnection(platform)}
              settings={getSettings(platform)}
              onConnectionChange={refetch}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
```

#### 3. `StatusBadge.tsx` (~40 LOC)

```tsx
type State = "not_configured" | "inactive" | "active";

interface Props {
  state: State;
}

export default function StatusBadge(props: Props) {
  const config = {
    not_configured: { label: "Not Connected", class: "status-not-connected", icon: "◯" },
    inactive: { label: "Inactive", class: "status-inactive", icon: "○" },
    active: { label: "Active", class: "status-active", icon: "●" },
  };

  const { label, class: cls, icon } = config[props.state];

  return (
    <span class={`status-badge ${cls}`}>
      <span class="status-icon">{icon}</span>
      <span class="status-label">{label}</span>
    </span>
  );
}
```

#### 4. `ConnectionActions.tsx` (~100 LOC)

```tsx
import { createSignal, Show } from "solid-js";
import { connections } from "@/utils/api-client";

interface Props {
  connection: { account_id: string; is_active: boolean };
  state: "active" | "inactive";
  onAction: () => void;
}

export default function ConnectionActions(props: Props) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [toggling, setToggling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await connections.refresh(props.connection.account_id);
    setRefreshing(false);
    props.onAction();
  };

  const handleToggle = async () => {
    setToggling(true);
    await connections.update(props.connection.account_id, {
      is_active: !props.connection.is_active,
    });
    setToggling(false);
    props.onAction();
  };

  const handleDelete = async () => {
    if (!confirm("Remove this connection? This cannot be undone.")) return;
    setDeleting(true);
    await connections.delete(props.connection.account_id);
    setDeleting(false);
    props.onAction();
  };

  return (
    <div class="flex-row icons">
      <Show when={props.state === "active"}>
        <button
          class="icon-btn"
          onClick={handleRefresh}
          disabled={refreshing()}
          title="Refresh data"
        >
          <RefreshIcon spinning={refreshing()} />
        </button>
        <button
          class="icon-btn"
          onClick={handleToggle}
          disabled={toggling()}
          title="Pause syncing"
        >
          <PauseIcon />
        </button>
      </Show>
      <Show when={props.state === "inactive"}>
        <button
          class="icon-btn"
          onClick={handleToggle}
          disabled={toggling()}
          title="Resume syncing"
        >
          <PlayIcon />
        </button>
      </Show>
      <button
        class="icon-btn"
        onClick={handleDelete}
        disabled={deleting()}
        title="Remove connection"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

// Icon components (simplified)
function RefreshIcon(props: { spinning?: boolean }) { /* ... */ }
function PauseIcon() { /* ... */ }
function PlayIcon() { /* ... */ }
function TrashIcon() { /* ... */ }
```

#### 5. `PlatformSetupForm.tsx` (~120 LOC)

Inline form shown when platform not connected.

```tsx
import { createSignal, Show } from "solid-js";
import { connections } from "@/utils/api-client";

type Platform = "github" | "bluesky" | "youtube" | "devpad";

interface Props {
  platform: Platform;
  onSuccess: () => void;
}

const PLATFORM_CONFIG: Record<Platform, {
  tokenLabel: string;
  tokenPlaceholder: string;
  usernameLabel: string;
  usernamePlaceholder: string;
  helpText: string;
}> = {
  github: {
    tokenLabel: "Personal Access Token",
    tokenPlaceholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
    usernameLabel: "GitHub Username",
    usernamePlaceholder: "your-username",
    helpText: "Generate a token at github.com/settings/tokens",
  },
  bluesky: {
    tokenLabel: "App Password",
    tokenPlaceholder: "xxxx-xxxx-xxxx-xxxx",
    usernameLabel: "Handle",
    usernamePlaceholder: "user.bsky.social",
    helpText: "Create an app password in Settings > App Passwords",
  },
  youtube: {
    tokenLabel: "API Key",
    tokenPlaceholder: "AIzaSy...",
    usernameLabel: "Channel ID",
    usernamePlaceholder: "UC...",
    helpText: "Get an API key from console.developers.google.com",
  },
  devpad: {
    tokenLabel: "API Token",
    tokenPlaceholder: "dp_...",
    usernameLabel: "Username",
    usernamePlaceholder: "your-username",
    helpText: "Generate a token in your Devpad settings",
  },
};

export default function PlatformSetupForm(props: Props) {
  const config = PLATFORM_CONFIG[props.platform];
  
  const [token, setToken] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await connections.create({
      platform: props.platform,
      access_token: token(),
      platform_username: username() || undefined,
    });

    if (!result.ok) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    props.onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} class="setup-form">
      <div class="form-row">
        <label>{config.tokenLabel}</label>
        <input
          type="password"
          value={token()}
          onInput={e => setToken(e.currentTarget.value)}
          placeholder={config.tokenPlaceholder}
          required
        />
      </div>
      <div class="form-row">
        <label>{config.usernameLabel} (optional)</label>
        <input
          type="text"
          value={username()}
          onInput={e => setUsername(e.currentTarget.value)}
          placeholder={config.usernamePlaceholder}
        />
      </div>
      <small class="description">{config.helpText}</small>
      <Show when={error()}>
        <p class="error-icon">{error()}</p>
      </Show>
      <button type="submit" disabled={submitting() || !token()}>
        {submitting() ? "Connecting..." : `Connect ${formatPlatformName(props.platform)}`}
      </button>
    </form>
  );
}
```

#### 6. `PlatformSettings/GitHubSettings.tsx` (~100 LOC)

```tsx
import { createResource, createSignal, For, Show } from "solid-js";
import { connections } from "@/utils/api-client";

interface GitHubRepo {
  name: string;
  commit_count: number;
}

interface Props {
  accountId: string;
  settings: { hidden_repos?: string[] } | null;
  onUpdate: () => void;
}

export default function GitHubSettings(props: Props) {
  const [repos] = createResource(async () => {
    const result = await connections.getRepos(props.accountId);
    if (!result.ok) return [];
    return result.data.repos as GitHubRepo[];
  });

  const hiddenRepos = () => new Set(props.settings?.hidden_repos ?? []);

  const toggleRepo = async (repoName: string) => {
    const hidden = new Set(hiddenRepos());
    if (hidden.has(repoName)) {
      hidden.delete(repoName);
    } else {
      hidden.add(repoName);
    }

    await connections.updateSettings(props.accountId, {
      hidden_repos: Array.from(hidden),
    });
    props.onUpdate();
  };

  return (
    <div class="settings-section">
      <h6 class="settings-title">Repository Visibility</h6>
      <Show when={repos.loading}>
        <p class="description">Loading repositories...</p>
      </Show>
      <Show when={repos()}>
        <div class="repo-list">
          <For each={repos()}>
            {repo => {
              const isHidden = () => hiddenRepos().has(repo.name);
              return (
                <label class={`repo-item ${isHidden() ? "repo-hidden" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!isHidden()}
                    onChange={() => toggleRepo(repo.name)}
                  />
                  <span class="repo-name">{repo.name}</span>
                  <Show when={isHidden()}>
                    <span class="description">(hidden)</span>
                  </Show>
                  <span class="repo-count description">
                    {repo.commit_count} commits
                  </span>
                </label>
              );
            }}
          </For>
        </div>
        <Show when={repos()!.length > 0}>
          <p class="description">
            Showing {repos()!.filter(r => !hiddenRepos().has(r.name)).length} of {repos()!.length} repositories
          </p>
        </Show>
      </Show>
    </div>
  );
}
```

### API Client Updates

```typescript
// apps/website/src/utils/api-client.ts - ADD

export type ConnectionWithSettings = Connection & {
  settings?: Record<string, unknown>;
};

export type ConnectionsWithSettingsResponse = {
  accounts: ConnectionWithSettings[];
};

export const connections = {
  // Existing
  list: () => api.get<ConnectionsResponse>("/connections"),
  create: (data: { platform: string; access_token: string; platform_username?: string }) => 
    api.post<{ account_id: string }>("/connections", data),
  delete: (accountId: string) => 
    api.delete<{ deleted: boolean }>(`/connections/${accountId}`),
  refresh: (accountId: string) => 
    api.post<{ status: string }>(`/connections/${accountId}/refresh`),
  refreshAll: () => 
    api.post<{ status: string; succeeded: number; failed: number }>("/connections/refresh-all"),

  // New
  listWithSettings: () => 
    api.get<ConnectionsWithSettingsResponse>("/connections?include_settings=true"),
  update: (accountId: string, data: { is_active?: boolean }) =>
    api.patch<{ updated: boolean }>(`/connections/${accountId}`, data),
  getSettings: (accountId: string) =>
    api.get<{ settings: Record<string, unknown> }>(`/connections/${accountId}/settings`),
  updateSettings: (accountId: string, settings: Record<string, unknown>) =>
    api.put<{ updated: boolean }>(`/connections/${accountId}/settings`, { settings }),
  getRepos: (accountId: string) =>
    api.get<{ repos: Array<{ name: string; commit_count: number }> }>(`/connections/${accountId}/repos`),
};

// Add PATCH to api object
export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
```

### CSS Additions

```css
/* apps/website/src/main.css - ADD */

/* Card States */
.card-inactive {
  opacity: 0.7;
  border-style: dashed;
}

.card-setup {
  border-style: dashed;
  background: var(--input-background);
}

/* Status Badge */
.status-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--input-background);
  border: 1px solid var(--input-border);
}

.status-active {
  color: oklch(from var(--item-green) 0.6 0.15 h);
}

.status-inactive {
  color: var(--text-muted);
}

.status-not-connected {
  color: var(--text-tertiary);
}

/* Setup Form */
.setup-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--input-border);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row label {
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.form-row input {
  padding: 8px;
}

/* Platform Settings */
.platform-settings {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--input-border);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-title {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0;
}

/* Repo List (GitHub) */
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: var(--input-background);
  border: 1px solid var(--input-border);
  border-radius: 4px;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  cursor: pointer;
}

.repo-item:hover {
  background: var(--input-border);
  border-radius: 2px;
}

.repo-hidden {
  opacity: 0.5;
}

.repo-name {
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
}

.repo-count {
  text-align: right;
  min-width: 80px;
}

/* Toggle Filters (Bluesky, YouTube) */
.filter-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.filter-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
}
```

---

## Implementation Tasks

### Task Dependency Graph

```
┌────────────────────────┐
│ Task 1: DB Migration   │
│ (Critical - Blocking)  │
└──────────┬─────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│                    PARALLEL BLOCK A                       │
├────────────────────┬─────────────────────────────────────┤
│ Task 2: API Routes │ Task 3: Frontend Components         │
│ - PATCH endpoint   │ - StatusBadge                       │
│ - Settings GET/PUT │ - ConnectionActions                 │
│ - Repos GET        │ - PlatformSetupForm                 │
└────────────────────┴─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────┐
│                    PARALLEL BLOCK B                         │
├──────────────────────┬─────────────────────────────────────┤
│ Task 4: PlatformCard │ Task 5: Platform Settings           │
│ (depends on 2, 3)    │ - GitHubSettings                    │
│                      │ - BlueskySettings                   │
│                      │ - YouTubeSettings                   │
│                      │ - DevpadSettings                    │
└──────────────────────┴─────────────────────────────────────┘
           │
           ▼
┌────────────────────────┐
│ Task 6: Integration    │
│ - Rewrite ConnectionList│
│ - Update page           │
│ - Delete /new page      │
└──────────────────────────┘
           │
           ▼
┌────────────────────────┐
│ Task 7: Testing        │
└────────────────────────┘
```

### Task List

#### Task 1: Database Migration (~50 LOC)
**Complexity**: Low | **Parallel**: No (Critical Path) | **Est**: 30 min

**Sub-tasks**:
1. Create `migrations/0002_account_settings.sql`
2. Add `accountSettings` table to `src/schema/database.ts`
3. Create `src/schema/settings.ts` with Zod schemas
4. Run migration locally

**Files**:
- `migrations/0002_account_settings.sql` (new)
- `src/schema/database.ts` (modify)
- `src/schema/settings.ts` (new)
- `src/schema/index.ts` (modify - export)

---

#### Task 2: API Endpoints (~200 LOC)
**Complexity**: Medium | **Parallel**: Yes (after Task 1) | **Est**: 2 hours

**Sub-tasks**:
1. Add `PATCH /connections/:account_id` for status toggle (~40 LOC)
2. Add `GET /connections/:account_id/settings` (~30 LOC)
3. Add `PUT /connections/:account_id/settings` (~50 LOC)
4. Add `GET /connections/:account_id/repos` for GitHub (~50 LOC)
5. Update `GET /connections` to include settings option (~30 LOC)

**Files**:
- `src/routes.ts` (modify)

---

#### Task 3: Base Frontend Components (~200 LOC)
**Complexity**: Medium | **Parallel**: Yes (after Task 1) | **Est**: 2 hours

**Sub-tasks**:
1. Create `StatusBadge.tsx` (~40 LOC)
2. Create `ConnectionActions.tsx` (~100 LOC)
3. Create `PlatformSetupForm.tsx` (~120 LOC) - consolidates old ConnectionForm
4. Update `api-client.ts` with new endpoints (~50 LOC)
5. Add CSS for new components (~50 LOC)

**Files**:
- `apps/website/src/components/solid/StatusBadge.tsx` (new)
- `apps/website/src/components/solid/ConnectionActions.tsx` (new)
- `apps/website/src/components/solid/PlatformSetupForm.tsx` (new)
- `apps/website/src/utils/api-client.ts` (modify)
- `apps/website/src/main.css` (modify)

---

#### Task 4: PlatformCard Component (~150 LOC)
**Complexity**: Medium | **Parallel**: No (depends on 2, 3) | **Est**: 1.5 hours

**Sub-tasks**:
1. Create `PlatformCard.tsx` with state-driven rendering
2. Integrate StatusBadge, ConnectionActions, PlatformSetupForm
3. Add platform-specific settings switching

**Files**:
- `apps/website/src/components/solid/PlatformCard.tsx` (new)

---

#### Task 5: Platform Settings Components (~300 LOC)
**Complexity**: Medium | **Parallel**: Yes (with Task 4) | **Est**: 2.5 hours

**Sub-tasks**:
1. Create `PlatformSettings/GitHubSettings.tsx` (~100 LOC)
2. Create `PlatformSettings/BlueskySettings.tsx` (~60 LOC)
3. Create `PlatformSettings/YouTubeSettings.tsx` (~70 LOC)
4. Create `PlatformSettings/DevpadSettings.tsx` (~70 LOC)

**Files**:
- `apps/website/src/components/solid/PlatformSettings/GitHubSettings.tsx` (new)
- `apps/website/src/components/solid/PlatformSettings/BlueskySettings.tsx` (new)
- `apps/website/src/components/solid/PlatformSettings/YouTubeSettings.tsx` (new)
- `apps/website/src/components/solid/PlatformSettings/DevpadSettings.tsx` (new)

---

#### Task 6: Integration & Page Updates (~100 LOC)
**Complexity**: Low | **Parallel**: No (depends on 4, 5) | **Est**: 1 hour

**Sub-tasks**:
1. Rewrite `ConnectionList.tsx` to show all platforms (~80 LOC)
2. Update `/connections/index.astro` page (~20 LOC)
3. Delete `/connections/new.astro` page
4. Delete old `ConnectionForm.tsx`

**Files**:
- `apps/website/src/components/solid/ConnectionList.tsx` (rewrite)
- `apps/website/src/pages/connections/index.astro` (modify)
- `apps/website/src/pages/connections/new.astro` (delete)
- `apps/website/src/components/solid/ConnectionForm.tsx` (delete)

---

#### Task 7: Testing (~200 LOC)
**Complexity**: Medium | **Parallel**: No (final) | **Est**: 2 hours

**Sub-tasks**:
1. Integration tests for new API endpoints (~100 LOC)
2. Integration tests for settings persistence (~50 LOC)
3. Integration tests for status toggle workflow (~50 LOC)

**Files**:
- `__tests__/integration/connections-ui.test.ts` (new)

---

### Summary Table

| Task | LOC | Time | Parallel With | Depends On |
|------|-----|------|---------------|------------|
| 1. DB Migration | 50 | 0.5h | - | - |
| 2. API Endpoints | 200 | 2h | Task 3 | Task 1 |
| 3. Base Components | 250 | 2h | Task 2 | Task 1 |
| 4. PlatformCard | 150 | 1.5h | Task 5 | Tasks 2, 3 |
| 5. Platform Settings | 300 | 2.5h | Task 4 | Task 2 |
| 6. Integration | 100 | 1h | - | Tasks 4, 5 |
| 7. Testing | 200 | 2h | - | Task 6 |
| **Total** | **~1,250** | **~11.5h** | | |

---

## Approval Required

### Critical Decisions

1. **Settings Storage Strategy**
   - **Proposed**: Key-value table (`account_settings`) with JSON values
   - **Alternative**: JSON column on `accounts` table (simpler but less flexible)
   - **Recommendation**: Proposed approach allows per-setting queries and extensibility

2. **GitHub Repo Discovery**
   - **Proposed**: Extract from raw event data on-demand
   - **Alternative**: Store repos in separate table during cron
   - **Recommendation**: On-demand is simpler and avoids schema changes

3. **Settings Apply Location**
   - **Proposed**: Filter during timeline generation (in cron)
   - **Note**: This affects `src/cron.ts` - not in scope for this UI plan
   - **Recommendation**: UI stores settings; filtering logic is separate task

---

## Limitations

1. **No OAuth Integration**: Users still enter tokens manually. OAuth is a separate feature.

2. **Settings Don't Filter Yet**: This plan covers UI/storage for settings. Actual filtering during timeline generation requires changes to `src/cron.ts` (separate task).

3. **No Bulk Actions**: Can't pause/resume all connections at once (could add later).

4. **No Undo**: Deleting a connection is permanent. Could add soft-delete confirmation.

5. **GitHub Only for Repo Discovery**: Other platforms don't have equivalent "discovery" feature in MVP.

---

## Files Changed Summary

### New Files
- `migrations/0002_account_settings.sql`
- `src/schema/settings.ts`
- `apps/website/src/components/solid/StatusBadge.tsx`
- `apps/website/src/components/solid/ConnectionActions.tsx`
- `apps/website/src/components/solid/PlatformSetupForm.tsx`
- `apps/website/src/components/solid/PlatformCard.tsx`
- `apps/website/src/components/solid/PlatformSettings/GitHubSettings.tsx`
- `apps/website/src/components/solid/PlatformSettings/BlueskySettings.tsx`
- `apps/website/src/components/solid/PlatformSettings/YouTubeSettings.tsx`
- `apps/website/src/components/solid/PlatformSettings/DevpadSettings.tsx`
- `__tests__/integration/connections-ui.test.ts`

### Modified Files
- `src/schema/database.ts` - Add accountSettings table
- `src/schema/index.ts` - Export new schemas
- `src/routes.ts` - Add new endpoints
- `apps/website/src/components/solid/ConnectionList.tsx` - Rewrite
- `apps/website/src/pages/connections/index.astro` - Simplify
- `apps/website/src/utils/api-client.ts` - Add new methods
- `apps/website/src/main.css` - Add new styles

### Deleted Files
- `apps/website/src/pages/connections/new.astro`
- `apps/website/src/components/solid/ConnectionForm.tsx`
