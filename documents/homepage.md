# Media Timeline - Landing Page Implementation Plan

## Design Vision

Create a premium, high-end landing page that communicates **sophistication, reliability, and technical excellence**. The design should feel like a $2k professional design agency deliverable—clean, modern, and purposeful.

### Design Philosophy

1. **Minimal but impactful**: Every element has purpose. No decorative clutter.
2. **Subtle depth**: Use shadows, gradients, and glassmorphism sparingly for premium feel.
3. **Confident typography**: Large, bold headlines with generous whitespace.
4. **Platform-native dark/light**: Leverage existing OKLCH color system for seamless theming.
5. **Motion as polish**: Subtle animations that feel natural, not gimmicky.

### Color Strategy

Building on existing CSS variables:
- Primary gradient: `oklch(55% 0.15 280)` → `oklch(45% 0.12 320)` (purple to magenta tint)
- Accent for CTAs: Leverage `--text-link` with enhanced vibrancy
- Platform colors already defined (GitHub gray, Reddit orange, Twitter black, etc.)
- Glassmorphism: `backdrop-filter: blur(20px)` with semi-transparent backgrounds

---

## Page Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              HEADER                                       │
│  [Logo/Brand]                                    [Timeline] [Connections] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                              HERO SECTION                                 │
│                                                                           │
│     "Your digital footprint,                                              │
│      one timeline."                                                       │
│                                                                           │
│     [Animated platform icons orbiting]                                    │
│                                                                           │
│     [Get Started →]    [View Demo]                                        │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                           PLATFORM SHOWCASE                               │
│                                                                           │
│   ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐      │
│   │GitHub │  │Reddit │  │Twitter│  │Bluesky│  │YouTube│  │Devpad │      │
│   └───────┘  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘      │
│                                                                           │
│   "6 platforms. One unified view. Zero context switching."               │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                          FEATURES SECTION                                 │
│                                                                           │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│   │  Unified        │  │  Multi-tenant   │  │  Privacy-first  │          │
│   │  Timeline       │  │  Sharing        │  │  Design         │          │
│   │                 │  │                 │  │                 │          │
│   │  Group commits  │  │  Share accounts │  │  Encrypted      │          │
│   │  by repo, see   │  │  across teams   │  │  tokens, your   │          │
│   │  your day       │  │  with roles     │  │  data           │          │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                        HOW IT WORKS SECTION                               │
│                                                                           │
│   1. Connect  ────────►  2. Sync  ────────►  3. Browse                    │
│                                                                           │
│   Add your              Automatic            See your                     │
│   platform              background           unified                      │
│   credentials           sync every           timeline                     │
│                        5 minutes                                          │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                           TIMELINE PREVIEW                                │
│                                                                           │
│   [Interactive demo of timeline with mock data]                          │
│                                                                           │
│   ┌─ Today ─────────────────────────────────────────────────────────┐    │
│   │  ● 3 commits to media-timeline                                   │    │
│   │  ● Posted on r/programming                                       │    │
│   │  ● Tweeted about new feature                                     │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                             CTA SECTION                                   │
│                                                                           │
│                 "Ready to see your story?"                                │
│                                                                           │
│                    [Get Started Free →]                                   │
│                                                                           │
│                  Self-hosted. Open source.                               │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                              FOOTER                                       │
│   media.devpad.tools                                [GitHub] [Star]      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Section Specifications

### 1. Header (Navbar)

**Purpose**: Navigation and brand presence

**Visual Design**:
- Sticky header with `backdrop-filter: blur(12px)` on scroll
- Transparent initially, gains subtle background on scroll
- Logo left, nav links right
- Subtle border-bottom on scroll

**Content**:
- Logo: "media timeline" text mark (existing h5 style)
- Nav: "Timeline" | "Connections" links

**Animation**:
- Header transforms on scroll (CSS `position: sticky` + JS scroll listener)
- Subtle opacity transition

**Component Structure**:
```
LandingHeader.astro
├── Logo (text)
└── Nav links
```

**CSS**:
```css
.landing-header {
  position: sticky;
  top: 0;
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s, background 0.2s;
  z-index: 100;
}

.landing-header.scrolled {
  border-bottom-color: var(--input-border);
}
```

---

### 2. Hero Section

**Purpose**: Capture attention, communicate core value proposition instantly

**Visual Design**:
- Full viewport height minus header (min-height: calc(100vh - 60px))
- Centered content with generous whitespace
- Gradient mesh background (subtle, animated)
- Platform icons floating/orbiting around a central focal point

