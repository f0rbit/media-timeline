# Stepper & Timeline Component Migration Analysis

**Date:** 2026-01-09  
**Status:** ✅ Complete (HowItWorksSection migrated)
**Last Updated:** January 2026
**Breaking Changes:** None

---

## Implementation Summary

### Completed
- ✅ **HowItWorksSection** migrated to use `@f0rbit/ui` Stepper component
  - Created `HowItWorks.tsx` SolidJS component using `<Stepper>` and `<Step>`
  - Custom CSS reduced to ~24 lines (layout/spacing only)
  - HowItWorksSection.astro now imports the SolidJS component

### Not Migrated (as planned)
- **TimelineList** - Too specialized, kept custom implementation
- **TimelinePreview** - Needs to match TimelineList visually
- **RecentActivity** - Lower priority, existing implementation is clean

---

## Executive Summary

This analysis evaluates opportunities to migrate existing UI patterns to `@f0rbit/ui`'s `Stepper` and `Timeline` components. After reviewing the codebase:

| Component | Target | Recommendation | Effort |
|-----------|--------|----------------|--------|
| HowItWorksSection | `<Stepper>` | **Good fit** | Low (~30 LOC) |
| TimelineList | `<Timeline>` | **Not a good fit** | N/A |
| TimelinePreview | `<Timeline>` | **Not a good fit** | N/A |
| RecentActivity | `<Timeline>` | **Maybe** - needs evaluation | Medium (~50 LOC) |

---

## 1. HowItWorksSection Analysis

**File:** `apps/website/src/components/landing/HowItWorksSection.astro`

### Current Implementation
- 3 static steps: Connect, Sync, Browse
- Custom icons (SVG) for each step
- Horizontal layout on desktop, vertical on mobile
- Custom CSS (~110 lines) handling responsive layout and styling
- No interactive state (all steps are presentational)

### Stepper Component Fit: **GOOD FIT**

The `<Stepper>` component is designed for exactly this use case - displaying a sequence of steps with:
- Title + description per step
- Custom icons
- Horizontal/vertical orientation support

### Migration Approach

```tsx
// New implementation using Stepper
import { Stepper, Step } from "@f0rbit/ui";
import Link from "lucide-solid/icons/link";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import List from "lucide-solid/icons/list";

<section class="how-it-works-section">
  <h2>How it works</h2>
  <Stepper orientation="horizontal">
    <Step 
      title="Connect" 
      description="Link your accounts with secure OAuth or API tokens."
      icon={<Link size={16} />}
      status="completed"
    />
    <Step 
      title="Sync" 
      description="Background sync runs every 5 minutes. Always up to date."
      icon={<RefreshCw size={16} />}
      status="completed"
    />
    <Step 
      title="Browse" 
      description="Your unified timeline, organized and searchable."
      icon={<List size={16} />}
      status="completed"
    />
  </Stepper>
</section>
```

### Benefits
- Removes ~110 lines of custom CSS
- Consistent styling with UI library
- Built-in responsive behavior (if supported)
- Maintains accessibility patterns

### Considerations
- Need to verify `@f0rbit/ui` Stepper supports horizontal-to-vertical responsive breakpoints
- All steps shown as "completed" (since this is informational, not a wizard)
- May need custom icon sizes to match current design

### Estimated Effort: **Low** (~30 LOC change, ~110 LOC CSS deleted)

---

## 2. TimelineList Analysis

**File:** `apps/website/src/components/solid/TimelineList.tsx`

### Current Implementation
A highly specialized component (524 lines) that renders:
- Multiple item types: `commit`, `commit_group`, `pull_request`, `post`, `comment`
- Platform-specific rendering: GitHub, Reddit, Twitter, Bluesky
- Complex nested structures (commits within PRs, commits within groups)
- Expandable/collapsible sections for large commit lists
- Platform-specific icons and color schemes
- Inline metadata (scores, comment counts, branch names, PR states)
- Interactive elements (expand/collapse buttons, external links)

### Timeline Component API
```tsx
<Timeline items={[
  { id: 1, title: "Order placed", timestamp: "10:30 AM" },
  { id: 2, title: "Processing", timestamp: "10:45 AM" },
]} />
```

### Timeline Component Fit: **NOT A GOOD FIT**

The `@f0rbit/ui` Timeline component is designed for simple chronological event lists with:
- Simple `{ id, title, timestamp }` structure
- Uniform item rendering

