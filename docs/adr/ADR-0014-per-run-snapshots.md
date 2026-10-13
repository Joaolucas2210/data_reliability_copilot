# ADR-0014: Per-run warehouse snapshots and per-run project copies

- **Status:** Accepted (2026-10-09, phase 2).
- **Deciders:** project owner (Staff Engineer role)

## Context

Phase 1 tools read the *current* warehouse. Re-investigating an incident after a newer pipeline run therefore saw newer
data while labelling it with the incident's run id, observed in-session: a no-fault incident re-investigated after
the DUP-01 demo abstained because it saw DUP-01's duplicates. Evidence must describe the data the incident was detected
on. Separately, scenarios that change transformation code had to patch models somewhere, and recovery had to validate
against the code that actually produced the incident, not whatever is in the repo now.

## Alternatives

1. **Keep live reads and flag staleness** (phase-1 mitigation). Honest but useless for the investigation.
2. **Postgres time travel**: not available natively; would need temporal tables / audit triggers on every table.
3. **Schema per run for the whole pipeline** (raw/staging/marts built inside `run_<id>`). Cleanest isolation and enables
   concurrent runs, but changes the dbt layout, the reader grants and every model reference.
4. **Copy the run's relevant relations into `snap_<run_id>` after the run** (chosen) + **copy the dbt project into the run
   directory before the run** (chosen).
5. Object-store export (Parquet) per run. Good for the cloud path; adds a second engine to query it.

## Decision

- `pipeline.execute` copies `dbt/` into `var/runs/<run_id>/project` and runs dbt from there. Scenario patches touch only
  that copy. `pipeline_run.project_dir` records it.
- After dbt, `snapshot_run` creates `snap_<run_id>` with `CREATE TABLE AS` for every relation in `raw`, `ops`, `staging`,
  `marts` (tables named `<schema>__<table>`), one savepoint per relation. Unreadable relations (e.g. a view whose cast fails
  on drifted data, seen in SCH-02) are skipped and listed in the `pipeline_run.finished` audit event; the snapshot never
  fails the pipeline. `pipeline_run.snapshot_schema` records it.
- Tools resolve allow-listed datasets to the snapshot (`tools._rel`); evidence `source` is
  `warehouse:snap_<run_id>/<dataset>` and `version` is the snapshot schema. Runs without a snapshot fall back to live
  tables and the evidence says so explicitly.
- Recovery replays the incident: the sandbox is seeded from `snap_<run_id>` (raw + ops) and the playbook is applied on top
  of the run's project copy; the static check diffs against that copy.
- Model-change evidence compares against the **last known-good run** (succeeded, no failing/erroring checks), not the
  previous run, which may itself be broken.
- Retention (`drc prune`): keep the newest 20 snapshots and 30 days of run directories, never anything referenced by a
  non-terminal incident.

## Trade-offs

- Storage: one full copy of the small finance schemas per run (~13 k rows here). At production volumes this must become
  selective (only relations in the incident's lineage) or move to object storage.
- Snapshot happens *after* the run, so it captures the state the checks saw, not intermediate states.
- The copy is taken by `dbt_prod` (owner); readers get SELECT through default privileges.

## Risks

- Snapshot cost grows linearly with data; retention mitigates count, not size.
- Concurrent pipeline runs still share `raw`/`staging`/`marts` while running (alternative 3 would fix it).
- A relation skipped as unreadable makes some tools return errors for that incident (recorded, bounded).

## Evidence

- `test_evidence_reads_the_incident_runs_snapshot_not_current_state` (integration) passes.
- Phase-2 dev and final benchmark runs: all investigations read `snap_<run_id>`; the SCH-02 final run first **crashed the
  pipeline** in the snapshot step (unreadable view): fixed with per-relation savepoints, then re-run (policy unchanged).
- Recovery validation records `source: snap_<run>.raw__payments` per table with matching `count:md5`.

## Revisit when

- Any single snapshot exceeds ~1 GB or snapshot time exceeds 10 % of pipeline time → selective snapshot by lineage, or
  alternative 3/5.
- Concurrent pipeline runs are required → alternative 3.
- Cloud deployment → export snapshots to Blob/Parquet with the same retention rules.
