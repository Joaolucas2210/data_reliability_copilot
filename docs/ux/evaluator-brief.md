# UX evaluation brief (fixed for every round — do not change between rounds)

## Rubric (score each criterion 0–10 with evidence)

Scale: 0 = unusable · 2 = severe failures · 5 = relevant difficulties · 8 = good, noticeable problems ·
9 = small deficiencies · 10 = no problem found **within the verified scope**.

**Nielsen (N1–N10):** N1 visibility of system status · N2 match with the real world · N3 user control and freedom ·
N4 consistency and standards · N5 error prevention · N6 recognition rather than recall · N7 flexibility and efficiency ·
N8 aesthetic and minimalist design · N9 help users recognise, diagnose, recover from errors · N10 help and documentation.

**Shneiderman (S1–S8):** S1 consistency · S2 universal usability · S3 informative feedback · S4 dialogs that yield closure ·
S5 error prevention · S6 easy reversal of actions · S7 user in control · S8 reduce short-term memory load.

**UI (U1–U10):** U1 visual hierarchy · U2 typography and legibility · U3 spacing and alignment · U4 component consistency ·
U5 responsiveness · U6 contrast and use of colour · U7 keyboard, focus and semantics · U8 clarity of copy ·
U9 feedback and micro-interactions · U10 motion and perceived performance.

Motion must explain change and support continuity, never distract or delay, and must respect `prefers-reduced-motion`.
Absence of decorative motion is **not** a defect.

**Score per evaluator** = 0.40 × mean(N1–N10) + 0.35 × mean(S1–S8) + 0.25 × mean(U1–U10). No rounding.
"Not verified" is a pending item, never a pass: a criterion you could not verify must be marked NOT VERIFIED and scored
as you would score the verified part, with the gap listed. "Not applicable" requires a written justification and is
removed from that block's mean (state the adjusted denominator). Weights never change.

This rubric is operational — it is not an official scale of Nielsen or Shneiderman.

## Product context

Data Reliability Copilot: investigates data-pipeline incidents (incl. "pipeline succeeded but the report is wrong").
Users: data engineer on call (`investigator`), finance/analytics owner (`viewer`), platform lead (`approver`).
Core promise: rules detect; an agent investigates and cites evidence; facts / hypotheses / recommendations / verified
results are visually distinct; recovery is only validated in an isolated sandbox; humans decide. The LLM is a labelled
deterministic **fake** in this environment — that labelling is intended, not a defect.

## Environment

- UI: http://127.0.0.1:5173 (Vite dev, proxies `/api` to http://127.0.0.1:8000). Worker running (processes queued
  investigations/validations in ~1–60 s).
- Role is chosen with the "Role (dev)" select (stored in `localStorage["drc.role"]`; values `viewer`, `investigator`,
  `approver`). Theme select: System / Light / Dark.
- Browser automation: Playwright + axe are installed. Import with absolute paths from any directory:
  ```js
  import { chromium } from "/home/joao/data_reliability_copilot/web/node_modules/@playwright/test/index.mjs";
  import AxeBuilder from "/home/joao/data_reliability_copilot/web/node_modules/@axe-core/playwright/dist/index.mjs";
  ```
  Run with `node your-script.mjs`. Look at your screenshots (Read the PNG) — code reading alone is not evidence.
- States you must reproduce: loading (delay `/api/**` with `page.route`), API error (abort or 500 via `page.route`),
  not-found ids, empty results (e.g. incidents filter `resolved`), permission denied (viewer), success after actions,
  validation/guarding of inputs (e.g. review note), reduced motion (`reducedMotion: "reduce"`), keyboard-only.
- Code is at `/home/joao/data_reliability_copilot/web/src` (read-only for you) — use it to explain what you observed,
  not instead of observing.

## Fixed evaluation matrix

**Viewports:** desktop 1440×900; mobile 390×844 (+ a 320 px reflow check). **Themes:** light and dark.
**Roles:** viewer, investigator, approver.

| # | Journey | Screens / states to cover |
|---|---|---|
| J1 | Assess pipeline health on arrival | `#/` — loaded, loading, API error |
| J2 | Find and triage an incident | `#/incidents` — list, status filter, empty filter result, loading, error |
| J3 | Understand an incident | `#/incidents/<id>` — checks, timeline, investigations; not-found id; viewer vs investigator |
| J4 | Start an investigation and follow it to a result | investigator on YOUR open manual incident → investigation page while queued/running → result |
| J5 | Read a diagnosis and check its evidence | `#/investigations/<id>` — summary, facts/hypotheses/gaps/recommendation tabs, citation chips → evidence, citation check, usage/limits, tool calls; restricted evidence as viewer |
| J6 | Validate a recovery in the sandbox | YOUR duplication investigation → "Validate in sandbox" → `#/validation-runs/<id>` — steps, isolation, invariants, before/after |
| J7 | Record a human decision | approver: approve or reject on YOUR investigation (with/without note); viewer/investigator see the permission state |
| J8 | Cancel / back out | cancel YOUR queued/running investigation if you can get one; navigation back/forward; role switch mid-task |
| J9 | Compare evaluation results | `#/evaluations` |
| J10 | Learn the visual language | `#/gallery` — every component state |

Shared read-only data (do not mutate): incidents with titles starting "4 failing check(s)…", "3 failing check(s)…",
"2 failing check(s)…" that are not yours, plus dismissed ones. Your own mutable fixtures are listed in your task.

## Rules

- Do not edit any repository file. Write scripts/screenshots only in your own output directory.
- Do not read other evaluators' output directories or reports.
- Mutate only your own fixtures (J4, J6, J7, J8).
- Deliver: `report.md` in your output directory with (1) scores per criterion with evidence (screenshot paths, steps,
  observations), (2) the computed score showing the three block means, (3) NOT VERIFIED / NOT APPLICABLE items,
  (4) findings list: id, screen/state, problem, principle(s), evidence, impact, suggested fix, severity P0–P3
  (P0 blocks a critical task or loses data; P1 strongly harms a task/accessibility; P2 relevant friction; P3 polish),
  (5) limitations of your evaluation. Also `scores.json`: `{"N":[10 numbers],"S":[8],"U":[10],"score":x,"na":[...],"not_verified":[...]}`.
