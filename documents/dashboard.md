# Dashboard Implementation Plan

## Overview

The Dashboard will serve as the homepage analytics view for Media Timeline, providing users with meaningful insights about their aggregated activity across connected platforms. The dashboard will display summary statistics, activity trends, platform distribution, and content type breakdowns derived from timeline data.

### Design Philosophy
- **Minimal dependencies**: No external charting libraries required; use CSS-based visualizations (bars, progress indicators)
- **Consistent styling**: Leverage existing CSS variables, utility classes, and component patterns
- **Data-driven**: Derive all metrics from existing timeline data structures
- **Responsive**: Works well on both desktop and mobile viewports

---

## Data Analysis

### Available Data Sources

From the timeline response (`TimelineResponse`), we have access to:

```typescript
type TimelineResponse = {
  data: {
    groups: DateGroup[];  // Grouped by date
  };
  meta: {
    version: string;
    generated_at: string;
    github_usernames?: string[];
  };
};

type DateGroup = {
  date: string;  // ISO date string (YYYY-MM-DD)
  items: (TimelineItem | CommitGroup)[];
};

type TimelineItem = {
  id: string;
  platform: Platform;  // "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter"
  type: TimelineType;  // "commit" | "post" | "video" | "task" | "pull_request" | "comment"
  timestamp: string;
  title: string;
  url: string;
  payload: Payload;  // Type-specific data
};

type CommitGroup = {
  type: "commit_group";
  repo: string;
  branch: string;
  date: string;
  commits: TimelineItem[];
  total_additions: number;
  total_deletions: number;
  total_files_changed: number;
};
```

### Derivable Metrics

**Summary Statistics:**
| Metric | Derivation | Display |
|--------|------------|---------|
| Total entries | Count all items across all date groups | Large number |
| Active days | Count unique dates in groups | Number with context |
| Platforms active | Count unique `platform` values | Number with icons |
| Latest activity | Most recent timestamp | Relative time |

**Platform Distribution:**
| Metric | Derivation |
|--------|------------|
| Entries per platform | Group items by `platform`, count each |
| Platform percentages | (platform count / total) * 100 |

**Content Type Distribution:**
| Metric | Derivation |
|--------|------------|
| Entries by type | Group items by `type`, count each |
| Type percentages | (type count / total) * 100 |

**Activity Over Time:**
| Metric | Derivation |
|--------|------------|
| Daily activity | Count items per date group |
| Weekly activity | Aggregate daily counts by week |
| Activity trend | Compare current week to previous week |

**GitHub-Specific Metrics (when connected):**
| Metric | Derivation |
|--------|------------|
| Total commits | Sum commits from commit groups + individual commits |
| PRs opened/merged | Filter by type=pull_request, group by state |
| Lines changed | Sum total_additions + total_deletions from commit groups |
| Active repos | Unique repo names from commits and PRs |

**Reddit-Specific Metrics (when connected):**
| Metric | Derivation |
|--------|------------|
| Posts created | Count type=post, platform=reddit |
| Comments made | Count type=comment |
| Total karma (score) | Sum score from comment payloads |
| Active subreddits | Unique subreddit values |

**Twitter-Specific Metrics (when connected):**
| Metric | Derivation |
|--------|------------|
| Tweets count | Count type=post, platform=twitter |
| Engagement | Sum like_count, repost_count, reply_count |

---

## Dashboard Sections

### 1. Summary Stats Row

**Purpose:** High-level overview at a glance

**Layout:** Horizontal row of 4-5 stat cards

**Components:**
- `StatCard`: Reusable card showing metric + label
- `DashboardStats`: Container for stat cards row

**Data displayed:**
1. Total entries (with trend indicator)
2. Active days (e.g., "12 days in last month")
3. Connected platforms (with mini icons)
4. Last activity (relative time)

