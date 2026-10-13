# ADR-0008: Ground-truth benchmark with deterministic scoring; A/B/C comparison; MLflow tracking

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

Without ground truth, claims like "the agent diagnoses correctly" or "tools help" can't be checked. The brief asks for at
least 20 scenarios with seed, injection, expected result, evidence, invariants and cleanup. Three must be fully implemented.
It also asks for separate dev/final splits, no answer leakage to the agent, and a comparison of rules (A), summary-only LLM (B)
and agent with tools (C). Deterministic checks are preferred, with LLM-as-judge only as a complement.

## Alternatives

1. **LLM-as-judge on free-text diagnoses.** Covers nuance, but adds a second model's errors, cost and bias, and is hard to reproduce.
2. **Human grading.** Accurate but slow, and impossible in CI.
3. **Structured outputs scored deterministically against a catalog** (chosen). LLM-as-judge is deferred to statement→quote entailment, where determinism can't reach.

## Decision

- `benchmark/scenarios/catalog.yaml`: 24 scenarios (duplication, schema drift, delay, loss, bad join, transformation change,
  multi-cause, insufficient evidence, contradictory evidence, no-fault, prompt injection). 6 are `implemented: true`: DUP-01/02,
  INS-01/02 and NOF-01/02, across 3 mechanisms. The rest are specified with an injection name and expected result.
- Ground truth stays out of the agent's reach. Tools read only the warehouse, run artifacts, logs and lineage. Batch tags are neutral (`L<timestamp>`).
  The API hides `pipeline_run.scenario_id`, and a test asserts that evidence contains no scenario labels.
- `evaluate.run_scenario` runs one pipeline and one detection per scenario, then all three systems on the same incident:
  - A `rules_baseline`: canned diagnosis from failing-check names;
  - B `summary_only`: the LLM gets only check names, no evidence or tools;
  - C: the full agent; if a proposal exists, `recovery.validate`.
- Deterministic metrics per system: diagnosis accuracy (outcome + cause category), unsupported claims, citation precision,
  quote-support rate, appropriate abstention, false-positive diagnoses, latency, LLM calls, tokens, cost (`None` when unknown, never 0),
  valid recoveries, invariant violations after recovery, injected instruction followed. Detection metrics: `detected_all_rate`, rule false positives.
- Results go to `var/eval/*.json`, the `eval_run` table (API `/api/evaluations/latest`) and MLflow (`sqlite:///var/mlflow.db`, experiment
  `drc-benchmark`, artifacts in `var/mlartifacts`). Params include provider, model, prompt version and split.
- With `provider=fake`, B and C results measure the harness and a hand-written policy, **not** an LLM. Every summary carries this caveat.

## Trade-offs

- Exact-match scoring is brittle with free text, which is why the scored fields (outcome, cause_category, ids) are structured.
- Running pipelines per scenario makes evaluation slow (about 2 min per split of 3 scenarios) but realistic.

## Risks

- **The final split is weak.** Final scenarios are seed variants of the same three mechanisms, so they test robustness to data
  variation, not generalisation to new failure types. Fix: implement the specified final-only scenarios (SCH-02, LAT-02, JOIN-02, …).
- **Overfitting the fake policy.** Its rules were written knowing the dev scenarios, so C=1.0 in fake mode is by construction.
- Running B and C on the same incident shares state, though both are read-only toward evidence.

## Evidence

- `drc eval --split dev` and `--split final` (fake, 2026-10-09): detection `detected_all_rate 1.0`, rule FP 0. A and B: accuracy 0.667
  and 1 false-positive diagnosis each (both "diagnose" INS, which should abstain). C: accuracy 1.0, citation precision 1.0, 1/1 recovery
  valid, cost `unknown`. **C's number reflects the fake policy.**
- `tests/test_unit.py::test_catalog_has_20_plus_scenarios_with_required_fields`.
- MLflow tracking with SQLite: https://mlflow.org/docs/latest/ml/tracking/backend-stores/

## Phase 2 amendments (2026-10-09)

- 19 executable scenarios (10 dev / 9 final); final = held-out *variants* of the dev mechanism families.
- **Exact cause-set scoring** (extra or missing causes are wrong) replaces subset scoring, which let a diagnosis with an
  extra wrong cause count as correct.
- Each eval starts from a clean baseline run; open incidents are dismissed between scenarios.
- **Freeze rule:** fake-policy changes only after dev runs; policy file hash recorded before the first final run and
  re-checked before any re-run. A final re-run is allowed only for harness/pipeline fixes, and is reported as such
  (the first phase-2 final run crashed in the snapshot step; re-run with the same policy hash).
- **Ground-truth corrections** after a final run are made in the catalog with a dated note; the affected number is
  reported as it ran (SCH-02 `detected_by`).

## Revisit when

- Credentials are available. Run live C and B on both splits, record model, effort and prompt version, and report cost per scenario.
- Live unsupported-claim analysis shows quote-supported facts whose statement doesn't follow. Then add an LLM-as-judge entailment check,
  calibrated against at least 50 human-labelled facts, with its agreement rate reported.
- At least 10 implemented scenarios exist. Freeze the final split and stop running it during prompt iteration.

## Phase 3 amendment: optional fact judge

`judge.py` implements the [judge-v1 rubric](../benchmark/judge-rubric.md): supported, weakly_supported,
unsupported, not_applicable per observed fact plus overall/rationale/model/prompt. Enabled for live;
fake defaults off, `DRC_JUDGE=1` exercises conservative literal structural checks in CI without keys.
Citation enforcement remains authoritative: missing IDs and invalid quotes cannot receive support;
citation-rejected facts remain zeroes in the denominator. Empty facts have null groundedness.

Results persist with C's eval artifact and DB row; MLflow receives numeric aggregates and prompt version.
Judge token/cost/latency usage is recorded separately from investigation usage; unknown cost is null.
No decisions, tools or remediation permissions change. Exact cause-set scoring remains the source of truth.
This measures fact entailment only, not every diagnosis sentence, hypothesis or production safety.
Same-model bias, prompt injection and uncalibrated judge errors remain risks. Calibrate on at least 50
human-labelled live dev facts (two reviewers + adjudication) before interpreting scores as quality.
LIVE and calibration are not run; FAKE structural scores are not semantic measurements.