**Content**:
- Headline: "Your digital footprint, one timeline."
- Subheadline: "Aggregate activity from GitHub, Reddit, Twitter, and more into a single, beautiful timeline."
- Primary CTA: "Get Started" (filled button with arrow icon)
- Secondary CTA: "View Demo" (outline/ghost button)

**Typography**:
- Headline: 3.5rem (56px), font-weight: 700, letter-spacing: -0.02em
- Subheadline: 1.25rem (20px), color: --text-tertiary, max-width: 600px
- CTAs: 1rem, medium weight

**Animation**:
- Gradient background slowly shifts (CSS animation, 20s loop)
- Platform icons float with gentle bobbing motion (CSS keyframes)
- Headline fades in from below on load (intersection observer or CSS)
- CTA buttons have subtle hover lift effect

**Component Structure**:
```
HeroSection.astro
├── GradientBackground (CSS)
├── PlatformOrbit.tsx (SolidJS for animation control)
│   └── PlatformIcon (6 instances, positioned radially)
├── HeroContent
│   ├── h1 (headline)
│   ├── p (subheadline)
│   └── CTAButtons
│       ├── PrimaryButton
│       └── SecondaryButton
```

**CSS Effects**:
```css
/* Gradient mesh background */
.hero-gradient {
  background: 
    radial-gradient(ellipse at 30% 20%, oklch(55% 0.08 280 / 0.15), transparent 50%),
    radial-gradient(ellipse at 70% 60%, oklch(55% 0.08 320 / 0.1), transparent 50%),
    var(--bg-primary);
  animation: gradientShift 20s ease-in-out infinite;
}

@keyframes gradientShift {
  0%, 100% { background-position: 0% 0%, 100% 100%; }
  50% { background-position: 100% 0%, 0% 100%; }
}

/* Platform icon float */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.platform-orbit-icon {
  animation: float 4s ease-in-out infinite;
}

/* Stagger the animations */
.platform-orbit-icon:nth-child(1) { animation-delay: 0s; }
.platform-orbit-icon:nth-child(2) { animation-delay: 0.5s; }
.platform-orbit-icon:nth-child(3) { animation-delay: 1s; }
/* ... etc */
```

---

### 3. Platform Showcase Section

**Purpose**: Show breadth of platform support at a glance

**Visual Design**:
- Horizontal row of platform cards/pills
- Each card shows platform icon with subtle platform-specific color tinting
- Glassmorphism cards with hover effects
- Tagline below

**Content**:
- 6 platform icons: GitHub, Reddit, Twitter/X, Bluesky, YouTube, Devpad
- Tagline: "6 platforms. One unified view. Zero context switching."

**Animation**:
- Cards scale slightly on hover (transform: scale(1.05))
- Subtle glow effect on hover matching platform color
- Staggered fade-in on scroll

**Component Structure**:
```
PlatformShowcase.astro
├── PlatformPillRow
│   └── PlatformPill (x6) - reuses PlatformIcon.tsx
└── Tagline
```

**CSS**:
```css
.platform-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: color-mix(in srgb, var(--input-background) 60%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--input-border);
  border-radius: 24px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.platform-pill:hover {
  transform: scale(1.05);
  box-shadow: 0 8px 32px oklch(from var(--platform-color) l c h / 0.2);
}
```

---

### 4. Features Section

**Purpose**: Highlight key differentiators

**Visual Design**:
- 3-column grid on desktop, single column on mobile
- Each feature in a card with icon, title, description
- Cards have subtle gradient borders or glassmorphism
- Clean iconography (use lucide icons)

**Content**:

| Feature | Icon | Title | Description |
|---------|------|-------|-------------|
| Timeline | `Clock` | Unified Timeline | Group commits by repository, see your entire day's activity across all platforms in chronological order. |
| Sharing | `Users` | Multi-tenant Sharing | Share connected accounts across team members with role-based access control. |
| Privacy | `Shield` | Privacy-first | Your access tokens are encrypted at rest with AES-256. Self-host for complete control. |

**Animation**:
- Cards fade in staggered on scroll (intersection observer)
- Icon has subtle pulse on hover

**Component Structure**:
```
FeaturesSection.astro
├── SectionHeader (optional "Features" label)
└── FeatureGrid
    └── FeatureCard (x3)
        ├── Icon (lucide-solid)
        ├── Title (h4)
        └── Description (p)
```

