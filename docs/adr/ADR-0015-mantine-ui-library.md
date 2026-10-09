# ADR-0015 — Mantine as the UI component library

- Status: Accepted (UX round 3)
- Partially supersedes: [ADR-0012](ADR-0012-design-system.md) (components; the tokens and status dictionary stay)

## Context

ADR-0012 chose a small hand-written component set on CSS custom properties. UX rounds 1–2 showed where that
costs us: focus management in confirmations, modal dialogs, accessible tabs, menus, responsive app shell and a
real dark mode all had to be built and kept accessible by hand. The owner asked for a polished, interactive
interface with first-class dark mode built on ready-made components.

## Decision

Adopt **Mantine 9.6.2** (`core`, `hooks`, `notifications`, `modals`, `spotlight`, `charts`) with
`@tabler/icons-react` 3.48.0 and `recharts` 3.10.1 (charts dependency). Versions are pinned exactly.

- Colour scheme: Mantine's `data-mantine-color-scheme` on `<html>` is the single switch; `tokens.css` keys its
  dark block on it, and a pre-paint script in `index.html` applies the stored choice (`drc-color-scheme`:
  light | dark | auto) to avoid a flash.
- Product meaning stays ours: the status dictionary (`status.ts`), epistemic tags, citation chips, claims and
  evidence styling remain in `app.css` on the contrast-checked tokens. Mantine's `dimmed` colour is mapped to
  `--text-muted` because the default gray fails 4.5:1 on white.
- `components/ui.tsx` keeps its exports; pages did not need to know which library renders a card or a table.
- Charts use a categorical palette validated for both surfaces (light `#2a78d6,#eb6834` on `#ffffff`, dark
  `#3987e5,#d95926` on `#171a21`), with legend, value labels and a table view — never colour alone.

## Consequences

- Modals give focus trap, Escape and focus return for confirmations; Spotlight gives global search (Ctrl/⌘+K, `/`).
- Bundle grows (Mantine + recharts); acceptable for an internal tool, revisit with route-level code splitting.
- Third-party components can regress accessibility on upgrade: the axe/reflow Playwright suite in CI
  (`npm run a11y`) and `npm run contrast` remain the gate, and versions are pinned.
