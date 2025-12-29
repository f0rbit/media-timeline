# Profiles Feature - Implementation Plan

## Overview

This document outlines the implementation plan for a **Profiles** feature in media-timeline that allows users to create multiple views of their activity, each with different visibility settings for which platforms/accounts to show.

### Use Case Example

A user has 2 projects: `forbit.dev` and `chamber`
- **forbit.dev profile**: Shows EVERYTHING (all GitHub repos, all tweets, all Reddit posts)
- **chamber profile**: Only shows tweets from the `@chamber` Twitter account

Both profiles are managed from one media-timeline account, authenticated via devpad.

### Goals

1. **Shared Authentication**: media-timeline (`media.devpad.tools`) uses devpad (`devpad.tools`) as the master auth provider
2. **Multiple Profiles**: Users can create multiple profiles under their single devpad account
3. **Granular Visibility**: Each profile can have different visibility settings for platforms/accounts
4. **External API Access**: Profile timeline data is accessible via API using devpad API keys (for embedding on external sites like `forbit.dev`)

### Non-Goals (Out of Scope)

- **No public pages on media-timeline**: Only the landing page is accessible without authentication
- **No public profile URLs on this site**: Profiles are not directly viewable on media.devpad.tools without auth
- **No profile directory/discovery**: External consumers access data via authenticated API only

---

## Architecture

### Authentication Model

There are two distinct authentication contexts:

1. **Web UI Authentication** (user managing their profiles on media.devpad.tools)
2. **External API Authentication** (external sites like forbit.dev fetching profile timeline data)

Since `devpad.tools` and `media.devpad.tools` share the same root domain (`.devpad.tools`), session cookies can be shared between them. This makes web UI authentication seamless.

```
┌─────────────────────────────────────────────────────────────────┐
│                  WEB UI AUTHENTICATION (Same Domain)             │
│                                                                  │
│  1. User clicks "Login" on media.devpad.tools                   │
│  2. Redirects to devpad.tools/login (GitHub OAuth)              │
│  3. After auth, session cookie set on .devpad.tools domain      │
│  4. Redirects back to media.devpad.tools                        │
│  5. Session cookie is readable → user is authenticated          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                EXTERNAL API AUTHENTICATION                       │
│                                                                  │
│  External site (e.g., forbit.dev) has devpad API key            │
│  External site calls: GET /api/v1/profiles/:slug/timeline       │
│  Authorization: Bearer <devpad-api-key>                         │
│  Media-timeline validates key via devpad API → gets user_id     │
│  Media-timeline looks up user in local DB → returns data        │
└─────────────────────────────────────────────────────────────────┘
```

### Web UI Authentication Flow (Shared Session Cookie)

```
┌───────────────────┐     ┌───────────────────┐     ┌───────────────┐
│  media.devpad     │     │   devpad.tools    │     │    GitHub     │
│     .tools        │     │                   │     │               │
│                   │     │                   │     │               │
│  Click Login ─────┼────>│  /login ──────────┼────>│  OAuth        │
│                   │     │                   │<────┤               │
│                   │     │  Set Cookie       │     │               │
│                   │     │  Domain: .devpad.tools               │
│                   │<────┼── Redirect ───────┤     │               │
│                   │     │                   │     │               │
│  Cookie Present ──┼────>│  /api/auth/verify │     │               │
│  User Authed  <───┼─────┤  (validates)      │     │               │
└───────────────────┘     └───────────────────┘     └───────────────┘
```

Key points:
- Lucia session cookie is set with `Domain: .devpad.tools` (note the leading dot)
- This makes the cookie accessible to all subdomains including `media.devpad.tools`
- Media-timeline reads the session cookie and validates via devpad's `/api/auth/verify`
- No JWT needed for same-domain auth - just shared cookies

### External API Authentication Flow (Devpad API Key)

```
┌───────────────┐     ┌───────────────────┐     ┌───────────────────┐
│   forbit.dev  │     │  media.devpad     │     │   devpad.tools    │
│  (external)   │     │     .tools        │     │      (API)        │
│               │     │                   │     │                   │
│  API Key ─────┼────>│  Validate Key ────┼────>│ GET /api/v0/      │
│               │     │                   │     │   auth/verify     │
│               │     │                   │<────┤ { user_id: ... }  │
│               │     │                   │     │                   │
│               │     │  Lookup local user│     │                   │
│               │     │  by devpad_user_id│     │                   │
│               │     │                   │     │                   │
│  Timeline <───┼─────┤  Return filtered  │     │                   │
│               │     │  profile data     │     │                   │
└───────────────┘     └───────────────────┘     └───────────────────┘
```