**CSS**:
```css
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

@media (max-width: 768px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
}

.feature-card {
  padding: 32px 24px;
  background: var(--input-background);
  border: 1px solid var(--input-border);
  border-radius: 12px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
}

.feature-icon {
  width: 48px;
  height: 48px;
  padding: 12px;
  background: linear-gradient(135deg, oklch(55% 0.1 280), oklch(45% 0.1 320));
  border-radius: 12px;
  margin-bottom: 16px;
}
```

---

### 5. How It Works Section

**Purpose**: Simplify onboarding mental model

**Visual Design**:
- Horizontal 3-step flow with connecting lines/arrows
- Each step is a numbered circle with icon and text
- Progressive disclosure feel
- On mobile: vertical layout

**Content**:

| Step | Icon | Title | Description |
|------|------|-------|-------------|
| 1 | `Link` | Connect | Add your platform credentials or authenticate with OAuth. |
| 2 | `RefreshCw` | Sync | Automatic background sync runs every 5 minutes. |
| 3 | `LayoutList` | Browse | See your unified timeline, grouped and organized. |

**Animation**:
- Steps reveal sequentially on scroll
- Connecting line "draws" as user scrolls (optional, advanced)
- Numbers pulse when visible

**Component Structure**:
```
HowItWorksSection.astro
├── SectionHeader ("How it works")
└── StepsContainer
    ├── Step (x3)
    │   ├── StepNumber (1, 2, 3)
    │   ├── StepIcon
    │   ├── StepTitle
    │   └── StepDescription
    └── ConnectorLine (SVG or CSS)
```

**CSS**:
```css
.steps-container {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  position: relative;
}

.step {
  flex: 1;
  text-align: center;
  position: relative;
}

.step-number {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, oklch(55% 0.12 280), oklch(50% 0.12 300));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.25rem;
  margin: 0 auto 16px;
}

/* Connector line */
.steps-container::before {
  content: '';
  position: absolute;
  top: 24px;
  left: calc(16.67% + 24px);
  right: calc(16.67% + 24px);
  height: 2px;
  background: var(--input-border);
  z-index: 0;
}

@media (max-width: 768px) {
  .steps-container {
    flex-direction: column;
    align-items: stretch;
  }
  
  .steps-container::before {
    display: none;
  }
}
```

---

### 6. Timeline Preview Section

**Purpose**: Show, don't tell—give a taste of the actual product

**Visual Design**:
- Interactive mock timeline using existing TimelineList styling
- Contained in a device/browser frame mockup (optional)
- Shows realistic sample data
- Glassmorphic container with gradient border

**Content**:
- Mock timeline data showing:
  - 3 commits grouped to "media-timeline"
  - 1 Reddit post to r/programming
  - 1 Tweet
  - 1 Bluesky post

**Animation**:
- Timeline items stagger in on scroll
- Optional: auto-scrolling demo that pauses on hover

**Component Structure**:
```
TimelinePreviewSection.astro
├── SectionHeader ("See it in action")
├── BrowserFrame (optional decorative frame)
└── MockTimeline.tsx (SolidJS - uses existing timeline styling)
    └── Mock data rendered with existing timeline components
```

**Note**: Reuse existing timeline CSS classes (`.timeline-flat`, `.timeline-row`, etc.) for consistency and reduced code.

---

### 7. CTA Section

**Purpose**: Final conversion point

**Visual Design**:
- Full-width section with gradient background
- Large, centered headline and CTA button
- Reassuring sub-text (open source, self-hosted)

**Content**:
- Headline: "Ready to see your story?"
- CTA: "Get Started Free" (large button with arrow)
- Sub-text: "Self-hosted. Open source. Your data stays yours."

**Animation**:
- Background gradient matches hero but more pronounced
- CTA button has magnetic/pulse effect on hover

**Component Structure**:
```
CTASection.astro
├── GradientBackground
├── Headline (h2)
├── CTAButton
└── SubText
```

**CSS**:
```css
.cta-section {
  padding: 120px 24px;
  text-align: center;
  background: 
    radial-gradient(ellipse at 50% 100%, oklch(55% 0.1 280 / 0.2), transparent 70%),
    var(--bg-primary);
}

.cta-headline {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 24px;
}

.cta-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 32px;
  font-size: 1.125rem;
  font-weight: 600;
  background: linear-gradient(135deg, oklch(55% 0.15 280), oklch(50% 0.15 300));
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.cta-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px oklch(55% 0.15 280 / 0.4);
}
```

---

### 8. Footer