The existing TimelineList has:
- **7 different item types** with unique rendering logic
- **Complex nested data** (commits inside PRs, grouped commits)
- **Interactive expand/collapse** behavior
- **Platform-specific icons and colors**
- **Rich metadata display** (scores, states, branch names)

**Verdict:** The specialization level is too high. The `@f0rbit/ui` Timeline would require extensive customization that defeats its purpose, or we'd lose significant functionality.

### Recommendation
Keep the existing implementation. The custom CSS (`.timeline-*` classes) totals ~100 lines and is well-structured. The cost of trying to force this into a generic Timeline component far outweighs any benefit.

---

## 3. TimelinePreview Analysis

**File:** `apps/website/src/components/landing/TimelinePreview.tsx`

### Current Implementation
A mock/demo version of the timeline for the landing page (169 lines):
- 4 hardcoded mock items
- Same rendering patterns as TimelineList (commit groups, reddit posts, tweets)
- Reuses `.timeline-*` CSS classes

### Timeline Component Fit: **NOT A GOOD FIT**

Same reasons as TimelineList - the preview deliberately mirrors the main timeline's visual complexity to showcase the product's features.

### Recommendation
Keep as-is. This component should remain visually consistent with the real TimelineList.

---

## 4. RecentActivity Analysis

**File:** `apps/website/src/components/solid/Dashboard/RecentActivity.tsx`

### Current Implementation
A simpler timeline variant (50 lines):
- Shows platform icon + title + timestamp
- No nested data
- No interactive elements
- Uses `.recent-activity-*` CSS classes

### Timeline Component Fit: **MAYBE**

This is closer to the simple Timeline API, but:
- Has platform-specific icons via `<PlatformIcon>`
- Currently uses custom CSS classes

### Migration Possibility
If `@f0rbit/ui` Timeline supports:
1. Custom icons per item
2. Flexible content rendering (not just title/timestamp)

Then this could be migrated. Otherwise, the current 50-line implementation is already simple enough.

### Recommendation
**Lower priority.** Evaluate if the Timeline component can accept custom render props. If yes, migration is straightforward. If no, the existing implementation is clean enough to keep.

---

## 5. Other Opportunities Scan

Searched for `step|progress|wizard` patterns in the codebase:
- No multi-step wizards or forms found
- No progress indicators (beyond sync status badges)
- No onboarding flows that could use Stepper

**Conclusion:** HowItWorksSection is the primary Stepper opportunity.

---

## Implementation Plan

### Phase 1: HowItWorksSection Migration (Recommended)

**Tasks:**
1. Update `HowItWorksSection.astro` to use `<Stepper>` + `<Step>` components
2. Replace inline SVG icons with lucide-solid icons
3. Remove custom CSS (`.step-*`, responsive handling)
4. Test responsive behavior (verify horizontal/vertical breakpoint works)
5. Visual QA to ensure design parity

**Estimated Lines of Code:**
- Added: ~30 LOC (new component implementation)
- Deleted: ~150 LOC (old template + CSS)
- Net: -120 LOC

**Files Modified:**
- `apps/website/src/components/landing/HowItWorksSection.astro`

### Phase 2: RecentActivity Evaluation (Optional)

**Tasks:**
1. Review `@f0rbit/ui` Timeline component source for customization options
2. If supports custom rendering: migrate RecentActivity
3. If not: document limitation and skip

---

## Recommendations Summary

### Do Now
- **Migrate HowItWorksSection to Stepper** - Clean win, reduces custom CSS, improves consistency

### Don't Do
- **TimelineList migration** - Too specialized, would lose functionality
- **TimelinePreview migration** - Needs to match TimelineList visually

### Evaluate Later
- **RecentActivity** - Depends on Timeline component's flexibility

---

## Appendix: Component Comparison

| Feature | HowItWorks | TimelineList | TimelinePreview | RecentActivity |
|---------|------------|--------------|-----------------|----------------|
| Item types | 1 (step) | 7+ | 4 | 2 |
| Nested content | No | Yes | Yes | No |
| Interactive | No | Yes | No | No |
| Custom icons | Yes | Yes | Yes | Yes |
| Complex metadata | No | Yes | Yes | No |
| Lines of code | 180 | 524 | 169 | 50 |
| **Stepper fit** | **Yes** | No | No | No |
| **Timeline fit** | No | No | No | Maybe |