Key points:
- External sites cannot use session cookies (different domain)
- They use devpad API keys instead
- Media-timeline calls devpad's auth verify endpoint to validate the key
- Once validated, media-timeline uses the returned `user_id` to look up the local user

### Current State Analysis

**Devpad Auth System:**
- Uses Lucia for session management with SQLite adapter
- GitHub OAuth for user authentication
- Sessions stored in `session` table with `access_token` for GitHub API
- Session cookies currently set for `devpad.tools` domain (needs update for subdomain sharing)
- **API keys stored in `api_key` table** (hash-based, no expiry) - used for external API access
- Auth middleware supports: session cookies, JWT tokens (`jwt:` prefix), and API keys
- Has `GET /api/auth/verify` endpoint that validates auth and returns user info

**Media-Timeline Auth System:**
- Uses API key authentication (SHA-256 hashed) - **will be replaced with devpad integration**
- Users table with basic profile info
- Multi-tenant accounts via `account_members` table
- No current devpad integration

### Proposed Integration Summary

| Context | Auth Method | How It Works |
|---------|-------------|--------------|
| Web UI (media.devpad.tools) | Shared session cookie | Cookie set on `.devpad.tools`, validated via devpad API |
| External API (forbit.dev) | Devpad API key | Key validated via devpad API, returns user_id |

Both methods ultimately call devpad's `/api/auth/verify` to get the authenticated user. The difference is just the credential type (cookie vs API key header).

---

## Database Schema

### New Tables (media-timeline)

```sql
-- Profiles table - each user can have multiple profiles
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL,                    -- URL-friendly identifier (e.g., "forbit", "chamber")
  name TEXT NOT NULL,                    -- Display name
  description TEXT,                      -- Optional description
  theme TEXT,                            -- Optional theme/color scheme
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug)                  -- Slug uniqueness is per-user
);

CREATE INDEX idx_profiles_user ON profiles(user_id);

-- Profile visibility rules - which accounts/filters apply to each profile
CREATE TABLE profile_visibility (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_visible INTEGER DEFAULT 1,          -- Whether this account shows in the profile
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, account_id)
);

CREATE INDEX idx_profile_visibility_profile ON profile_visibility(profile_id);

-- Profile filters - fine-grained filtering per profile/account
CREATE TABLE profile_filters (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filter_type TEXT NOT NULL,             -- 'include' or 'exclude'
  filter_key TEXT NOT NULL,              -- e.g., 'repo', 'subreddit', 'keyword'
  filter_value TEXT NOT NULL,            -- e.g., 'f0rbit/chamber', 'programming', '#dev'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_profile_filters_profile ON profile_filters(profile_id);
CREATE INDEX idx_profile_filters_account ON profile_filters(account_id);

-- Devpad user linkage
ALTER TABLE users ADD COLUMN devpad_user_id TEXT;
CREATE UNIQUE INDEX idx_users_devpad ON users(devpad_user_id);
```

### Changes to Existing Tables

The existing `users`, `accounts`, `account_members` tables remain unchanged. Profiles layer on top of the existing multi-tenant model.

---

## API Design

### Profile CRUD

```
GET    /api/v1/profiles                    # List user's profiles
POST   /api/v1/profiles                    # Create profile
GET    /api/v1/profiles/:id                # Get profile (owner only)
PATCH  /api/v1/profiles/:id                # Update profile
DELETE /api/v1/profiles/:id                # Delete profile

# Visibility management
GET    /api/v1/profiles/:id/visibility     # List account visibility for profile
PUT    /api/v1/profiles/:id/visibility     # Bulk update visibility settings

# Filters management
GET    /api/v1/profiles/:id/filters        # List filters for profile
POST   /api/v1/profiles/:id/filters        # Add filter
DELETE /api/v1/profiles/:id/filters/:filter_id  # Remove filter
```

### Profile Timeline API (Authenticated via Devpad API Key)

External consumers (e.g., `forbit.dev`, `chamber.dev`) access profile data using devpad API keys:

```
GET    /api/v1/profiles/:slug/timeline     # Get profile timeline (requires devpad API key)
```

