# UI Library Migration Implementation Plan

**Created:** January 2026  
**Source Analysis:** ~/dev/ui/.plans/media-timeline-migration-analysis.md  
**Status:** ~90% Complete (Phase 7 done)
**Last Updated:** January 2026

---

## Implementation Progress

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation Setup | ✅ Complete |
| Phase 2 | Drop-in Components (ChevronIcon, StatusBadge, StatCard) | ✅ Complete |
| Phase 3 | Modal Components (ProfileEditor, FilterEditor) | ✅ Complete |
| Phase 4 | Icon Buttons | ✅ Complete |
| Phase 5 | Dropdown/ProfileSelector | ✅ Complete |
| Phase 6 | Settings with Collapsible | ✅ Complete |
| Phase 7 | CSS Cleanup | ✅ Complete |

### Files Deleted (as planned)
- ✅ `apps/website/src/components/solid/ChevronIcon.tsx`
- ✅ `apps/website/src/components/solid/StatusBadge.tsx`
- ✅ `apps/website/src/components/solid/Dashboard/StatCard.tsx`

### Files Created
- ✅ `apps/website/src/styles/ui-overrides.css`

### CSS Cleanup Summary (Phase 7)
- Removed `.filter-toggles` (6 lines)
- Removed `.settings-header` hover states (20 lines)
- Most other CSS sections (modal, button, status badge, spinner, etc.) were already removed in earlier phases
- Kept `.profile-selector-*` and `.settings-section/content/title` - still actively used by components

### Remaining Considerations
- Some CSS remains for components using @f0rbit/ui but with custom styling (ProfileSelector, Settings)
- `main.css` reduced from ~2436 to ~2011 lines

---

## 1. Validation Summary

### Confirmed Files & Patterns

| Component | File Path | Lines | Status |
|-----------|-----------|-------|--------|
| `ChevronIcon.tsx` | `apps/website/src/components/solid/ChevronIcon.tsx` | 21 | EXISTS - matches analysis |
| `StatusBadge.tsx` | `apps/website/src/components/solid/StatusBadge.tsx` | 24 | EXISTS - matches analysis |
| `StatCard.tsx` | `apps/website/src/components/solid/Dashboard/StatCard.tsx` | 14 | EXISTS - matches analysis |
| `ProfileEditor.tsx` | `apps/website/src/components/solid/ProfileEditor.tsx` | 152 | EXISTS - matches analysis |
| `FilterEditor.tsx` | `apps/website/src/components/solid/FilterEditor.tsx` | 298 | EXISTS - matches analysis |
| `ProfileSelector.tsx` | `apps/website/src/components/solid/ProfileSelector.tsx` | 256 | EXISTS - matches analysis |
| `ConnectionActions.tsx` | `apps/website/src/components/solid/ConnectionActions.tsx` | 127 | EXISTS - matches analysis |
| `GitHubSettings.tsx` | `apps/website/src/components/solid/PlatformSettings/GitHubSettings.tsx` | 101 | EXISTS - uses ChevronIcon |
| `RedditSettings.tsx` | `apps/website/src/components/solid/PlatformSettings/RedditSettings.tsx` | 126 | EXISTS - uses ChevronIcon |
| `TwitterSettings.tsx` | `apps/website/src/components/solid/PlatformSettings/TwitterSettings.tsx` | 59 | EXISTS - uses ChevronIcon |
| `BlueskySettings.tsx` | `apps/website/src/components/solid/PlatformSettings/BlueskySettings.tsx` | 46 | EXISTS - NO chevron (different pattern) |
| `DevpadSettings.tsx` | `apps/website/src/components/solid/PlatformSettings/DevpadSettings.tsx` | 38 | EXISTS - NO chevron (different pattern) |
| `YouTubeSettings.tsx` | `apps/website/src/components/solid/PlatformSettings/YouTubeSettings.tsx` | 45 | EXISTS - NO chevron (different pattern) |
| `main.css` | `apps/website/src/main.css` | 2436 | EXISTS - matches analysis |
| `Layout.astro` | `apps/website/src/layouts/Layout.astro` | 60 | EXISTS - CSS import at line 58 |

