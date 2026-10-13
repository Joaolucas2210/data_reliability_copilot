# ADR-0012: Small in-repo design system on CSS custom properties, no UI library

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The UI is a tool for investigating incidents. Its main risk is not looks. The risk is a reader mistaking a
model's **hypothesis** for an **observed fact**, mistaking a sandbox result for production, or reading an
unknown cost as $0. The UI needs semantic color, status and epistemic tags that never rely on color alone,
light/dark themes, keyboard support and WCAG 2.2 AA evidence. Six screens plus a gallery. One developer. No designer.

## Alternatives

1. **Component library (MUI, Chakra, Mantine) + theme.** Accessible primitives out of the box. But it adds a large
   dependency and a theming API, and we would still have to build the epistemic/status semantics ourselves.
   Its value grows with complex widgets (date pickers, comboboxes) that we don't have.
2. **Headless primitives (Radix, React Aria) + own CSS.** Strong a11y for complex widgets. The only complex widget here is
   Tabs (~40 lines following the WAI-ARIA APG pattern).
3. **Tailwind.** Fast styling, but semantic tokens would become class conventions, and it adds a build plugin.
4. **Own tokens (CSS custom properties) + ~10 components in one file** (chosen).

## Decision

Option 4. Tokens live in `web/src/styles/tokens.css`. Components live in `web/src/components/ui.tsx`. Routing is a
hash router (regex table, no router lib). Data comes from `fetch` (no query lib). Dependencies are React 19.3.0,
Vite 8.3.4 and TypeScript 7.0.2. Vite 8 transforms TSX natively, so `@vitejs/plugin-react` is omitted (no Fast Refresh).
Fact, hypothesis, recommendation and verified each get their own token pair, glyph, label and border shape.

## Trade-offs

- Less code and fewer dependencies (2 runtime deps, JS bundle 260 kB / 80 kB gzip). We own the a11y of every widget.
- No Fast Refresh in dev: changes reload the full page.
- The hash router makes deep links work without server config, but URLs are less clean, and data loading is per component.

## Risks

- Hand-built widgets can regress on a11y. Mitigation: axe + keyboard Playwright tests (`npm run a11y`) in CI.
- Glyphs depend on available fonts (🔒 already failed in headless Chromium and was replaced).
- TypeScript 7 (native compiler) is new. If editor tooling or a library's types break, pin 5.9.x.

## Evidence

- `npm run contrast`: all 33 token pairs ≥ AA in both themes (table in `docs/design-system/README.md`).
- `npm run a11y` (2026-10-09): 18/18 passed. 0 axe violations (wcag2a/aa, 21a/aa, 22aa) on 7 routes × 2 themes and on 4 tab panels × 2 themes. No horizontal scroll at 320 px. Skip link and tab keyboard behavior verified.
- Visual review of the screenshots found and fixed: horizontal overflow at 320 px (grid min-width), table columns
  crushed by `overflow-wrap: anywhere` on `code`, unthemed textarea/select in dark mode, a missing 🔒 glyph, and
  before/after deltas colored as good/bad when the direction isn't inherently good or bad.

## Revisit when

- We need complex widgets (combobox, date range, virtualized tables, charts). Then adopt headless primitives (React Aria or Radix) instead of growing hand-built ones.
- More than one product surface or a second team consumes the tokens (publish them as a package).
- Screen-reader testing finds problems in the hand-built widgets.