This endpoint is authenticated using the existing devpad API key mechanism. The API key identifies the user, and the profile must belong to that user.

### Request/Response Schemas

```typescript
// POST /api/v1/profiles
type CreateProfileRequest = {
  slug: string;           // URL-friendly, unique per user, 3-50 chars, lowercase alphanumeric + hyphens
  name: string;           // Display name, 1-100 chars
  description?: string;   // Optional, max 500 chars
};

// PATCH /api/v1/profiles/:id
type UpdateProfileRequest = Partial<CreateProfileRequest>;

// PUT /api/v1/profiles/:id/visibility
type UpdateVisibilityRequest = {
  visibility: Array<{
    account_id: string;
    is_visible: boolean;
  }>;
};

// POST /api/v1/profiles/:id/filters
type AddFilterRequest = {
  account_id: string;
  filter_type: 'include' | 'exclude';
  filter_key: 'repo' | 'subreddit' | 'keyword' | 'twitter_account';
  filter_value: string;
};

// GET /api/v1/profiles/:id (response)
type ProfileResponse = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  theme: string | null;
  created_at: string;
  updated_at: string;
  visibility: Array<{
    account_id: string;
    platform: string;
    platform_username: string | null;
    is_visible: boolean;
  }>;
  filters: Array<{
    id: string;
    account_id: string;
    filter_type: 'include' | 'exclude';
    filter_key: string;
    filter_value: string;
  }>;
};

// GET /api/v1/profiles/:slug/timeline (response)
// Same structure as existing timeline API, but filtered by profile visibility/filters
type ProfileTimelineResponse = {
  meta: {
    profile_slug: string;
    profile_name: string;
    generated_at: string;
  };
  data: {
    groups: DateGroup[];  // Same structure as regular timeline
  };
};
```

---

## UI/UX Flow

### Login Flow (Web UI)

1. User visits `media.devpad.tools` (not logged in)
2. Landing page shows with "Login" button
3. Clicking "Login" redirects to `devpad.tools/login?redirect=media.devpad.tools`
4. User completes GitHub OAuth on devpad
5. Devpad sets session cookie on `.devpad.tools` domain
6. Devpad redirects back to `media.devpad.tools`
7. Media-timeline reads session cookie, validates via devpad API, user is logged in

### Profile Management (Connections Page)

1. **Profiles Section** at top of connections page
   - "Create New Profile" button
   - List of existing profiles with quick stats (platforms count, filters count)
   - Each profile card shows: name, slug, API endpoint URL, edit/delete buttons

2. **Profile Editor Modal/Page**
   - Basic info: Name, Slug, Description
   - Account visibility checkboxes (toggle which accounts appear)
   - Filters section (advanced): Add include/exclude rules
   - API endpoint display: Shows the URL to use for fetching this profile's timeline

3. **Profile Preview**
   - "Preview" button opens the profile timeline in read-only mode within the app
   - Shows exactly what the API would return

### External Access Pattern (API Keys)