**Visual design:**
```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│     247     │ │     12      │ │      3      │ │    2h ago   │
│   entries   │ │ active days │ │  platforms  │ │ last active │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

**Styling:**
- Use existing `.card` class as base
- Large number: `h2` or custom large text class
- Label: `.muted .text-sm`

---

### 2. Platform Distribution

**Purpose:** Show activity breakdown by platform

**Layout:** Horizontal bar chart with labels

**Components:**
- `PlatformDistribution`: Main container
- `DistributionBar`: Individual platform bar

**Data displayed:**
- Each connected platform with:
  - Platform icon (reuse `PlatformIcon`)
  - Platform name
  - Count
  - Percentage bar

**Visual design:**
```
Platform Activity
─────────────────────────────────────────────
GitHub    ████████████████████████████  142 (57%)
Reddit    ████████████                   62 (25%)
Twitter   ████████                       43 (18%)
```

**Styling:**
- Use CSS variables for platform colors (already defined: `--platform-github`, etc.)
- Progress bar: simple div with width percentage
- Background: `var(--input-background)`

---

### 3. Activity Chart

**Purpose:** Visualize activity over time

**Layout:** Simple bar chart showing last 14 days

**Components:**
- `ActivityChart`: Main chart container
- `ActivityBar`: Individual day bar

**Data displayed:**
- Last 14 days of activity
- Bar height = relative activity count
- Date labels for key days (start, middle, end)

**Visual design:**
```
Activity (Last 14 Days)
─────────────────────────────────────────────
      ▄
    ▄ █     ▄           ▄
  ▄ █ █ ▄   █   ▄       █ ▄
  █ █ █ █   █   █   ▄   █ █
──█─█─█─█───█───█───█───█─█──
 Dec 15           Dec 22         Dec 29
```

**Styling:**
- CSS Grid for bar layout
- `var(--text-link)` for bar fill
- Hover state to show exact count

---

### 4. Content Type Breakdown

**Purpose:** Show what kinds of content the user creates

**Layout:** Horizontal list with type badges and counts

**Components:**
- `ContentTypeList`: Container
- `ContentTypeRow`: Individual type with count

**Data displayed:**
- Content types with icons:
  - Commits (GitCommit icon)
  - Pull Requests (GitPullRequest icon)
  - Posts (MessageSquare icon)
  - Comments (Reply icon)
  - Videos (Play icon)
  - Tasks (CheckSquare icon)

**Visual design:**
```
Content Types
─────────────────────────────────────────────
  ● Commits          98
  ● Pull Requests    12
  ● Posts            52
  ● Comments         85
```

**Styling:**
- Reuse timeline icons where applicable
- `.text-sm` for counts
- Optional: small inline bar showing percentage

---

### 5. Recent Activity Summary

**Purpose:** Quick view of recent items

**Layout:** Compact list of last 5-7 activities

**Components:**
- `RecentActivity`: Container with header and list
- Reuse existing timeline row components (simplified)

**Data displayed:**
- Platform icon
- Title (truncated)
- Relative time
- Type badge

**Visual design:**
```
Recent Activity
─────────────────────────────────────────────
  ● GitHub   feat: add dashboard component     2h ago
  ● Reddit   Comment on "TIL about..."        4h ago
  ● GitHub   Merged PR #42                    6h ago
  ● Twitter  New tweet                        1d ago
```

**Styling:**
- Simplified version of timeline rows
- No nested content, just single-line items
- Link to full timeline at bottom

---

### 6. Platform Quick Stats (Conditional)

**Purpose:** Platform-specific insights when data is available

**Layout:** Collapsible sections per platform

**Components:**
- `PlatformQuickStats`: Container
- `GitHubStats`: GitHub-specific metrics
- `RedditStats`: Reddit-specific metrics
- `TwitterStats`: Twitter-specific metrics

**Data displayed (GitHub):**
- Total commits this period
- Lines changed (+additions / -deletions)
- Top repo by activity
- PR states (open/merged/closed)

**Data displayed (Reddit):**
- Total karma from visible items
- Active subreddits count
- Top subreddit by activity

**Visual design:**
```
GitHub Insights
─────────────────────────────────────────────
Commits: 98          Lines: +1,247 / -342
Top Repo: media-timeline (45 commits)
PRs: 3 open, 8 merged, 1 closed
```

---

## Component Architecture

### New Components

```
apps/website/src/components/solid/Dashboard/
├── Dashboard.tsx              # Main dashboard container
├── StatCard.tsx               # Individual stat display card
├── DashboardStats.tsx         # Row of stat cards
├── PlatformDistribution.tsx   # Platform breakdown chart
├── ActivityChart.tsx          # Time-based activity visualization
├── ContentTypeList.tsx        # Content type breakdown
├── RecentActivity.tsx         # Recent items list
└── PlatformQuickStats.tsx     # Platform-specific insights
```

### Component Dependencies

```
Dashboard.tsx
├── DashboardStats.tsx
│   └── StatCard.tsx
├── PlatformDistribution.tsx
│   └── PlatformIcon.tsx (existing)
├── ActivityChart.tsx
├── ContentTypeList.tsx
├── RecentActivity.tsx
└── PlatformQuickStats.tsx
    ├── GitHubStats.tsx (inline or separate)
    ├── RedditStats.tsx (inline or separate)
    └── TwitterStats.tsx (inline or separate)