**Purpose**: Navigation, legal, social proof

**Visual Design**:
- Simple, minimal footer
- Brand, links, GitHub star badge

**Content**:
- Left: "media.devpad.tools"
- Right: GitHub link with star count badge (optional)

**Component Structure**:
```
LandingFooter.astro
├── BrandText
└── SocialLinks
    └── GitHubLink (with optional star badge)
```

---

## Technical Implementation

### New Files to Create

```
apps/website/src/
├── pages/
│   └── landing.astro          # Temporary during dev, will become index.astro
├── components/
│   └── landing/
│       ├── HeroSection.astro
│       ├── PlatformOrbit.tsx   # SolidJS for animation
│       ├── PlatformShowcase.astro
│       ├── FeaturesSection.astro
│       ├── FeatureCard.astro
│       ├── HowItWorksSection.astro
│       ├── TimelinePreview.tsx # SolidJS - mock timeline
│       ├── CTASection.astro
│       ├── LandingHeader.astro
│       └── LandingFooter.astro
└── styles/
    └── landing.css             # Landing-specific styles
```

### CSS Architecture

**Approach**: Add landing-specific styles to a separate `landing.css` file that's imported only on the landing page. This keeps `main.css` focused on app styles while allowing landing-page-specific design elements.

**New CSS Variables** (add to landing.css):
```css
:root {
  /* Landing-specific gradients */
  --gradient-primary: linear-gradient(135deg, oklch(55% 0.15 280), oklch(50% 0.15 300));
  --gradient-bg-subtle: radial-gradient(ellipse at 50% 0%, oklch(55% 0.08 280 / 0.1), transparent 50%);
  
  /* Landing-specific sizing */
  --landing-max-width: 1200px;
  --section-padding: 120px 24px;
  --section-padding-mobile: 60px 16px;
}
```

### Animation Strategy

1. **CSS-only animations**: For simple effects (floats, fades, transforms)
2. **Intersection Observer**: For scroll-triggered animations (via a small SolidJS utility)
3. **No heavy libraries**: Keep bundle size minimal

**ScrollReveal utility** (reusable):
```tsx
// apps/website/src/components/landing/ScrollReveal.tsx
import { createSignal, onMount, ParentComponent } from 'solid-js';

export const ScrollReveal: ParentComponent<{ delay?: number }> = (props) => {
  const [visible, setVisible] = createSignal(false);
  let ref: HTMLDivElement;

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), props.delay ?? 0);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(ref);
  });

  return (
    <div
      ref={ref!}
      class="scroll-reveal"
      classList={{ visible: visible() }}
    >
      {props.children}
    </div>
  );
};
```

