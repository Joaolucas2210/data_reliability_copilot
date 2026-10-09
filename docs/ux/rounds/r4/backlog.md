# R4 consolidated backlog (version c344e8d)

Scores: E1 8.33625 · E2 8.63625 · E3 8.62375 · E4 8.60875 — mean 8.55125, **min 8.33625**. No P0/P1.

| ID | Pri | Problem | Found by | Solution | Acceptance |
|---|---|---|---|---|---|
| E01 | P2 | Incident still "Awaiting review" after approve/reject; reject has no banner; "Completed" beside decision | E2-F1/F3/F4 | Decision without closure moves the incident to Open (domain: awaiting_review→open, only when no other investigation awaits review); approve/reject banners with next step; decision chip replaces "Completed" (incident card + investigation header) | After reject the incident is Open with a "Diagnosis rejected" banner |
| E02 | P2 | Cancel race: dialog stays open after the run ends; silent/raw 409; focus to body | E1-F1 E4-F1/F2 | Close confirmations when the investigation stops being active; 409 → plain message; errors from unmounted actions shown as notifications; focus the outcome | No silent failure; plain message |
| E03 | P2 | Focus to body after Resolve/Dismiss/Reopen | E4-F1 | Focus the closure card heading after the state change | activeElement is the closure heading |
| E04 | P2 | Mobile chart drops A/B labels | E1-F2 E3-F3 | Short axis labels, all ticks | Three labels at 390 px |
| E05 | P2 | Mobile h1 oversized; ids break mid-token; titles are raw ids | E1-F3 E3-F2 E4-F9 | Smaller mobile h1; id as a secondary mono line; "For incident <title>" context line | h1 ≤ 2 lines + id line at 390 |
| E06 | P2 | Incidents filter out of sync with URL on back/forward/hash edits | E3-F1 E4-F8 | Remount list per query (state follows URL) | Forward to ?status=open shows Open |
| E07 | P2 | "Wrong: Diagnosed" next to expected "Diagnosed" | E4-F5 | "Right outcome, wrong causes" | — |
| E08 | P3 | Counter "61 of 61" with 25 shown; identical titles without id; search lacks id | E1-F4/F11 E2-F5 | "Showing 25 of N matching"; id under title; id in search | — |
| E09 | P3 | Number/money formatting ($0.0000, mixed decimals) | E1-F8 E2-F9 E3-F12 E4-F6 | 2-decimal amounts; $0.00 | — |
| E10 | P3 | Toasts cover header; tooltip over theme menu; role select clipped on mobile | E2-F6/F7 E3-F9/F10 E4-F3 | Bottom-right toasts; tooltip disabled while menu open; xs select 136 px on mobile | — |
| E11 | P3 | Disclosure styles mixed; empty-state actions links vs buttons; card layouts; decision heading scale; help line length; tabs wrap | E3-F4–F8 | One Accordion disclosure; buttons; tag row then title; h4-size heading; 75ch; one-row tabs | — |
| E12 | P3 | Gallery lacks restricted-evidence state; chips gap | E2-F10 E1-F9 E4-F11 | Restricted card; gap | — |
| E13 | P3 | Misc: div in p; breadcrumb shift; "Dbt"/"i" glyph; unknown route page; glossary manual reports; chart tab stop; drawer focus; duplicate Passed/VERIFIED; validation not cancellable stated | E1-F6/F7/F12 E2-F8/F11 E3-F11 E4-F7/F10/F12 | Fixed each | — |

Deferred (justified): cancelling a running sandbox validation (E1-F10/E2-F2, P3) needs worker-side cancellation of dbt/sandbox
steps — out of UX scope this round; the page now states it can't be stopped and only touches its isolated copy.
Theme-menu initial focus (E4-F4, P3): Mantine default (arrow key reaches the first item).

## Selection for round 5
**N = all 13 (E01–E13).** Justification: 7 P2s cluster in incident/investigation/validation/evaluations pages already
being edited; all P3s are small, low-risk and several were reported by 2–4 evaluators. Verified by acceptance script.
