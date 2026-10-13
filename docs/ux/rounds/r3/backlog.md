# R3 consolidated backlog (version ab6f108)

Scores: E1 8.35125 · E2 8.2825 · E3 8.16375 · E4 8.18875, mean 8.2466, **min 8.16375**.
P1: hidden mobile nav focusable (E3-01); review-note error contrast (E4-F1). No P0.

| ID | Pri | Problem | Found by | Solution | Acceptance |
|---|---|---|---|---|---|
| D01 | P1 | Collapsed navbar (< 992 px) off-screen but focusable; burger without aria-expanded/Escape | E3-01/06 E4-F9 | `inert` when collapsed; aria-expanded/controls; Escape closes and refocuses burger | Collapsed nav inert; Escape closes |
| D02 | P1 | Mantine error/placeholder colours fail contrast; two focus-ring styles | E4-F1/F7/F10 | Map `--mantine-color-error`/placeholder to tokens; one 3 px `--focus` ring incl. inputs | axe clean on reject-empty state both themes |
| D03 | P2 | Review card says "validate" with no action; approve allowed while validating; confusing copy | E1-F2 E2-F3/F4 E3-03 | Validate button + last-run link in the warning; approve disabled while validating with reason | Button present; approve disabled while validating |
| D04 | P2 | Incident still "Awaiting review" after approval, nothing says so | E1-F1 | API exposes review decision per investigation; Approved pill + "Diagnosis approved, not closed yet" banner linking to closure | Banner + pill on approved incident |
| D05 | P2 | 320 px alerts clip content | E1-F5b E3-02 E4-F2 | Alert body min-width 0; buttons wrap | No clipped alert at 320 |
| D06 | P2 | Stale filter count announced; fast completion not announced | E2-F1 E4-F3/F4 | Announce after fresh data; status announcements queued not dropped | Correct count announced |
| D07 | P2 | Focus to body after cancel; confirm dialogs focus irreversible button | E4-F5/F6 E2-F6 | Focus cancelled alert; autofocus "Go back" | Focus on Go back on open |
| D08 | P2 | Validation page machine names, raw numbers, raw driver errors; requester recorded as "system" | E1-F3/F6 E2-F10/F13 E3-04 | checkLabel for invariants, metric labels, number formatting, refusal summary w/ raw toggle; requester recorded | Friendly labels; "by investigator" |
| D09 | P2 | Role value truncated | E2-F7 E1-F13 E3-05 E4-F8 | Width 184 desktop, no prefix on mobile | Full value visible |
| D10 | P3 | Queue time missing / "running" while queued; usage counters contradict | E1-F4 E2-F2/F8 E4-F13 | "Queued for N s"; "requested/queued for"; live tool-call counts | - |
| D11 | P3 | Long list without paging; pills wrap; stretched card; timeline link placement/self-link | E1-F5 E2-F11 E3-09/14/15 E4-F12/F15 | Show 25 + "Show more" keeping focus; nowrap pills; grid align start; link line; no self-link | - |
| D12 | P3 | Search: identical titles; glossary not deep-linked; Ctrl+K ignored in inputs | E1-F10/F12 E2-F12 E4-F14 | Dataset + opened time in results; `#/help?term=`; Ctrl+K in inputs, "/" not | - |
| D13 | P3 | Gallery drift (form field, badge gaps, title offset) | E1-F8 E3-07/08 E4 | Real Textarea; gaps; PageTitle | - |
| D14 | P3 | Copy: developer error text; viewer told to start; manual incident "Triggering checks"; empty state ignores status | E3-10/11 E1-F9 E2-F14 | Role-aware copy; retitle; both filters + separate clears | - |
| D15 | P3 | Misc: stale CTAs after decision; evidence hidden after cancel; chips only hashes; reject error lingers; chart svg role; health tile tint; mobile tabs scroll; heading bar only after SPA nav | E2-F5/F9 E1-F7/F11 E4-F11 E3-12/13/16 | CTA by review state; keep collected data; kind on chip; clear on approve; figcaption; tint fail/warn tiles; wrap tabs; no heading bar | - |

Deferred (justified): default list filter = unresolved (E1-F5/E3-15): the "all statuses" view must stay reachable from a
clean URL; paging + Health's unresolved link cover triage. Theme menu first-item focus (E4-F9 part): Mantine default,
arrow key reaches it; revisit if raised again.

## Selection for round 4
**N = all 15 (D01-D15).** Justification: two P1 accessibility defects and seven P2s cluster in the same few components
(shell, review card, validation page, list); every P3 is a small, low-risk change in those same files, and several were
reported independently by 2-4 evaluators. Verified by the acceptance script before R4.