### ChevronIcon Import Locations (Actual)

Only **3 files** import ChevronIcon (not 6 as stated in analysis):
1. `PlatformSettings/GitHubSettings.tsx`
2. `PlatformSettings/RedditSettings.tsx`  
3. `PlatformSettings/TwitterSettings.tsx`

**Note:** BlueskySettings, DevpadSettings, and YouTubeSettings do NOT use collapsible pattern - they display settings inline without expand/collapse.

### StatusBadge Import Locations (Actual)

Only **1 file** imports StatusBadge (not 2 as stated):
1. `PlatformCard.tsx` (line 15, used at line 141)

**Note:** ConnectionCard.tsx does NOT use StatusBadge - it has inline status handling.

### Adjustments Required

1. **ChevronIcon usage**: Only 3 components use it, not 6
2. **StatusBadge usage**: Only 1 component uses it, not 2
3. **Settings patterns vary**: BlueskySettings, DevpadSettings, YouTubeSettings don't use collapsible - they're simpler inline forms
4. **Current dependency**: `@f0rbit/ui` is NOT yet installed (need to add it)
5. **Package location**: Website package is at `apps/website/`, dependency should be added there

---

## 2. Risk Factors

### High Risk
- **CSS Layer Conflicts**: UI library uses `@layer`, must verify media-timeline's CSS loads correctly
- **Dark Mode Compatibility**: UI lib uses `data-theme` attribute - verify current dark mode approach (uses `prefers-color-scheme`)

### Medium Risk  
- **Status State Mapping**: `"not_configured"` state needs mapping to `"inactive"` for UI lib Status component
- **Modal Behavior**: ProfileEditor/FilterEditor have custom overlay click and escape key handling - must verify Modal component provides same UX

### Low Risk
- **Button styling changes**: Current `.btn-secondary` pattern may need adjustment
- **Form field padding**: May need minor CSS tweaks for visual consistency

### Breaking Changes
- **Not applicable**: This is internal UI refactoring, no public API changes
- **Backwards Compatibility**: Not a concern per project preferences

---

## 3. Phase Breakdown

### Phase 1: Foundation Setup (~30 min)

**Can be done in single agent - sequential dependencies**

| Task | Files Changed | Est. Lines | Dependencies |
|------|---------------|------------|--------------|
| 1.1 Add `@f0rbit/ui` dependency | `apps/website/package.json` | +1 | None |
| 1.2 Import CSS in Layout | `apps/website/src/layouts/Layout.astro` | +2 | 1.1 |
| 1.3 Create token overrides file | `apps/website/src/styles/ui-overrides.css` (NEW) | +25 | 1.1 |
| 1.4 Import overrides in Layout | `apps/website/src/layouts/Layout.astro` | +1 | 1.3 |

**Commands:**
```bash
cd apps/website && bun add @f0rbit/ui
```

---

### Phase 2: Drop-in Component Replacements (~1 hour)

**Parallel safe - different files**

| Task | Agent | Files Changed | Est. Lines Changed |
|------|-------|---------------|-------------------|
| 2.1 Replace ChevronIcon | A | ChevronIcon.tsx (DELETE), GitHubSettings.tsx, RedditSettings.tsx, TwitterSettings.tsx | -21 TSX, +6 imports |
| 2.2 Replace StatusBadge | B | StatusBadge.tsx (DELETE), PlatformCard.tsx | -24 TSX, +5 imports |
| 2.3 Replace StatCard | C | Dashboard/StatCard.tsx (DELETE), Dashboard/DashboardStats.tsx | -14 TSX, +2 imports |

**Details:**

**Task 2.1 - ChevronIcon Replacement:**
- DELETE: `apps/website/src/components/solid/ChevronIcon.tsx`
- MODIFY: `apps/website/src/components/solid/PlatformSettings/GitHubSettings.tsx`
  - Change: `import ChevronIcon from "../ChevronIcon"` -> `import { Chevron } from "@f0rbit/ui"`
  - Change: `<ChevronIcon expanded={expanded()} />` -> `<Chevron expanded={expanded()} />`