```css
.scroll-reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.scroll-reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### Responsive Breakpoints

Align with existing patterns:
- Desktop: > 1000px
- Tablet: 768px - 1000px
- Mobile: < 768px

---

## Content Copy

### Headlines & Taglines

| Section | Element | Copy |
|---------|---------|------|
| Hero | H1 | Your digital footprint, one timeline. |
| Hero | Subhead | Aggregate activity from GitHub, Reddit, Twitter, and more into a single, beautiful timeline. |
| Hero | CTA Primary | Get Started |
| Hero | CTA Secondary | View Demo |
| Platforms | Tagline | 6 platforms. One unified view. Zero context switching. |
| Features | Section Label | Why Media Timeline |
| How It Works | Section Label | How it works |
| Timeline Preview | Section Label | See it in action |
| CTA | Headline | Ready to see your story? |
| CTA | Button | Get Started Free |
| CTA | Subtext | Self-hosted. Open source. Your data stays yours. |

### Feature Descriptions

| Feature | Title | Description |
|---------|-------|-------------|
| Timeline | Unified Timeline | Group commits by repository. See your posts, tweets, and videos in one chronological stream. |
| Sharing | Team Sharing | Share connected accounts with teammates. Role-based access keeps everyone on the same page. |
| Privacy | Privacy-first | AES-256 encrypted tokens. Self-hosted deployment. Your data never leaves your control. |

### How It Works Steps

| Step | Title | Description |
|------|-------|-------------|
| 1 | Connect | Link your accounts with secure OAuth or API tokens. |
| 2 | Sync | Background sync runs every 5 minutes. Always up to date. |
| 3 | Browse | Your unified timeline, organized and searchable. |

---

## Implementation Order

### Phase 1: Foundation (Day 1)
**Estimated LOC: ~150**

1. Create `landing.css` with new CSS variables and base landing styles
2. Create `LandingHeader.astro` (modify existing pattern)
3. Create `LandingFooter.astro`
4. Create `landing.astro` page with basic structure
5. Test responsive layout

### Phase 2: Hero Section (Day 1-2)
**Estimated LOC: ~200**

1. Create `HeroSection.astro` with content and layout
2. Create `PlatformOrbit.tsx` with floating platform icons
3. Add gradient background and animations
4. Implement CTA buttons with hover effects
5. Test on all breakpoints

### Phase 3: Platform Showcase (Day 2)
**Estimated LOC: ~80**

1. Create `PlatformShowcase.astro`
2. Add glassmorphic pill styling
3. Implement hover effects with platform colors
4. Test responsiveness

### Phase 4: Features Section (Day 2)
**Estimated LOC: ~120**

1. Create `FeatureCard.astro` component
2. Create `FeaturesSection.astro` with grid layout
3. Add lucide icons
4. Implement scroll reveal animations

### Phase 5: How It Works (Day 3)
**Estimated LOC: ~100**

1. Create `HowItWorksSection.astro`
2. Implement step components with numbers
3. Add connector line (CSS)
4. Mobile responsive layout

### Phase 6: Timeline Preview (Day 3)
**Estimated LOC: ~150**

1. Create `TimelinePreview.tsx` with mock data
2. Reuse existing timeline CSS classes
3. Add stagger animation on reveal
4. Optional: browser frame decoration

### Phase 7: CTA Section (Day 3)
**Estimated LOC: ~60**

1. Create `CTASection.astro`
2. Add gradient background
3. Implement button with effects

### Phase 8: Polish & Integration (Day 4)
**Estimated LOC: ~50**

1. Replace `index.astro` with landing page (move timeline to `/app`)
2. Final responsive testing
3. Performance optimization (lazy loading, image optimization)
4. Accessibility audit (focus states, contrast, semantic HTML)
5. Cross-browser testing

---

## Total Estimated LOC

| Phase | Component | LOC |
|-------|-----------|-----|
| 1 | Foundation | 150 |
| 2 | Hero | 200 |
| 3 | Platforms | 80 |
| 4 | Features | 120 |
| 5 | How It Works | 100 |
| 6 | Timeline Preview | 150 |
| 7 | CTA | 60 |
| 8 | Polish | 50 |
| **Total** | | **~910 LOC** |

---

## Dependencies

**No new dependencies required.** Everything uses:
- Astro (existing)
- SolidJS (existing)
- lucide-solid (existing)
- Native CSS animations and Intersection Observer API

---

## Parallel Execution Strategy

**Can run in parallel:**
- Phase 3 (Platform Showcase) + Phase 4 (Features) + Phase 5 (How It Works)
- These sections are independent and can be developed simultaneously

**Sequential dependencies:**
- Phase 1 (Foundation) must complete first
- Phase 2 (Hero) after Foundation
- Phase 6-8 after all sections complete

**Critical Path:**
```
Foundation → Hero → [Platforms | Features | How It Works] → Timeline Preview → CTA → Polish
            (1 day)              (1.5 days parallel)          (0.5 day)    (0.5d) (0.5d)
```

**Total estimated time: 3-4 days** with focused development.

---

## Limitations & Notes

1. **No heavy animation libraries**: Using CSS animations + Intersection Observer keeps bundle light but limits complex effects.

2. **Mock timeline data**: The preview section uses hardcoded mock data. Could later pull from actual demo account.

3. **Browser frame**: The browser mockup around timeline preview is optional and decorative—can skip if time-constrained.

4. **Star badge**: GitHub star count badge requires external API call or static value—consider skipping for v1.

5. **Dark mode**: All styles must work in both modes. Test thoroughly in both color schemes.

6. **Accessibility**: Ensure animations respect `prefers-reduced-motion`. Add `aria-labels` to interactive elements.

---

## Quality Checklist

Before considering the landing page complete:

- [ ] Works in Chrome, Firefox, Safari (latest)
- [ ] Mobile responsive (iPhone SE to large tablets)
- [ ] Dark mode fully styled
- [ ] Lighthouse score > 90 for Performance, Accessibility
- [ ] All animations smooth at 60fps
- [ ] No layout shifts on load
- [ ] Focus states visible for keyboard navigation
- [ ] Semantic HTML (proper heading hierarchy, landmarks)
- [ ] Content is compelling and error-free
- [ ] CTAs link to actual destinations
- [ ] No console errors
