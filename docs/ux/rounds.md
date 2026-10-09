# UX improvement rounds — history

Goal: all four independent evaluators score **strictly above 9.8** on the same version, no open P0/P1, full matrix
coverage, then one confirmation round with no changes keeps the result. Approval uses the **minimum** score, unrounded.
Brief (rubric, formula, matrix, rules): `evaluator-brief.md`. Raw reports: `rounds/r<N>/<evaluator>/report.md`.

Evaluators: **E1** usability & information architecture (Nielsen) · **E2** flows & interaction design (Shneiderman) ·
**E3** visual design, consistency & responsiveness · **E4** accessibility, contrast, motion & micro-interactions.

| Round | Version (commit) | E1 | E2 | E3 | E4 | Mean | Min | N (fixes) | Status |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 523898b | 4.92125 | 4.935 | 5.32 | 6.0425 | 5.3047 | **4.92125** | 10 (B01–B12, see r1/backlog.md) | implemented + acceptance-validated, see R1 notes |
| R2 | f99dd93 | 6.52125 | 7.4325 | 7.33125 | 7.87625 | 7.2903 | **6.52125** | 18 (C01–C18 + Mantine redesign, see r2/backlog.md) | no P0; P1: focus on load, raw codes → implemented in 599e27d (Mantine redesign, acceptance 51/51) |
| R3 | ab6f108 | 8.35125 | 8.2825 | 8.16375 | 8.18875 | 8.2466 | **8.16375** | 15 (D01–D15) | P1: hidden nav focusable, error contrast → implemented in 9aa322a (acceptance 69/69) |
| R4 | c344e8d | 8.33625 | 8.63625 | 8.62375 | 8.60875 | 8.55125 | **8.33625** | see r4/backlog.md | no P0/P1 → implementing |

## R1 notes

- **Selected (N=10):** B01 P0, B02–B06 P1, B07, B08, B09+B10, B11+B12 (backlog: `rounds/r1/backlog.md`).
- **Also touched in the same code** (recorded, not counted as selected): breadcrumb on investigation/validation pages
  (part of B13), focusable evidence `<pre>` (B21), first-load / post-navigation / post-decision focus (part of B19).
- **Implemented:** API returns `validation_run_id` (run created queued up front, concurrent validation → 409) and exposes
  `review` + `last_status_change`; `useApi` with polling and no blank refetch; announcer live region; error boundary;
  `ActionButton` (busy, single in-flight, two-step confirm, visible role reason, inline error, precheck); review with
  required note for reject, optional resolve-on-approve, persistent decision panel with focus; per-entity status
  dictionary; NotFound + page frame + specific titles; human error messages; responsive stacked tables; shell rows.
- **Validated (acceptance script, real browser, fixture V4):** 32/32 checks — B01 lands on real run, queued state,
  completes without reload (36 s); B02 status updates in 2.6 s without reload; B03 double-click → 1 POST (start and
  review); B04 empty reject blocked + focused, confirm step, decision panel focused and persistent, incident resolved,
  note in timeline; B09 viewer disabled + reason, 0 POSTs; B10 notice + confirm; B11 network error human; B12 not-found
  h1/links/title; error boundary; skip link first; h1 focus on navigation; B07 header ≤ 174 px. Responsive + axe sweep
  (320/390/1440 × light/dark × 7 routes): 0 overflow, 0 axe violations, no raw status codes.
- **Defects found during my verification and fixed before R2:** breadcrumb inherited primary-nav styles; pills stretched
  in stacked rows; 4 px overflow at 320 from non-wrapping pills; raw outcome codes on Evaluations; generic not-found titles.
- Suites: tsc, vite build, 33 contrast pairs, 18 axe/keyboard/reflow tests, ruff, mypy, 25 pytest — all pass.
- **Deferred:** B13 (rest), B14–B18, B20, B22–B26.
