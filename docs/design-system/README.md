# Design system — Data Reliability Copilot

A small design system for a technical investigation product. Code lives in `web/src/styles/tokens.css`,
`web/src/styles/app.css` and `web/src/components/ui.tsx`. Live gallery: `#/gallery`, rendered with
**hand-written fixtures** (`web/src/fixtures.ts`), not pipeline output.

Design rule: users must always be able to tell **observed fact**, **hypothesis**, **recommendation** and
**verified result** apart, and that distinction must never rely on color alone.

## Commands

```bash
cd web
npm ci
npm run typecheck      # tsc --noEmit (TypeScript 7.0.2)
npm run build          # vite build
npm run contrast       # WCAG contrast check of token pairs, exits 1 below AA
npx playwright install chromium   # once, ~680 MB in ~/.cache/ms-playwright
npm run a11y           # build + preview + axe + reflow + keyboard tests; writes screenshots/ and a11y-results.json
```

## Tokens

Semantic CSS custom properties. Light theme by default. Dark theme applies through `prefers-color-scheme: dark`,
or explicitly with `<html data-theme="dark|light">`; the top-bar Theme selector sets it.

| Group | Tokens |
|---|---|
| Surfaces | `--bg`, `--surface`, `--surface-2` |
| Text | `--text`, `--text-muted`, `--link` |
| Lines/focus | `--border` (decorative only), `--border-strong` (component boundaries, ≥3:1), `--focus` |
| Status | `--{pass,warn,fail,info,unknown}-{fg,bg}` |
| Epistemic | `--{fact,hypothesis,recommendation,verified}-{fg,bg}` |
| Type | `--font-sans`, `--font-mono`, `--fs-xs…xl` (12/14/16/20/24 px), `--lh` 1.5 |
| Spacing | `--sp-1,2,3,4,6,8` (4/8/12/16/24/32 px) |
| Shape | `--radius-sm` 4px, `--radius-md` 8px, `--target-min` 24px |

### Measured contrast (`node scripts/contrast.mjs --markdown`)

Text pairs need ≥ 4.5:1 (SC 1.4.3); focus indicator and component boundaries need ≥ 3:1 (SC 1.4.11).

| pair | min | light | dark |
|---|---|---|---|
| `text` on `bg` | 4.5:1 | 15.48 | 15.40 |
| `text-muted` on `bg` | 4.5:1 | 7.22 | 8.08 |
| `link` on `bg` | 4.5:1 | 6.14 | 9.05 |
| `focus` on `bg` | 3:1 | 6.14 | 9.05 |
| `border-strong` on `bg` | 3:1 | 4.39 | 4.89 |
| `text` on `surface` | 4.5:1 | 16.88 | 14.19 |
| `text-muted` on `surface` | 4.5:1 | 7.87 | 7.45 |
| `link` on `surface` | 4.5:1 | 6.70 | 8.33 |
| `focus` on `surface` | 3:1 | 6.70 | 8.33 |
| `border-strong` on `surface` | 3:1 | 4.78 | 4.50 |
| `text` on `surface-2` | 4.5:1 | 14.79 | 12.82 |
| `text-muted` on `surface-2` | 4.5:1 | 6.90 | 6.73 |
| `link` on `surface-2` | 4.5:1 | 5.87 | 7.53 |
| `focus` on `surface-2` | 3:1 | 5.87 | 7.53 |
| `border-strong` on `surface-2` | 3:1 | 4.19 | 4.07 |
| `pass-fg` on `pass-bg` / `surface` | 4.5:1 | 6.49 / 7.13 | 10.19 / 12.40 |
| `warn-fg` on `warn-bg` / `surface` | 4.5:1 | 6.15 / 6.85 | 9.62 / 12.07 |
| `fail-fg` on `fail-bg` / `surface` | 4.5:1 | 5.30 / 6.47 | 8.54 / 9.17 |
| `info-fg` on `info-bg` / `surface` | 4.5:1 | 7.15 / 8.72 | 8.45 / 9.66 |
| `unknown-fg` on `unknown-bg` / `surface` | 4.5:1 | 8.33 / 10.31 | 9.12 / 11.82 |
| `fact-fg` on `fact-bg` / `surface` | 4.5:1 | 11.86 / 14.68 | 10.86 / 14.06 |
| `hypothesis-fg` on `hypothesis-bg` / `surface` | 4.5:1 | 7.39 / 8.72 | 8.77 / 9.85 |
| `recommendation-fg` on `recommendation-bg` / `surface` | 4.5:1 | 6.38 / 7.31 | 8.90 / 10.32 |
| `verified-fg` on `verified-bg` / `surface` | 4.5:1 | 6.49 / 7.13 | 10.19 / 12.40 |