- MODIFY: `apps/website/src/components/solid/PlatformSettings/RedditSettings.tsx` (same changes)
- MODIFY: `apps/website/src/components/solid/PlatformSettings/TwitterSettings.tsx` (same changes)

**Task 2.2 - StatusBadge Replacement:**
- DELETE: `apps/website/src/components/solid/StatusBadge.tsx`
- MODIFY: `apps/website/src/components/solid/PlatformCard.tsx`
  - Change: `import StatusBadge, { type ConnectionState } from "./StatusBadge"`
  - To: `import { Status, type StatusState } from "@f0rbit/ui"`
  - Add helper: `const mapState = (s: ConnectionState): StatusState => s === "not_configured" ? "inactive" : s;`
  - Keep: `type ConnectionState = "not_configured" | "inactive" | "active" | "error"` (move inline or to types file)
  - Change: `<StatusBadge state={state()} />` -> `<Status state={mapState(state())} />`

**Task 2.3 - StatCard Replacement:**
- DELETE: `apps/website/src/components/solid/Dashboard/StatCard.tsx`
- MODIFY: `apps/website/src/components/solid/Dashboard/DashboardStats.tsx`
  - Change: `import StatCard from "./StatCard"` -> `import { Stat } from "@f0rbit/ui"`
  - Change: `<StatCard value={...} label={...} />` -> `<Stat value={...} label={...} />`

---

### Phase 3: Modal Components (~2 hours)

**Sequential - ProfileEditor first, then FilterEditor (similar patterns)**

| Task | Files Changed | Est. Lines Changed |
|------|---------------|-------------------|
| 3.1 Refactor ProfileEditor | ProfileEditor.tsx | ~-30 TSX |
| 3.2 Refactor FilterEditor | FilterEditor.tsx | ~-50 TSX |

**Task 3.1 - ProfileEditor Modal:**

Replace manual modal implementation with Modal components:
```tsx
// Before (lines 91-141)
<div class="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
  <div class="modal-card">
    <div class="modal-header">...</div>
    <form class="modal-form">...</form>
  </div>
</div>

// After
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, Button, FormField, Input, Textarea } from "@f0rbit/ui";

<Modal open={true} onClose={props.onClose}>
  <ModalHeader>
    <ModalTitle>{isEditMode() ? "Edit Profile" : "Create Profile"}</ModalTitle>
  </ModalHeader>
  <ModalBody>
    <form onSubmit={handleSubmit}>
      <FormField label="Name" required>
        <Input value={name()} ... />
      </FormField>
      ...
    </form>
  </ModalBody>
  <ModalFooter>
    <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
    <Button type="submit">Save</Button>
  </ModalFooter>
</Modal>
```

**Task 3.2 - FilterEditor Modal:**

Similar pattern to ProfileEditor, but also replace:
- `.filter-editor-overlay` -> `<Modal>`
- `.filter-editor-card` -> Modal structure
- `.filter-form-row` -> `<FormField>`
- Form selects -> `<Select>`

---

### Phase 4: Icon Buttons (~30 min)

**Parallel safe - different files**

| Task | Agent | Files Changed | Est. Lines Changed |
|------|-------|---------------|-------------------|
| 4.1 ConnectionActions buttons | A | ConnectionActions.tsx | ~-10 TSX |
| 4.2 ConnectionCard buttons | B | ConnectionCard.tsx | ~-10 TSX |
| 4.3 FilterEditor close button | C | FilterEditor.tsx | ~-5 TSX |

**Pattern:**
```tsx
// Before
<button class="icon-btn" onClick={...} title="...">
  <SomeIcon />
</button>

// After
import { Button } from "@f0rbit/ui";
<Button icon variant="ghost" label="..." onClick={...}>
  <SomeIcon />
</Button>
```

---

### Phase 5: Dropdown/ProfileSelector (~1.5 hours)

**Single agent - complex component**