For external sites (different domain, can't use session cookies):

1. User creates a profile in media-timeline UI (e.g., slug: `forbit`)
2. User gets their devpad API key from devpad.tools/settings or similar
3. External site (e.g., `forbit.dev`) fetches timeline data via API:
   ```
   GET https://media.devpad.tools/api/v1/profiles/forbit/timeline
   Authorization: Bearer <devpad-api-key>
   ```
4. External site renders the timeline data however it wants

This keeps all authentication centralized in devpad while allowing profile data to be consumed anywhere.

---

## Implementation Steps

### Phase 0: Prerequisites in Devpad (Required First)

| Task | Description | LOC | Dependency |
|------|-------------|-----|------------|
| 0.1 | Update Lucia session cookie to use `.devpad.tools` domain (enable subdomain sharing) | ~10 | None |
| 0.2 | Ensure `/api/auth/verify` returns full user info with both session cookie and API key auth | ~20 | None |
| 0.3 | Add CORS for media.devpad.tools origin | ~10 | None |

**Total Phase 0: ~40 LOC**

The key change in devpad is setting the session cookie domain to `.devpad.tools` (with leading dot) so that `media.devpad.tools` can read it. The existing `/api/auth/verify` endpoint already supports session cookies and API keys.

### Phase 1: Devpad Integration (media-timeline)

| Task | Description | LOC | Dependency | Parallelizable |
|------|-------------|-----|------------|----------------|
| 1.1 | Add `devpad_user_id` column migration | ~30 | None | Yes |
| 1.2 | Create devpad auth service (calls devpad /api/auth/verify with cookie or API key) | ~100 | Phase 0 | Yes |
| 1.3 | Add response caching for devpad auth verification (5 min TTL) | ~50 | 1.2 | No |
| 1.4 | Create user sync service (create/update local user on first auth) | ~80 | 1.1, 1.2 | No |
| 1.5 | Create devpad auth middleware for web routes (reads session cookie) | ~60 | 1.2, 1.4 | No |
| 1.6 | Create devpad auth middleware for API routes (reads API key header) | ~40 | 1.2, 1.4 | No |
| 1.7 | Update CORS to allow devpad.tools | ~10 | None | Yes |
| 1.8 | Integration tests for devpad auth (both cookie and API key) | ~120 | 1.5, 1.6 | No |

**Total Phase 1: ~490 LOC**

### Phase 2: Profiles Database & API

| Task | Description | LOC | Dependency | Parallelizable |
|------|-------------|-----|------------|----------------|
| 2.1 | Create profiles schema migration | ~60 | None | Yes |
| 2.2 | Add Drizzle schema definitions | ~80 | 2.1 | No |
| 2.3 | Create profile Zod schemas (validation) | ~60 | None | Yes |
| 2.4 | Implement profile CRUD routes | ~200 | 2.2, 2.3 | No |
| 2.5 | Implement visibility management routes | ~100 | 2.4 | No |
| 2.6 | Implement filter management routes | ~120 | 2.4 | No |
| 2.7 | Integration tests for profile APIs | ~250 | 2.4, 2.5, 2.6 | No |

**Total Phase 2: ~870 LOC**

### Phase 3: Profile Timeline Generation

| Task | Description | LOC | Dependency | Parallelizable |
|------|-------------|-----|------------|----------------|
| 3.1 | Create profile timeline service | ~150 | 2.4 | No |
| 3.2 | Implement visibility filtering in timeline | ~100 | 3.1 | No |
| 3.3 | Implement filter application in timeline | ~150 | 3.1 | No |
| 3.4 | Add profile timeline caching strategy | ~80 | 3.1 | Yes |
| 3.5 | Profile timeline API route (authenticated) | ~80 | 3.1, 1.4 | No |
| 3.6 | Timeline generation tests | ~200 | 3.1, 3.2, 3.3 | No |

**Total Phase 3: ~760 LOC**

### Phase 4: Website UI

| Task | Description | LOC | Dependency | Parallelizable |
|------|-------------|-----|------------|----------------|
| 4.1 | Profile list component (Solid.js) | ~150 | 2.4 | Yes |
| 4.2 | Profile editor modal | ~200 | 2.4, 2.5, 2.6 | Yes |
| 4.3 | Account visibility toggle UI | ~100 | 4.2 | No |
| 4.4 | Filter management UI | ~150 | 4.2 | No |
| 4.5 | Profile preview component (in-app only) | ~80 | 3.5 | Yes |
| 4.6 | API endpoint display & copy button | ~40 | 4.1 | Yes |
| 4.7 | Login button → redirect to devpad.tools/login | ~30 | Phase 0 | Yes |
| 4.8 | Auth state check on page load (read session via devpad API) | ~50 | 1.5 | Yes |

**Total Phase 4: ~800 LOC**

---

## Testing Strategy

### Unit Tests (Pure Functions)

| Function | Happy Path | Edge Case |
|----------|------------|-----------|
| `validateSlug()` | Valid slug returns true | Invalid chars, too long, reserved words |
| `applyVisibilityFilter()` | Filters hidden accounts | Empty visibility list |
| `applyContentFilters()` | Include/exclude works | Overlapping filters |
| `generateProfileTimeline()` | Combines all filters | Empty profile |

### Integration Tests

1. **Profile CRUD Workflow**
   - Create profile → update → delete
   - Slug uniqueness validation (per-user)
   - Visibility updates cascade correctly

2. **Profile Timeline Generation**
   - Profile with all accounts visible
   - Profile with some accounts hidden
   - Profile with content filters applied
   - API access with valid devpad API key
   - API access denied without valid key
   - API access denied for other user's profile

3. **Devpad Auth Integration (Session Cookie)**
   - Valid session cookie authenticates user
   - Expired session cookie rejected
   - User sync on first login (creates local user record)
   - Subsequent logins use existing local user

4. **Devpad Auth Integration (API Key - External)**
   - Valid devpad API key authenticates user
   - Invalid API key rejected
   - User lookup via devpad_user_id
   - Profile ownership validation

### Test File Structure

```
__tests__/
├── integration/
│   ├── profiles-crud.test.ts         # Profile CRUD workflows
│   ├── profiles-timeline.test.ts     # Timeline generation with profiles
│   └── devpad-auth.test.ts           # Devpad JWT integration
└── unit/
    └── profile-filters.test.ts        # Pure filter functions
```

---

## Dependency Graph

```
                    ┌───────────────────┐
                    │   Phase 0         │
                    │   Devpad Changes  │
                    │   (minimal)       │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   Phase 1         │
                    │   Devpad Auth     │
                    │   (API key valid) │
                    └─────────┬─────────┘
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
          ▼                                       ▼
┌───────────────────┐               ┌───────────────────┐
│   Phase 2         │               │   Phase 4.7       │
│   Profiles API    │               │   Login UI        │
└─────────┬─────────┘               └───────────────────┘
          │
          ▼
┌───────────────────┐
│   Phase 3         │
│   Profile Timeline│
│   (API only)      │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   Phase 4.1-4.6   │
│   Profile UI      │
│   (management)    │
└───────────────────┘
```

### Parallelization Opportunities

**Can run in parallel:**
- Phase 2.1, 2.3 (migrations and schemas)
- Phase 3.4 (caching)
- Phase 4.1, 4.2, 4.5, 4.6, 4.7 (UI components)

**Must be sequential:**
- Phase 0 → Phase 1 (devpad must be ready first)
- Phase 1.1, 1.2 → 1.4 → 1.5 (user sync depends on migration and auth service)
- Phase 2.2 → 2.4 → 2.5/2.6 (routes depend on schema)
- Phase 3.1 → 3.2, 3.3 (filtering depends on timeline service)
- Phase 1.5 → 3.5 (profile timeline API depends on devpad auth middleware)

---

## Summary

| Phase | LOC Estimate | Duration (1 dev) | Critical Path |
|-------|--------------|------------------|---------------|
| 0: Devpad Prerequisites | ~40 | 0.25 days | ✓ |
| 1: Devpad Integration | ~490 | 2-3 days | ✓ |
| 2: Profiles API | ~870 | 3-4 days | ✓ |
| 3: Profile Timeline | ~760 | 3 days | ✓ |
| 4: Website UI | ~800 | 3 days | |
| **Total** | **~2,960 LOC** | **11-14 days** | |

### Critical Decisions Needed (Before Implementation)

1. **Session Cookie Domain**: Devpad needs to set Lucia session cookies with `Domain: .devpad.tools`
   - This is a one-line change in Lucia config
   - Enables media.devpad.tools to read the session cookie
   - **Decision needed**: Confirm this won't break existing devpad.tools functionality

2. **Profile Limits**: How many profiles per user?
   - Recommended: 10 profiles per user initially

3. **Filter Complexity**: Include/exclude only, or regex support?
   - Recommended: Start with simple include/exclude, add regex later

4. **Login Redirect Flow**: Where should devpad redirect after login when coming from media-timeline?
   - Option A: Always redirect to `media.devpad.tools` (requires tracking origin)
   - Option B: Redirect to devpad dashboard, user navigates to media-timeline manually
   - **Recommended**: Option A - pass `redirect_uri` param to devpad login

---

## Limitations

1. **Real-time Updates**: Profile timelines are generated during cron jobs. Adding a new account won't immediately appear in profiles.

2. **Filter Complexity**: Initial implementation supports simple include/exclude. Complex boolean logic (AND/OR combinations) is out of scope.

3. **Profile Analytics**: No view tracking or analytics for API calls in initial implementation.

4. **Profile Transfer**: No mechanism to transfer a profile to another user.

5. **No Public Pages**: All profile access requires authentication (session cookie for web UI, API key for external sites). There are no publicly viewable profile pages on media.devpad.tools.

6. **Devpad Dependency**: Both web UI auth and external API auth require devpad to be available. If devpad is down:
   - Web UI users cannot log in (but existing sessions may still work if cached)
   - External API calls will fail (mitigated by brief caching of auth responses)
