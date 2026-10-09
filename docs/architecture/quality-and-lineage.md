# Quality mechanisms and lineage

## Six distinct mechanisms (not interchangeable)

| Mechanism | Where | When it runs | What it can catch | What it cannot |
|---|---|---|---|---|
| **Schema contract** | `contract: {enforced: true}` on `fct_payments`, `rpt_daily_collections` (`dbt/models/marts/schema.yml`) | at build (`dbt run`); violation = model error | column names/types/not-null drift in the model output | wrong values with the right shape |
| **Data test** | dbt `unique`, `not_null`, `relationships` | after build (`dbt test`) | row-level rule violations (duplicates, orphans) | totals that are wrong but row-valid |
| **Freshness** | `sources.yml` `loaded_at_field: _loaded_at`, warn 26 h / error 48 h | `dbt source freshness` | late raw data | partial loads that are recent |
| **Business invariant** | `quality.INVARIANT_SQL` vs `ops.control_totals` (independent source) | after tests, read-only role | report ≠ system of record (count, amount, uniqueness) | the *cause* of the difference |
| **Model run** *(phase 2: own check type `model_run`)* | `run_results.json` of `dbt run` | at build | a model that fails to build (e.g. schema drift breaking a cast); a contracted model that is *skipped* is recorded as `skipped`, not as a contract failure | why it failed |
| **Anomaly (Elementary OSS)** | `elementary.volume_anomalies` on `raw.payments` | `dbt test` | volume shifts vs history | anything, until history exists |

Detection is rules-only; the agent never decides that an incident exists (ADR-0004).
In DUP-01 four independent checks fire (dbt `unique_fct_payments_payment_id`, `inv_payment_id_unique`,
`inv_reconciliation_amount`, `inv_reconciliation_count`) while contracts and freshness pass — "pipeline succeeded,
report wrong". In INS-01 **only** the reconciliation invariant fires.

## Elementary: what is used and what is OSS

Used: the `elementary-data/elementary` **dbt package 0.26.0** (OSS) — its on-run hooks store run/test results in
the `elementary` schema, and its anomaly test. Installed but not used for alerting: the `edr` CLI
(`elementary-data==0.26.0`, OSS). **Not used:** any Elementary Cloud (commercial) feature.
Finding: `volume_anomalies` reported **PASS with one day of history** — it has nothing to compare against,
so in this phase it is configured, not effective. Cost: its hooks add ~1.4 s to each dbt invocation (observed).
Revisit: after ≥14 daily loads exist (needs a backfill scenario), or drop it if it adds no signal over invariants.

## Lineage (OpenLineage → file + Marquez)

- Emitted by `dbt-ol` (openlineage-dbt 1.53.0) wrapping `dbt run`; verified on dbt-core 1.12.5 (74 events).
- Transport (`pipeline.openlineage_config`): `composite` with `continue_on_failure: true` → always a file
  `var/runs/<run_id>/openlineage.jsonl`; plus HTTP to Marquez 0.51.1 when `DRC_MARQUEZ_URL` is set
  (`make up-lineage`).
- Mapping: dbt model → OL **Job** (`warehouse.<schema>.drc_finance.<model>`), each invocation → **Run** (UUID),
  tables → **Datasets** (`warehouse.<schema>.<table>`, namespace `postgres://host:port`).

**Declared vs execution evidence.** A lineage edge says *B is built from A*. It does not say A was wrong, nor
that the incident propagated. The agent prompt states this; `get_lineage` labels its output "declared upstream";
causal claims must cite execution evidence (test results, row counts, logs, control totals). In the fake policy
lineage is collected but never cited as a fact.

Limitations: Elementary's own models also emit OL events (noise in Marquez); no column-level lineage;
`Dataset` table in the app DB is not yet populated from events (lineage is read from the run's event file).
