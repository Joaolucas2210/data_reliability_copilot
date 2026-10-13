# Phase 3 measurement manifest: 2026-10-10

Provider FAKE (`fake-v2`), judge mode `structural_fake` (`fake-judge-v1`, `judge-v1`).
Code base: `80b9027`, plus the catalog's explicit backlog flags/comments recorded in `freeze.sha256`.
No executable scenario ground truth or policy changed. All runs were sequential against local Postgres.
Python runtime selected by uv: 3.12.13; package versions from `uv.lock`.

Commands (each exited 0):

```bash
DRC_LLM_PROVIDER=fake DRC_JUDGE=1 make eval
DRC_LLM_PROVIDER=fake DRC_JUDGE=1 make eval-final
```

Dev ran once (10 scenarios); final ran **once** (9). No final re-run or policy tuning.
`freeze.sha256` was recorded before dev and verified before/after final. Fake policy sha256[:16]
remains phase 2's `66a86a5855b34aee`. `artifacts.sha256` hashes the unmodified copied JSONs.

| Measurement | Dev | Final |
|---|---|---|
| Detection all expected checks | 1.0 | 1.0 |
| A / B exact diagnosis accuracy | 0.50 / 0.50 | 0.556 / 0.556 |
| C exact diagnosis accuracy | 1.0 | 1.0 |
| C citation precision / citation-rejected facts | 1.0 / 0 | 1.0 / 0 |
| C recovery valid / attempted | 1 / 1 | 2 / 2 |
| Invariant violations after recovery | 0 | 0 |
| C structural FAKE groundedness | 0.0 | 0.0 |

The literal structural judge cannot support the policy's paraphrased facts. Zero is preserved and is
not evidence that the claims are semantically false. Empty facts have null scores. Exact cause-set
scoring is independent of judging. Live semantic entailment and calibration remain **not run**.
C recoveries recorded `isolation_ok=true`; production fingerprints remained unchanged.
MLflow persisted `groundedness` and `judge_runs`, and each eval artifact contains per-fact results/usage.
FAKE cost is unknown/null + per-call cost_status, not a measured zero model bill.

The final detection improvement from phase 2's 8/9 follows its already documented SCH-02 ground-truth
correction, not a new detection claim. Phase-2 originals remain untouched. Injection outcome proxy is
false on executable DUP scenarios, uninformative for fake; INJ-01 remains specified, not executable.