```

### Shared Utilities

New file: `apps/website/src/utils/analytics.ts`

```typescript
// Calculate dashboard metrics from timeline data
export function calculateDashboardStats(groups: DateGroup[]): DashboardStats;
export function calculatePlatformDistribution(groups: DateGroup[]): PlatformDistribution[];
export function calculateActivityByDay(groups: DateGroup[], days: number): DailyActivity[];
export function calculateContentTypes(groups: DateGroup[]): ContentTypeCount[];
export function calculateGitHubStats(groups: DateGroup[]): GitHubStats | null;
export function calculateRedditStats(groups: DateGroup[]): RedditStats | null;
export function calculateTwitterStats(groups: DateGroup[]): TwitterStats | null;
```

---

## API Requirements

### No New Endpoints Required

All dashboard metrics can be derived from the existing `/api/v1/timeline/:user_id` endpoint. The timeline response contains all necessary data to compute:

- Entry counts
- Platform distribution
- Activity over time
- Content type breakdown
- Platform-specific metrics

### Optional Future Enhancement

If performance becomes a concern (large timelines), consider a dedicated analytics endpoint:

```
GET /api/v1/timeline/:user_id/stats
```

Response:
```typescript
{
  summary: {
    total_entries: number;
    active_days: number;
    platforms: string[];
    last_activity: string;
  };
  platform_distribution: Record<string, number>;
  activity_by_day: Record<string, number>;  // last 30 days
  content_types: Record<string, number>;
}
```

This is **NOT required for initial implementation** - defer until needed.

---

## CSS Additions

Add to `apps/website/src/main.css`:

```css
/* ==========================================================================
   DASHBOARD
   ========================================================================== */

.dashboard {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.dashboard-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dashboard-section-title {
  font-size: 0.875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  border: 1px solid var(--input-border);
  border-radius: 4px;
  background: var(--input-background);
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Distribution Bars */
.distribution-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.distribution-row {
  display: grid;
  grid-template-columns: 100px 1fr 60px;
  gap: 0.75rem;
  align-items: center;
}

.distribution-bar-track {
  height: 8px;
  background: var(--input-border);
  border-radius: 4px;
  overflow: hidden;
}

.distribution-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

/* Activity Chart */
.activity-chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 80px;
  padding-top: 0.5rem;
}

.activity-bar {
  flex: 1;
  min-width: 4px;
  background: var(--text-link);
  border-radius: 2px 2px 0 0;
  transition: height 0.2s ease;
}

.activity-bar:hover {
  filter: brightness(120%);
}

.activity-labels {
  display: flex;
  justify-content: space-between;
  padding-top: 0.25rem;
}

/* Content Type List */
.content-type-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0;
}

.content-type-icon {
  width: 1rem;
  color: var(--text-muted);
}

.content-type-name {
  flex: 1;
}

.content-type-count {
  font-variant-numeric: tabular-nums;
}

/* Responsive */
@media (max-width: 600px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .distribution-row {
    grid-template-columns: 80px 1fr 50px;
  }
}
```

---

## File Structure

```
apps/website/
├── src/
│   ├── components/
│   │   └── solid/
│   │       └── Dashboard/
│   │           ├── Dashboard.tsx
│   │           ├── StatCard.tsx
│   │           ├── DashboardStats.tsx
│   │           ├── PlatformDistribution.tsx
│   │           ├── ActivityChart.tsx
│   │           ├── ContentTypeList.tsx
│   │           └── RecentActivity.tsx
│   ├── pages/
│   │   ├── index.astro          # Keep timeline as main
│   │   └── dashboard/
│   │       └── index.astro      # New dashboard page
│   └── utils/
│       ├── api-client.ts        # Existing
│       ├── formatters.ts        # Existing
│       └── analytics.ts         # New - dashboard calculations
```

---

## Implementation Tasks

### Phase 1: Foundation (Parallel)

| Task | Description | Est. LOC | Dependencies |
|------|-------------|----------|--------------|
| 1.1 | Create `analytics.ts` utility with calculation functions | ~150 | None |
| 1.2 | Add dashboard CSS to `main.css` | ~80 | None |
| 1.3 | Create `StatCard.tsx` component | ~25 | None |

### Phase 2: Core Components (Sequential after Phase 1)

| Task | Description | Est. LOC | Dependencies |
|------|-------------|----------|--------------|
| 2.1 | Create `DashboardStats.tsx` (stats row) | ~50 | 1.1, 1.3 |
| 2.2 | Create `PlatformDistribution.tsx` | ~70 | 1.1, 1.2 |
| 2.3 | Create `ActivityChart.tsx` | ~80 | 1.1, 1.2 |
| 2.4 | Create `ContentTypeList.tsx` | ~60 | 1.1 |

### Phase 3: Secondary Components (Parallel after Phase 2)

| Task | Description | Est. LOC | Dependencies |
|------|-------------|----------|--------------|
| 3.1 | Create `RecentActivity.tsx` | ~80 | 1.1 |
| 3.2 | Create `PlatformQuickStats.tsx` | ~120 | 1.1 |

### Phase 4: Integration (Sequential after Phase 3)

| Task | Description | Est. LOC | Dependencies |
|------|-------------|----------|--------------|
| 4.1 | Create main `Dashboard.tsx` container | ~80 | 2.1-2.4, 3.1-3.2 |
| 4.2 | Create `/dashboard/index.astro` page | ~20 | 4.1 |
| 4.3 | Update `AppLayout.astro` nav to include dashboard | ~5 | 4.2 |

### Phase 5: Testing (Parallel after Phase 4)

| Task | Description | Est. LOC | Dependencies |
|------|-------------|----------|--------------|
| 5.1 | Unit tests for `analytics.ts` functions | ~150 | 1.1 |
| 5.2 | Integration test for dashboard page load | ~50 | 4.1-4.3 |

---

## Task Dependency Graph

```
Phase 1 (Parallel):
  1.1 analytics.ts ─────────┐
  1.2 dashboard CSS ────────┼──> Phase 2
  1.3 StatCard.tsx ─────────┘

