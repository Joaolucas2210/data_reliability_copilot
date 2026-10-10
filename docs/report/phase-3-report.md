# Phase 3 report — portfolio packaging, signatures and evaluation boundaries

Date: 2026-10-10. Provider: **FAKE only** (`fake-v2`, unchanged hash `66a86a5855b34aee`).
LIVE investigation, semantic judge quality and human calibration: **not run — blocked on credentials**.
No production remediation or cloud apply was performed.

## Changes

- README problem/principle/stack/results tables, existing architecture link, CI badges, phase status;
  GitHub metadata suggestions and a 3–4 minute demo script matching the existing CLI/UI.
- Incident fingerprint v2: sorted failing checks, run-local model code checksums and snapshot discrepancy
  dates. Unknown signals isolate the run; original run linkage preserves retries after recurrence.
  LOSS-01 and TRF-01 no longer merge in the same-app-DB regression. ADR-0016 records limits.
- Optional evaluation-only fact judge: strict LIVE rubric via the existing adapter, conservative FAKE
  literal/structural path, fail-closed citations, null scores for absent facts, separate usage/cost.
  Enabled for live, off for fake unless `DRC_JUDGE=1`; JSON/DB artifacts and MLflow retain results.
  ADR-0008 and agent docs distinguish quotation checks from entailment.
- Live dev×5 / choose / final-once checklist, two medium-effort candidates and a results template.
  Provider/credential preflight happens before benchmark state mutation. No API success is claimed.
- The five pending scenarios are explicitly non-executable with reasons; no executable ground truth or
  fake policy was changed. DUP-03 requires another invariant/playbook; MULTI-02/INS-03 need redesign;
  NOF-03 needs historical training data; INJ-01 needs a bounded description tool.
- Operational tests now directly exercise lost lease ownership and isolation refusal + cleanup,
  in addition to fake judge wiring and fingerprint separation. Recovery implementation is unchanged.

## Validations and results

| Command / check | Result |
|---|---|
| `make setup` | Pinned dependencies installed; runtime selected by uv was Python 3.12.13. Initial attempt needed sandbox approval for uv cache/network. |
| `make demo` | FAKE diagnosed; 5/5 facts passed citations; recovery passed; one UI URL plus investigation ID printed. No CLI rewrite needed. |
| Activated pytest, fingerprint + idempotency regression | 2 passed; equal failing-check sets for LOSS/TRF, distinct incidents, stable replay IDs. |
| `make test-unit` | 19 passed (fake score extremes, absent evidence, empty facts, LIVE stub fail-closed, provider preflight). |
| `make check` | Passed: ruff, mypy (21 source files), unit tests, UI typecheck/build/contrast, fmt + validate for all six Terraform roots. No plan/apply. |
| `DRC_LLM_PROVIDER=fake DRC_JUDGE=1 make eval` | Passed, dev once, 10 scenarios. |
| `DRC_LLM_PROVIDER=fake DRC_JUDGE=1 make eval-final` | Passed, final **once**, 9 scenarios; no re-run or tuning. |
| `make test` | **35 passed**: 19 unit + 16 integration; no skips. |
| MLflow SQLite inspection | `groundedness` and `judge_runs` persisted; per-fact judge results are present in artifacts. |
| Hash verification / `git diff --check` / doc links | Passed; policy, prompts and catalog stayed frozen across both splits. |

| System / metric | FAKE dev | FAKE final | LIVE |
|---|---|---|---|
| A exact outcome + cause-set accuracy | 0.50 | 0.556 | not run |
| B summary-only accuracy | 0.50 | 0.556 | not run |
| C agent + tools accuracy | 1.00 | 1.00 | not run |
| Detection all expected checks | 10/10 | 9/9 | not run |
| C citation precision / citation-rejected facts | 1.0 / 0 | 1.0 / 0 | not run |
| C recovery valid / attempted | 1/1 | 2/2 | not run |
| C invariant violations after recovery | 0 | 0 | not run |
| C structural FAKE groundedness | **0.0** | **0.0** | semantic judge not run |

