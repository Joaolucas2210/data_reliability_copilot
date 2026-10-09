# ADR-0004 — Rules detect, the agent investigates; five distinct quality mechanisms

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The core incident is "the pipeline succeeded but the report is wrong". If an LLM decided whether an incident exists,
detection would become non-deterministic, costly and hard to audit. The brief also asks that schema contracts, data tests
and freshness are **not** treated as equivalent. They fail differently, at different times, for different reasons.

## Alternatives

1. **LLM triage of every run.** Flexible, but you can't reproduce why something was or wasn't flagged, and it costs money on every run.
2. **dbt tests only.** Simple, but row-level tests miss cross-system facts. A report can be internally consistent
   (unique dates, non-null amounts) and still disagree with the bank.
3. **Several deterministic mechanisms, recorded with a distinct `check_type`** (chosen).

## Decision

`quality.collect_checks` records each result in `quality_check_result` with one of these `check_type` values:

| check_type | Mechanism | When it fails | Example |
|---|---|---|---|
| `schema_contract` | dbt model contracts (`contract: {enforced: true}`) | at build time; the model errors | `contract_fct_payments` |
| `data_test` | dbt data tests on built models | after build, row-level | `unique_fct_payments_payment_id` |
| `freshness` | `dbt source freshness` (`_loaded_at`, warn 26h / error 48h) | raw data too old | `freshness_raw_payments` |
| `invariant` | Python SQL (`INVARIANT_SQL`) run by read-only `copilot_reader`, against `ops.control_totals` | report disagrees with an independent control | `inv_reconciliation_amount` |
| `anomaly` | Elementary OSS dbt tests (`elementary.volume_anomalies`, severity warn) | statistical deviation vs history | `elementary_source_volume_anomalies_raw_payments…` |

- Pipeline status `succeeded` means transformations ran. Failing tests and invariants are quality signals, not pipeline failures.
- `quality.detect` opens an incident if any check is `fail`/`error`. The fingerprint is the pipeline plus the sorted failing
  check names. A partial unique index allows at most one non-terminal incident per fingerprint. A repeated detection
  updates `occurrences`, and re-detecting the same run is a no-op.
- Human-reported suspicions (`report_manual`) create `manual:` incidents. They are still incidents, but no rule fired.
- The agent never changes check results or decides whether an incident exists (ADR-0006).

### Elementary: OSS vs commercial

We use only the **Elementary dbt package** (Apache-2.0): its anomaly tests and the run-result tables populated by its
on-run-end hooks in schema `elementary`. The `edr` CLI comes with `elementary-data` but is **not** used (no reports,
no Slack/Teams alerts). Elementary Cloud features are **not** used and not relied upon: hosted alerting/incident
management, the column-level lineage UI, catalog and AI agents. If we ever do, it needs a new ADR.

## Trade-offs

- Invariants are custom Python/SQL, not dbt tests. That keeps them outside dbt's pass/fail and lets them run unchanged
  against the sandbox (ADR-0007). The cost is one more mechanism to maintain.
- The fingerprint is coarse. Two unrelated failures in one run become one incident (`ponytail:` note in `quality.py`).

## Risks

- **Anomaly detection is not detecting anything yet.** `volume_anomalies` returned PASS with a single day of history:
  there is no training window, so the PASS carries no information. It stays at warn severity and is excluded from claims until it has more than 14 days of history.
- Elementary's on-run-start/end hooks add about 1.3–1.4 s per dbt invocation (observed "OK hook … in 1.40s"/"1.34s"). That is acceptable now, but it multiplies across sandbox runs.
- Control totals come from our generator (ADR-0003), so they are not truly independent.

## Evidence

- DUP-01 run: `unique_fct_payments_payment_id` fail (14), `inv_payment_id_unique` fail (14), `inv_reconciliation_amount` and
  `inv_reconciliation_count` fail (1 date each). Contracts, freshness and the other tests pass. One incident was opened.
- INS scenarios: only `inv_reconciliation_amount`/`_count` fire. No dbt test fails, which shows why invariants exist.
- `make eval`: `detected_all_rate = 1.0`, `rule_false_positives = 0` on dev and final (3+3 implemented scenarios).
- Elementary OSS docs: https://docs.elementary-data.com/oss/oss-introduction ; package: https://hub.getdbt.com/elementary-data/elementary/latest/

## Revisit when

- Anomaly tests have more than 14 daily buckets of history. Then measure their false-positive rate (NOF-03 scenario).
- Incidents with unrelated causes get merged by the fingerprint in practice. Switch to per-dataset grouping.
- Invariants exceed about 10. Consider moving them into dbt singular tests with a separate tag, while keeping the separate `check_type`.