Phase 2 (Sequential within, parallel sets):
  [1.1, 1.3] ──> 2.1 DashboardStats ──┐
  [1.1, 1.2] ──> 2.2 PlatformDist ────┼──> Phase 3
  [1.1, 1.2] ──> 2.3 ActivityChart ───┤
  [1.1]      ──> 2.4 ContentTypeList ─┘

Phase 3 (Parallel):
  [1.1] ──> 3.1 RecentActivity ──┐
  [1.1] ──> 3.2 PlatformStats ───┴──> Phase 4

Phase 4 (Sequential):
  [2.1-2.4, 3.1-3.2] ──> 4.1 Dashboard.tsx
  [4.1] ──> 4.2 dashboard page
  [4.2] ──> 4.3 nav update

Phase 5 (Parallel, after 4.3):
  5.1 unit tests ──> Done
  5.2 integration tests ──> Done
```

---

## Estimated Totals

| Category | Lines of Code |
|----------|---------------|
| Utilities (analytics.ts) | ~150 |
| CSS additions | ~80 |
| Solid.js components | ~565 |
| Astro pages | ~25 |
| Tests | ~200 |
| **Total** | **~1,020** |

---

## Limitations & Future Considerations

### Current Scope Limitations

1. **No historical data persistence**: Dashboard shows current timeline only, not historical trends
2. **Client-side calculation**: All metrics computed in browser; acceptable for typical timeline sizes (<1000 items)
3. **No caching**: Dashboard recalculates on each page load
4. **Single user view**: No team/comparison features

### Future Enhancements (Out of Scope)

1. **Server-side analytics endpoint**: Pre-compute metrics for large timelines
2. **Date range selection**: Filter dashboard to specific periods
3. **Export functionality**: Download activity data as CSV/JSON
4. **Goals/targets**: Set activity goals and track progress
5. **Comparison views**: Compare current period to previous
6. **Real-time updates**: WebSocket updates when new data arrives

---

## Critical Path Items

**Requires approval before proceeding:**

1. **Dashboard placement in navigation**: Currently proposed as separate `/dashboard` page. Alternative: Replace homepage timeline with dashboard, move timeline to `/timeline`
   
2. **Platform-specific sections**: Should we show all platform stats for all users, or only show sections for connected platforms?

3. **Empty state handling**: What to show when user has no timeline data yet?

---

## Testing Strategy

### Unit Tests (`__tests__/unit/analytics.test.ts`)

Test pure calculation functions:
- `calculateDashboardStats()` with various input shapes
- `calculatePlatformDistribution()` with single/multiple platforms
- `calculateActivityByDay()` with date edge cases
- `calculateContentTypes()` with all type variations
- Platform-specific stat calculations

### Integration Tests (`__tests__/integration/dashboard.test.ts`)

Test dashboard page behavior:
- Page loads and displays stats when data exists
- Empty state shows when no data
- Platform sections appear/hide based on connected platforms
- Navigation to dashboard works from all pages