Evidence: [measurement manifest](../evidence/phase-3/RUNS.md), unmodified JSONs and SHA-256 manifests in
`docs/evidence/phase-3/`. All proposed recoveries recorded successful isolation checks. Null FAKE
model/judge costs carry per-call `cost_status=unknown`; no zero model bill is invented.

## Negative results kept

- The structural judge rejects the fake policy's paraphrases. Its 0.0 score is kept: it establishes
  conservative literal behavior, not semantic failure or semantic measurement. Citation precision 1.0
  cannot be used to erase that difference. Empty diagnoses have null groundedness.
- A/B still falsely diagnose insufficient/contradictory evidence (dev 2, final 1 false-positive diagnosis).
  C's perfect FAKE accuracy remains a policy/harness result on held-out variants, not LLM generalization.
- Phase 2's original 8/9 detection result and fingerprint collision remain in its historical report.
  The new 9/9 uses its already documented SCH-02 correction; historical artifacts were not overwritten.
- Initial direct pytest invocation lacked the activated venv's `dbt-ol` on PATH; rerunning with activation
  passed. Two new judge test fixtures initially omitted required `hypotheses`; fixtures were corrected.
- UI build succeeds with Mantine module-directive and large-chunk warnings. Terraform init generated
  platform hash additions; those unrelated lockfile edits were restored after successful validation.

## Operational coverage and limits

Integration tests cover separate-role isolation and read-only production, refusal before snapshot and
sandbox cleanup, checkpoint resume/tool replay, detection idempotency, queued/running cancellation,
lease renewal and stopping after ownership changes, retention protecting open incidents, and reading
incident snapshots (ADR-0014). They do not simulate killing a real worker or restoring a cloud backup.

Fingerprinting is an observed signature, not a cause oracle: identical dates/code/checks can still merge
upstream mechanisms, and comment changes can over-split. Pipeline concurrency remains unsupported.
The semantic judge has same-model bias and is uncalibrated; label >=50 live dev facts with two humans
and adjudication before trusting scores. Injection detection is a narrow no-fault outcome proxy;
INJ-01 approval-injection coverage is absent. Local header roles still block cloud exposure.
Sandbox DBs share server CPU/IO. Elementary is configured but its short history is weak; selective
snapshots remain a scaling TODO. Terraform is static validation only; no cloud resources were applied.
No browser walkthrough/axe run was added in this phase; demo flow was checked against UI source and
real CLI output, and UI compilation/contrast checks passed.

## Five Staff interview talking points

1. Define authority boundaries: rules detect, a bounded agent proposes, humans decide; approval never applies production SQL.
2. Separate evidence existence, literal quotation, entailment and causal correctness; make each measurable with explicit limits.
3. Treat recovery as a reproducible experiment on frozen data/code, with narrow credentials and fail-closed isolation.
4. Preserve negative results and freeze policies; report FAKE/LIVE separately and choose models on dev before final once.
5. Prefer a modular monolith and Postgres worker with replay, cancellation, leases and retention until scale proves a larger system necessary.

## Files changed

Code/tests: `src/drc/quality.py`, `src/drc/judge.py`, `src/drc/evaluate.py`,
`tests/test_unit.py`, `tests/test_integration.py`.

Documentation: `README.md`, `docs/product/github-about.md`, `docs/demo/SCRIPT.md`,
`docs/architecture/overview.md`, `docs/architecture/reliability.md`, `docs/architecture/agent.md`, `docs/adr/README.md`,
`docs/adr/ADR-0016-incident-fingerprint.md`, `docs/adr/ADR-0008-evaluation.md`,
`docs/benchmark/judge-rubric.md`, `docs/benchmark/live-eval-checklist.md`,
`docs/evidence/live/RESULTS_TEMPLATE.md`, `docs/report/phase-2-report.md`, this report.

Catalog/evidence: `benchmark/scenarios/catalog.yaml`, `docs/evidence/phase-3/RUNS.md`,
`docs/evidence/phase-3/freeze.sha256`, `docs/evidence/phase-3/artifacts.sha256`,
`docs/evidence/phase-3/eval-dev-fake-20261010T162433.json`,
`docs/evidence/phase-3/eval-final-fake-20261010T164229.json`.
