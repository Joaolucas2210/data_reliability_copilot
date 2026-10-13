# R2 consolidated backlog (version f99dd93)

Scores: E1 6.52125 · E2 7.4325 · E3 7.33125 · E4 7.87625, mean 7.2903, **min 6.52125**. No P0.
Sources: E1.md E2.md E3.md E4.md. Effort S/M/L; risk = regression/contract risk.

| ID | Pri | Problem | Found by | Solution | Effort | Risk | Acceptance |
|---|---|---|---|---|---|---|---|
| C01 | P1 | Focus lands on the loading h1, which unmounts when data arrives → focus on `<body>` (detail pages, Back/Forward, after redirects) | E1-F7 E2-F1 E3-F1 E4-F1 | One persistent page h1 through loading → loaded (frame h1 + data h1 merged) | S | Low | After navigation and data load, `activeElement` is the page h1 on every detail route |
| C02 | P1 | Raw machine codes as primary labels (incident titles, cause categories, limits, metric keys, timeline codes) | E1-F1 E2-N2 E3-N2/F11 E4-F5 | Plain-language incident titles; label maps for causes/limits/metrics; timeline as sentences; codes as secondary text | M | Low | No snake_case / dotted code as a primary label on any screen |
| C03 | P2 | Focus lost during/after async actions (disabled-while-busy, failed action, card replaced after cancel/status change) | E2-F1 E4-F2 | Busy via loading state that keeps focusable trigger; focus error; modal confirm returns focus; focus new card heading | S | Low | No action leaves focus on body |
| C04 | P2 | Evaluations: 23-col table 4021 px, snake_case, no accuracy, no "why wrong" | E1-F9 E2-F14 E3-F2 E4-F5 | Headline summary + accuracy chart + scenario matrix + metric definitions | M | Low | Comparison visible without horizontal scroll at 1440 |
| C05 | P2 | Validation: no per-stage progress during ~50-78 s; no closure/next step; playbook not named; raw JSON; truncated isolation text | E1-F8/F16 E2-F2/F5/F10 E3-F5/F12/F13 E4-F14 | Elapsed time + current-stage indicator; result summary with "Back to investigation to review" CTA; playbook named; key/value details; full messages | M | Low (API additive) | Finished run shows verdict + CTA; details readable on 390 |
| C06 | P2 | Investigation page 5.9-15k px; evidence expanded; claim→evidence one-way | E1-F4 E2-F6/F15 E3-F4 E4-F13 | Evidence accordion (collapsed), back-to-claim, highlight target | M | Low | Desktop page ≤ 4.5k px; back-to-claim returns focus to the chip |
| C07 | P2 | Review card: validation result not visible next to Approve/Reject; "resolve incident" pre-checked; nothing warns on unvalidated proposal; incident stuck after approve-without-resolve | E1-F5/F6 E2-F7/F8 | Summary of proposal/validation inside the review card and confirm prompt; resolve unchecked by default; warning when unvalidated; incident-level Resolve/Dismiss actions | M | Medium (API: incident transitions) | Approver sees validation state while deciding; incident closable from UI |
| C08 | P2 | Incident list: no search/sort; filter not in URL; Health "N open" ≠ list | E1-F2/F3 E2-F13 E3-N7 E4-F4/F15 | Text search + sort, filter in URL, "unresolved" filter linked from Health, result count announced | M | Low | Filter survives reload/back; Health count equals linked list |
| C09 | P2 | Role switch reloads, drops note, resets theme; theme not persisted | E1-F13 E2-F4 E3-F7 E4-F6 | Role switch without reload; draft notes in sessionStorage; theme persisted pre-paint | S | Low | Note and theme survive role switch and reload |
| C10 | P2 | Tables squeezed 601-1023 px (and 200% zoom); mid-word breaks (`overflow-wrap:anywhere`) | E3-F3/F6 E4-F10/F11 | Stack below 900 px; `break-word` + `<wbr>` after `_`; dates nowrap | S | Low | No one-word-per-line columns at 768; no mid-word breaks in normal tokens |
| C11 | P2 | `role=alert` for static permission notes; "Access denied" wording for normal role limits | E2-F9 E3-F16 E4-F3 | `role=note`, neutral wording ("Available to the approver role") | S | Low | No alerts on initial render |
| C12 | P2 | No help/glossary; gallery in main nav, incomplete, landmark-unique, multiple h1 | E1-F10 E3-F17 E4-F7 E2-F17 | Help & glossary page + search; design system page (single h1, inert previews, all states) | M | Low | Glossary reachable; design-system axe clean |
| C13 | P3 | Inline confirms: Escape doesn't close; sibling action active | E2-F11 E3-F15 E4-F8 | Modal confirmations (focus trap, Escape, focus return) | S | Low | Escape cancels; one pending intent |
| C14 | P3 | Announcer: "Decision recorded" overwritten by status change | E1-S3 E2-F12 | Suppress status announcement right after a user action | S | Low | Decision announcement is the last message |
| C15 | P3 | "Cancelled by worker" when the user cancelled | E2-F3 E4-F12 | Show requester from audit (cancel_requested actor) | S | Low (API additive) | Shows the person who cancelled |
| C16 | P3 | Empty cards on queued/cancelled; spacing glitches; mixed kv fonts; disabled primary looks enabled; focused headings without visible cue | E1-F14 E3-F8/F9/F10 E4-F9/F13/F16 | Hide empty sections; spacing; consistent value font; neutral disabled style; heading focus style | S | Low | Visual check |
| C17 | P3 | Check row "Observed 0 / Expected 0 / Fail" contradictory; dismissed incident lists awaiting-review investigation | E1-F17 E3-F18 | Show failures as observed for count checks; mark investigations of closed incidents | S | Low | No contradictory rows |
| C18 | P3 | Mobile: nav not collapsed (~170 px chrome), tabs wrap, chips ~22 px | E1-F19 E2-F16 E3-F14 | Burger navigation; scrollable tab list; ≥24 px chips | S | Low | Content starts < 80 px from top on mobile |

## Selection for round 3

**N = 18 (all).** Justification: the owner asked mid-round for a complete visual redesign on a ready-made component
library with first-class dark mode (ADR-0015). That redesign rewrites every shared component (shell, buttons,
confirmations, tables, alerts, tabs, timeline), which are the exact code paths of C01, C03, C10, C11, C13, C16, C18, and the
remaining items (C02, C04-C09, C12, C14, C15, C17) were already prepared in the `ux-prep` worktree during R2 or are
small. Splitting would re-evaluate a UI that is being replaced. Risk is controlled by a full acceptance script and the
fresh independent R3 evaluation of the whole matrix.
