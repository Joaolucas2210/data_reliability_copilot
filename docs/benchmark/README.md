# Benchmark

Catalog (ground truth): `benchmark/scenarios/catalog.yaml`: **24 scenarios, 19 executable** (10 dev, 9 final), 5 specified.
Harness: `src/drc/evaluate.py` (`drc eval --split dev|final|all [--provider fake|anthropic]`). Decision: ADR-0008.

## Coverage

| Class | Dev (tuning allowed) | Final (held out) | Specified only |
|---|---|---|---|
| Duplication | DUP-01 | DUP-02 | DUP-03 |
| Schema drift | SCH-01 (column renamed) | SCH-02 (amount delivered as pt-BR text) | - |
| Delay | LAT-01 (job silent ~50 h, freshness error) | LAT-02 (latest day cut off early) | - |
| Record loss | LOSS-01 (loader drops rows) | LOSS-02 (contracts missing → inner joins drop payments) | - |
| Incorrect join | JOIN-01 (fan-out join) | JOIN-02 (join gains a filter) | - |
| Transformation change | TRF-01 (business date → week) | TRF-02 (amount rounded) | - |
| Multiple causes | MULTI-01 (duplication + partial day) | - | MULTI-02 (needs redesign, see note) |
| Insufficient evidence | INS-01 | INS-02 | INS-03 (ground truth ambiguous, see note) |
| Contradictory evidence | CON-01 (log claims a retry the data doesn't show) | CON-02 (cosmetic code change + real duplication) | - |
| No failure | NOF-01 | NOF-02 | NOF-03 (needs anomaly history) |
| Prompt injection | planted line in DUP-01/02 logs | - | INJ-01 (needs a docs tool + live LLM) |

Final scenarios are **different variants of the dev mechanism families** (not just new seeds, except DUP/INS/NOF-02).
They test generalisation across variants, not to unseen failure classes.

## Methodology

- Each eval starts with a clean baseline run (must produce no incident) so "last known-good run" exists, then dismisses
  open incidents before each scenario (no cross-scenario incident merging).
- Each scenario: seeded load → injection (data, logs, ingestion metadata, or a patch on the run's own dbt project copy) →
  dbt → per-run snapshot → detection → systems A/B/C on the same incident → recovery validation if proposed.
- **Correct** = expected outcome AND, when diagnosed, the **exact** set of supported causes (an extra wrong cause is
  wrong; `extra_causes` / `missed_causes` are reported separately).
- Also scored: abstention when expected, contradiction cited (CON-01), expected refutation made (CON-02), required
  evidence kinds cited, missing information named, citation existence/quote support, recovery validity, invariants after.
- **Fake-policy discipline:** rules were changed only after dev runs; the policy file hash was recorded before the first
  final run (`docs/evidence/phase-2/fake-v2-freeze.txt`) and verified unchanged before the final re-run.

## Results: phase 2, provider = fake (2026-10-09)

| System | Split | Accuracy | False-positive diagnoses | Abstention when expected | Extra / missed causes | Unsupported claims | Citation precision | Recovery valid |
|---|---|---|---|---|---|---|---|---|
| A rules | dev (10) | 0.50 | 2 | 0 / 2 | 4 / 3 | n/a | n/a | n/a |
| B summary-only | dev (10) | 0.50 | 2 | 0 / 2 | 4 / 3 | n/a | n/a | n/a |
| C agent + tools | dev (10) | 1.00 | 0 | 2 / 2 | 0 / 0 | 0 | 1.0 | 1 / 1 |
| A rules | final (9) | 0.556 | 1 | 0 / 1 | 4 / 3 | n/a | n/a | n/a |
| B summary-only | final (9) | 0.556 | 1 | 0 / 1 | 4 / 3 | n/a | n/a | n/a |
| C agent + tools | final (9) | 1.00 | 0 | 1 / 1 | 0 / 0 | 0 | 1.0 | 2 / 2 |

Detection: dev 10/10 expected checks fired; final 8/9, **SCH-02 is a ground-truth error**, not a detection miss: the
catalog said `model_error_stg_payments`, but Postgres creates the view without evaluating the cast, so the error surfaces
in `fct_payments`. Corrected in the catalog with a dated note; the number above is reported as it ran.

Where A/B fail and why: they map check names to causes, so any scenario where only the reconciliations fail becomes
"record_loss" (wrong for INS, LAT-02, JOIN-02, TRF-02, CON-01), a fan-out join looks like "duplication" (JOIN-01), and
they can never abstain or name two causes (MULTI-01).

## How to read C's 100 %

C here is `fake-v2`, rules I wrote **knowing the dev mechanism families**; its held-out score shows the rules generalise
to the final variants and that tools, snapshots, citation checks and recovery work end to end. It is **not** evidence
that an LLM agent would do this. What the benchmark now does show: the scenarios discriminate (A/B ≈ 0.5), the metrics
caught real defects during development (missing contradiction citation in CON-01, uncited failing tests, a dropped tool
round), and the harness is ready for a live-model run.

## Limitations

- No live-model run (no credentials). No repetitions/variance (needed for live models: ≥5 per scenario).
- Groundedness = existence + verbatim quote; semantic support of statements is not scored (judge planned, ADR-0008).
- Final split shares mechanism families with dev.
- Prompt-injection metric is only meaningful with a live model.
- Pending: DUP-03, MULTI-02 (redesign), INS-03 (re-specify ground truth), NOF-03 (needs ≥14 days of history), INJ-01.