The primary button uses `--surface` text on a `--focus` background: 6.70:1 in light, 8.33:1 in dark (same pair as
`focus` on `surface`).

## Components

| Component | Purpose | Non-color cue / a11y notes |
|---|---|---|
| `StatusPill` | pass / warn / fail / error / skipped / unknown / info | glyph (✓ ▲ ✕ ! – ? i) + text label; glyph is `aria-hidden` |
| `EpistemicTag` | FACT / HYPOTHESIS / RECOMMENDATION / VERIFIED | label + glyph (■ ? → ✓) + border shape (square / dashed / arrow-ish / double) |
| `.claim` block | wraps a fact or hypothesis with its quote and citations | hypotheses use a dashed left rule |
| `EvidenceRef` | citation chip; moves focus to `#ev-<id>` | missing refs render as dashed fail chip with "✕" and SR text "(reference not found)" |
| `ModeBanner` | FAKE LLM and cost not measured | `role="note"`, text states what it means; `cost_usd: null` renders "unknown", never 0 |
| `Card` | titled `<section>` | `aria-labelledby` → its `<h2>` |
| `DataTable` | semantic `<table>` with `<caption>` and `th[scope=col]` | wrapped in a focusable `role="region"` so keyboard users can scroll wide tables |
| `Timeline` | ordered audit events | `<ol>` + `<time datetime>` |
| `Tabs` | WAI-ARIA tabs, automatic activation | roving tabindex; ←/→, Home, End |
| `Loading` / `EmptyState` / `ErrorState` / `AccessDenied` | the four non-data states | Loading `role="status"`; Error and AccessDenied `role="alert"`; text names the required role |
| `SkipLink` | first focusable element | moves focus to `<main>` |

## Interaction & keyboard rules

- Everything is reachable with Tab. Visible focus: 3px `--focus` outline, 2px offset, through `:focus-visible`.
- On first load the skip link is first in tab order. On route changes, focus moves to `<main>` and the document title updates.
- Tabs follow the APG pattern. Arrow keys move and select; tab panels are focusable.
- Citation chips are buttons; activating one scrolls to the evidence card and focuses it.
- Minimum target size is 24×24 px (`--target-min`; SC 2.5.8). Buttons and tabs are 32–36 px tall.
- Motion: the spinner stops under `prefers-reduced-motion: reduce`.
- Dev-only role switcher (`viewer` / `investigator` / `approver`) sends `X-DRC-Role` so 403 states can be exercised. It is not an auth mechanism.

## States

Every API-backed view goes through `LoadView`. Loading uses `Loading`, 403 uses `AccessDenied`, 404 uses `EmptyState("Not found")`,
and other errors use `ErrorState` with Retry; 502/503/504 report "API unreachable". Restricted evidence keeps its metadata and
replaces the content with `AccessDenied`.

## Responsiveness

- < 480 px: key/value lists stack as label over value.
- < 960 px: the navigation becomes a horizontal wrapping bar above content.
- ≥ 960 px: 220 px sidebar plus content (max 1200 px). Card grids use `auto-fit, minmax(min(260px,100%),1fr)`.
- Wide tables scroll inside their own focusable region instead of the page. Verified: no horizontal page scroll at 320 px on all 7 routes (SC 1.4.10).