| Task | Files Changed | Est. Lines Changed |
|------|---------------|-------------------|
| 5.1 Refactor ProfileSelector | ProfileSelector.tsx | ~-40 TSX |

Replace custom dropdown with Dropdown components:
```tsx
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownDivider, Button, Chevron } from "@f0rbit/ui";

<Dropdown>
  <DropdownTrigger>
    <Button variant="secondary">
      <ProfileIcon />
      <span>{buttonLabel()}</span>
      <Chevron facing="down" />
    </Button>
  </DropdownTrigger>
  <DropdownMenu>
    <For each={profileList()}>
      {p => <DropdownItem active={currentSlug() === p.slug} onClick={() => handleSelect(p.slug)}>{p.name}</DropdownItem>}
    </For>
    <DropdownDivider />
    <DropdownItem as="a" href="...">Manage Profiles</DropdownItem>
  </DropdownMenu>
</Dropdown>
```

---

### Phase 6: Settings Components with Collapsible (~1 hour)

**Parallel safe - different files**

| Task | Agent | Files Changed | Est. Lines Changed |
|------|-------|---------------|-------------------|
| 6.1 GitHubSettings | A | GitHubSettings.tsx | ~-15 TSX |
| 6.2 RedditSettings | B | RedditSettings.tsx | ~-15 TSX |
| 6.3 TwitterSettings | C | TwitterSettings.tsx | ~-10 TSX |

**Pattern:**
```tsx
// Before
<div class="settings-section">
  <button class="settings-header" onClick={toggleExpanded}>
    <ChevronIcon expanded={expanded()} />
    <h6 class="settings-title">...</h6>
  </button>
  <Show when={expanded()}>
    <div class="settings-content">...</div>
  </Show>
</div>

// After
import { Collapsible, Checkbox } from "@f0rbit/ui";

<Collapsible trigger={<span class="settings-title">...</span>}>
  <div class="settings-content">
    {/* Replace checkbox labels with Checkbox component */}
    <Checkbox checked={!isHidden()} onChange={...} label={repo.full_name} />
  </div>
</Collapsible>
```

---

### Phase 7: CSS Cleanup (~1 hour)

**Single agent - must be after all component changes**

| Task | Files Changed | Est. Lines Removed |
|------|---------------|-------------------|
| 7.1 Remove replaced CSS | main.css | ~600 lines |

**CSS Sections to Remove:**

| Section | Line Range | Lines |
|---------|------------|-------|
| Button styles (`.icon-btn`) | 654-668 | ~15 |
| Modal styles (`.modal-*`) | 2066-2175 | ~110 |
| Status badge (`.status-badge`) | 1125-1156 | ~32 |
| Spinner animation | 385-396 | ~12 |
| Settings section (`.settings-*`, `.chevron-icon`) | 1172-1265 | ~94 |
| Profile selector (`.profile-selector-*`) | 2180-2354 | ~175 |
| Empty state (`.empty-state`) | 466-488 | ~23 |
| Form row (`.form-row`) | 592-621 | ~30 |
| Filter toggles (`.filter-toggle*`) | 604-621 | ~18 |

**CSS Sections to KEEP:**
- Timeline styles (`.timeline-*`) - domain-specific
- Dashboard styles (`.dashboard-*`, `.stats-row`, `.stat-card`) - may still need stat-card styling
- Platform colors (`.platform-*`) - brand-specific
- Reddit-specific styles - domain-specific
- Filter editor form styles - complex include/exclude coloring
- Responsive breakpoints - app-specific

---

## 4. Parallelization Strategy

