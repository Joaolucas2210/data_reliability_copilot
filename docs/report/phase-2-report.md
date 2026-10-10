# Phase 2 report — time-consistent evidence, 19 executable scenarios, operations

This is the historical phase-2 record. Follow-up fixes and new measurements are in the
[phase-3 report](phase-3-report.md); original negative results below are preserved.

Date: 2026-10-09. Starting point: `phase-1-report.md` backlog. Backlog item 1 (live-LLM evaluation) is still **blocked**:
no `ANTHROPIC_API_KEY` and no `ant` CLI in the environment. Everything below was done without a live model.

## 1. What changed

| Area | Change | Where |
|---|---|---|
| Evidence consistency | Each run copies the dbt project into its run dir and freezes `raw/ops/staging/marts` into `snap_<run_id>`; tools and recovery read the incident run's snapshot; model changes compare against the **last known-good** run | ADR-0014, `pipeline.py`, `tools.py`, `recovery.py` |
| Scenarios | 13 new executable scenarios (19 total: 10 dev / 9 final) incl. schema drift, delay, loss, bad joins, transformation changes, contradictions, multi-cause; composite injections; patches on the run's project copy | `scenarios.py`, `catalog.yaml` |
| Tools | `reconcile_ingestion_batches`, `check_referential_integrity`, `get_model_diff` (14 tools total) | `tools.py`, `docs/architecture/agent.md` |
| Detection | `model_run` check type; skipped contracted models no longer reported as contract failures | `quality.py`, migration `0002` |
| Agent | Round semantics bug fixed (last-round requests were dropped); cooperative cancellation | `agent.py` |
| Evaluation | Exact cause-set scoring; extra/missed causes; contradiction/refutation checks; clean baseline per eval; freeze rule for the fake policy | `evaluate.py`, ADR-0008 amendments |
| Operations | Job lease + heartbeat (20 s / 120 s) replacing the fixed 40-min lock; `drc cancel` + API; `drc prune` retention (snapshots, run dirs, checkpoints, span rotation) protecting open incidents | `worker.py`, `retention.py`, `api.py` |
| UI | `model_run` type; cancel button (non-viewers, queued/running) | `web/src/` |

## 2. Results (provider = fake; see caveat)

| System | Dev accuracy (10) | Final accuracy (9) | False-positive diagnoses dev/final | Extra / missed causes final |
|---|---|---|---|---|
| A rules | 0.50 | 0.556 | 2 / 1 | 4 / 3 |
| B summary-only | 0.50 | 0.556 | 2 / 1 | 4 / 3 |
| C agent + tools (`fake-v2`) | 1.00 | 1.00 | 0 / 0 | 0 / 0 |

C on final: 0 unsupported claims, citation precision 1.0, 2/2 recoveries validated (DUP-02, CON-02) with 0 invariant
violations, cosmetic-change hypothesis refuted in CON-02. Detection: dev 10/10; final 8/9 because of a **ground-truth
error** in SCH-02 (corrected afterwards, reported as it ran). Raw records: `docs/evidence/phase-2/`.

**Caveat (same as phase 1, sharper now):** `fake-v2` is a rule policy I wrote knowing the dev mechanism families. Its
held-out score shows the rules generalise to the final *variants* and that the machinery works end to end — not that an
LLM agent would. The baselines' ~0.5 shows the scenarios discriminate.

## 3. Verification

- `pytest`: 25 passed (13 unit, 12 integration) — new: composite injection guard, exact scoring, comment-only diffs,
  baseline A, snapshot evidence, cancel queued/running, heartbeat lease ownership, prune protection.
- ruff + mypy clean (20 source files); UI typecheck/build; Terraform unchanged.
- Freeze evidence: `fake_llm.py` sha256[:16] = `66a86a5855b34aee` recorded before the first final run and re-checked
  before the re-run (`docs/evidence/phase-2/fake-v2-freeze.txt`).

## 4. Negative results and defects found (kept)

1. **Dropped tool round (agent bug, phase 1 code):** a plan marked "ready to conclude" discarded its own tool requests;
   JOIN-01 abstained because its model diffs were never fetched. Fixed.
2. **Snapshot crashed the pipeline (phase 2 code):** the first final run aborted in SCH-02 — a view created fine but
   failed when read. Fixed with per-relation savepoints; run re-done with the same policy hash.
3. **Contract mis-attribution:** a contracted model skipped because upstream failed was recorded as a contract failure.
4. **Ground-truth error:** SCH-02 `detected_by` assumed the cast fails in staging; it fails in `fct_payments`.
5. **Incident merging by fingerprint:** LOSS-01 and TRF-01 (same failing checks, different causes) merged into one incident
   during an un-isolated probe. Documented as a known limit; the benchmark isolates scenarios.
6. **Metric-driven fake fixes on dev only:** CON-01 did not cite the contradiction (the policy only read WARN lines);
   DUP-01/JOIN-01 did not cite the failing dbt test. Both fixed on dev before freezing.

## 5. Consumption

Dev eval ~5:30 wall, final ~5:50 wall (each: baseline run + 9–10 scenarios × (pipeline + snapshot + A/B/C) + recoveries),
peak RSS ~285 MB. Pipeline runs 18–29 s (Marquez/Jaeger exporters off; phase-1 timings had them on, so this is not a
like-for-like speed-up). Fake investigations 0.5–1.0 s, 5–13 tool calls. Snapshots: ~13 k rows per run. LLM spend: US$ 0.

## 6. Status

| Item | Status |
|---|---|
| Time-consistent evidence (snapshots), recovery replaying the incident | Implemented, tested |
| 19 executable scenarios, exact scoring, freeze discipline | Implemented, run on dev and final |
| Cancellation, heartbeat lease, retention | Implemented, tested (heartbeat/prune via integration tests; no crash drill with a real killed worker) |
| Live-LLM evaluation | **Blocked** (credentials) |
| Groundedness judge | Pending (needs a live model) |
| DUP-03, MULTI-02, INS-03, NOF-03, INJ-01 | Specified; MULTI-02 and INS-03 need ground-truth redesign |
| Cloud (Entra ID, Blob artifacts/snapshots, first plan) | Pending |

## 7. Next steps

1. Live eval as soon as credentials exist: `DRC_LLM_PROVIDER=anthropic drc eval --split dev` (×5), compare to `fake-v2`
   and A/B; only then run final once.
2. Fingerprint that separates causes (affected dates / changed models), so incidents don't merge across causes.
3. Selective snapshots (lineage of the failing checks) before data grows; Blob/Parquet export for the cloud path.
4. Groundedness judge calibrated on human labels; INJ-01 with a docs tool.
5. Remaining scenarios (DUP-03 + playbook `dedupe_installments`, NOF-03 with history backfill, redesigned MULTI-02/INS-03).
6. Entra ID + Blob + first `terraform plan` on Azure dev.