## WCAG 2.2 AA checklist

"Automated" means run by `npm run a11y` or `npm run contrast`. "Manual" means checked by looking at screenshots or code in this phase. "Not verified" means nobody has checked it yet.

| SC | Requirement | How verified | Status |
|---|---|---|---|
| 1.1.1 | Non-text content | decorative glyphs `aria-hidden`, meaning carried by text; axe | automated + manual |
| 1.3.1 | Info & relationships | semantic tables/captions, lists, headings, `dl`; axe | automated |
| 1.4.1 | Use of color | status/epistemic always icon + text + shape; screenshot review | manual |
| 1.4.3 | Contrast (text) | `npm run contrast` (token pairs) + axe `color-contrast` on rendered pages, both themes | automated |
| 1.4.10 | Reflow | Playwright: `scrollWidth ≤ innerWidth` at 320 px, all routes | automated |
| 1.4.11 | Non-text contrast | `border-strong`, `focus` ≥ 3:1 (contrast script) | automated (tokens only) |
| 1.4.12 | Text spacing | not tested | **not verified** |
| 1.4.13 | Content on hover/focus | no tooltips/popovers exist | n/a |
| 2.1.1 | Keyboard | Playwright: skip link, tabs arrow keys; native buttons/links elsewhere | automated (partial) |
| 2.4.1 | Bypass blocks | skip link test | automated |
| 2.4.2 | Page titled | title set per route (code) | manual |
| 2.4.3 | Focus order | focus to `<main>` on navigation; DOM order = visual order | manual |
| 2.4.7 | Focus visible | `:focus-visible` outline; checked in code and screenshots | manual |
| 2.4.11 | Focus not obscured (min) | no sticky headers/overlays | manual |
| 2.5.8 | Target size (min) | `--target-min` 24 px; axe `target-size` rule (wcag22aa tag) | automated |
| 3.2.2 | On input | role switch reloads the page; selecting a theme changes nothing else | manual (see limitations) |
| 3.3.1/3.3.2 | Error identification / labels | inputs have `<label>`; errors in `role="alert"` | automated (labels) + manual |
| 4.1.2 | Name, role, value | axe ARIA rules; tabs `aria-selected`/`aria-controls` | automated |
| 4.1.3 | Status messages | `role="status"` (loading), `role="alert"` (errors) | manual |

Latest automated run (`docs/design-system/a11y-results.json`): **0 axe violations** on 7 routes × 2 themes, plus the
4 diagnosis tab panels × 2 themes. Tags: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa. **18/18 Playwright tests passed.**
Screenshots: `docs/design-system/screenshots/` (`<page>-<light|dark>.png`, `gallery-mobile-320.png`).

## Known accessibility limitations

- **axe finds a subset of issues.** It can't judge whether labels are meaningful, whether reading order makes sense, or whether announcements are useful. 0 violations is not a conformance claim.
- **No screen-reader testing** (NVDA, JAWS, VoiceOver, TalkBack). Live-region behavior (`role="status"`/`alert`) has not been heard.
- **No zoom/text-spacing test** (SC 1.4.4 at 200 %, SC 1.4.12). The 320 px reflow test only partly stands in for 400 % zoom.
- **API-backed pages were audited in their error state.** The API was not running during the test, so the populated views were audited through the gallery fixtures. Pages with real data have not been audited.
- **Non-text contrast is checked only for tokens.** Pill borders use `currentColor`, which passes, but no rendered pixel-level check of every border exists.
- **Role switcher reloads the page** on change (SC 3.2.2 risk: it is a dev-only control and the label says so).
- **Emoji/glyph rendering depends on fonts.** Headless Chromium rendered 🔒 as a missing-glyph box, so it was replaced with ⊘. Other glyphs (✓ ▲ ✕ ■ →) rendered in tests but may vary by OS font.
- **Windows High Contrast / `forced-colors`** is untested. Pill backgrounds disappear there, but text and glyphs remain.
- **Charts:** none yet. Evaluation results are tables. Any future chart needs a table fallback.