```
Phase 1 (Sequential)
└── 1.1 → 1.2 → 1.3 → 1.4
    ↓
    Verification Agent: bun install, typecheck

Phase 2 (Parallel)
├── Agent A: Task 2.1 (ChevronIcon)
├── Agent B: Task 2.2 (StatusBadge)  
└── Agent C: Task 2.3 (StatCard)
    ↓
    Verification Agent: typecheck, test, commit "Replace drop-in components with @f0rbit/ui"

Phase 3 (Sequential)
└── 3.1 (ProfileEditor) → 3.2 (FilterEditor)
    ↓
    Verification Agent: typecheck, test, commit "Migrate modals to @f0rbit/ui Modal"

Phase 4 (Parallel)
├── Agent A: Task 4.1 (ConnectionActions)
├── Agent B: Task 4.2 (ConnectionCard)
└── Agent C: Task 4.3 (FilterEditor close btn - if not done in Phase 3)
    ↓
    Verification Agent: typecheck, test, commit "Replace icon buttons with Button icon variant"

Phase 5 (Single Agent)
└── 5.1 (ProfileSelector)
    ↓
    Verification Agent: typecheck, test, commit "Migrate ProfileSelector to Dropdown components"

Phase 6 (Parallel)
├── Agent A: Task 6.1 (GitHubSettings)
├── Agent B: Task 6.2 (RedditSettings)
└── Agent C: Task 6.3 (TwitterSettings)
    ↓
    Verification Agent: typecheck, test, commit "Migrate settings to Collapsible + Checkbox"

Phase 7 (Single Agent)
└── 7.1 (CSS Cleanup)
    ↓
    Verification Agent: typecheck, visual check, commit "Remove replaced CSS styles"
```

---

## 5. File Path Summary

### Files to DELETE (4)
```
apps/website/src/components/solid/ChevronIcon.tsx
apps/website/src/components/solid/StatusBadge.tsx
apps/website/src/components/solid/Dashboard/StatCard.tsx
```

### Files to CREATE (1)
```
apps/website/src/styles/ui-overrides.css
```

### Files to MODIFY (13)
```
apps/website/package.json
apps/website/src/layouts/Layout.astro
apps/website/src/main.css
apps/website/src/components/solid/PlatformCard.tsx
apps/website/src/components/solid/ProfileEditor.tsx
apps/website/src/components/solid/FilterEditor.tsx
apps/website/src/components/solid/ProfileSelector.tsx
apps/website/src/components/solid/ConnectionActions.tsx
apps/website/src/components/solid/ConnectionCard.tsx
apps/website/src/components/solid/Dashboard/DashboardStats.tsx
apps/website/src/components/solid/PlatformSettings/GitHubSettings.tsx
apps/website/src/components/solid/PlatformSettings/RedditSettings.tsx
apps/website/src/components/solid/PlatformSettings/TwitterSettings.tsx
```

### Files NOT Modified (unchanged from analysis)
```
apps/website/src/components/solid/PlatformSettings/BlueskySettings.tsx  (no collapsible)
apps/website/src/components/solid/PlatformSettings/DevpadSettings.tsx   (no collapsible)
apps/website/src/components/solid/PlatformSettings/YouTubeSettings.tsx  (no collapsible)
```

---

## 6. Estimated Impact

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| TSX Components | 17 | 14 | -3 files |
| TSX LOC | ~1,500 | ~1,350 | ~-150 (~10%) |
| CSS LOC | 2,436 | ~1,850 | ~-586 (~24%) |
| **Total UI LOC** | ~3,936 | ~3,200 | **~-736 (~19%)** |

---

## 7. Verification Commands

After each phase, verification agent should run:
```bash
# In project root
bun install                    # Ensure dependencies installed
bun run typecheck              # TypeScript validation
bun run build                  # Full build check
bun run dev &                  # Start dev server
# Manual: Check dark mode, modals, dropdowns, settings panels
```

---

## 8. Pre-Implementation Checklist

- [ ] Verify `@f0rbit/ui` is published and accessible via npm
- [ ] Confirm UI library exports: `Chevron`, `Status`, `Stat`, `Modal`, `ModalHeader`, `ModalTitle`, `ModalBody`, `ModalFooter`, `Button`, `FormField`, `Input`, `Textarea`, `Select`, `Dropdown`, `DropdownTrigger`, `DropdownMenu`, `DropdownItem`, `DropdownDivider`, `Collapsible`, `Checkbox`
- [ ] Verify UI library's `StatusState` type includes `"active" | "inactive" | "error"`
- [ ] Check if UI library CSS uses `@layer` and determine load order requirements
