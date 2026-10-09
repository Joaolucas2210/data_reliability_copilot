# ADR-0005 — OpenLineage from dbt, file transport always, Marquez as optional reference backend

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The investigation needs to know which datasets feed the report and what ran in this execution. A lineage graph shows
**declared dependencies**. It does not show that an upstream dataset caused an incident. The brief asks for OpenLineage
(Job, Run, Dataset), dbt integration verified against current versions, and Marquez OSS as the reference backend,
without making a JVM service a hard dependency of every run.

## Alternatives

1. **Parse `manifest.json` dependencies ourselves.** No extra dependency, but it isn't OpenLineage. It is dbt-only and
   carries no run-level events.
2. **dbt-ol wrapper → HTTP to Marquez only.** The reference setup, but runs fail or lose lineage when Marquez (about 700 MB of JVM) isn't up.
3. **dbt-ol with a composite transport: file always + HTTP to Marquez when configured** (chosen).

## Decision

- `pipeline.run_dbt(..., lineage=True)` runs `dbt-ol run`. `pipeline.openlineage_config` writes a per-run
  `openlineage.yml` with `type: composite`, `continue_on_failure: true` and `continue_on_success: true`:
  - `file` → `var/runs/<run_id>/openlineage.jsonl` (always, so it becomes run evidence);
  - `http` → `DRC_MARQUEZ_URL` (only when set; `make up-lineage` starts Marquez 0.51.1 + web).
- Namespace `drc-local`. dbt models map to OpenLineage Jobs (`warehouse.<schema>.drc_finance.<model>`), each dbt
  invocation is a Run, and tables are Datasets (`warehouse.<schema>.<table>`).
- The agent reads lineage only through `tools.get_lineage`. It returns the **declared upstream** of a dataset from the run's
  COMPLETE events, with content labelled "declared upstream of …".
- Execution evidence comes from other tools: `get_check_results`, `read_run_log`, `get_ingestion_batches`,
  `count_duplicates`, `compare_control_totals`. The system prompt states that a lineage edge is a declared dependency, not a cause.

## Trade-offs

- The file transport duplicates what Marquez stores. In exchange, the evidence is immutable per run and doesn't depend on Marquez uptime.
- Only `dbt run` emits lineage. `dbt test` and freshness don't run through `dbt-ol`, so test runs aren't OpenLineage Runs yet.
- Ingestion (`synth.load`) emits no OpenLineage events. The raw tables appear only as inputs.

## Risks

- Elementary's own models also emit events (74 events in total for 6 project models + Elementary models). That adds noise in
  Marquez. `get_lineage` filters by output dataset, so the agent is unaffected.
- No column-level lineage, so a schema-drift diagnosis must rely on `get_schema`, not lineage.
- Composite transport with `continue_on_failure` hides Marquez outages. Lineage loss in Marquez is silent, apart from client logs.

## Evidence

- `dbt-ol run` (openlineage-dbt 1.53.0, dbt-core 1.12.5): "Emitted 74 OpenLineage events", dbt exit 0.
- COMPLETE events parsed in-session: `raw.payments → staging.stg_payments`; `stg_contracts, stg_installments, stg_payments → marts.fct_payments`; `fct_payments → rpt_daily_collections`.
- Marquez 0.51.1 on Postgres 17.11: `GET /api/v1/namespaces` answered after start.
- `openlineage.client.transport.composite.CompositeConfig` semantics read from the installed 1.53.0 source.
- Spec: https://openlineage.io/docs/spec/object-model ; dbt integration: https://openlineage.io/docs/integrations/dbt

## Revisit when

- Schema-drift scenarios (SCH-*) are implemented. Evaluate column-level lineage facets.
- Ingestion becomes a real job. Emit OpenLineage from it so raw datasets have producing runs.
- Marquez is used for incident triage by humans. Then make it a non-optional profile, with health alerts on lineage delivery.
