# ADR-0003 — PostgreSQL + dbt Core on deterministic synthetic finance data

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The product must reproduce incidents where "the pipeline succeeds but the report is wrong" in a fictional
consumer-finance operation (customers, contracts, installments, payments). Benchmarks need the same data for the
same seed, while freshness checks need realistic load timestamps. The brief names PostgreSQL + dbt Core and
mentions DuckDB as a possible later profile.

## Alternatives

1. **Postgres only** (chosen). One engine for the warehouse, app state, checkpoints, Marquez and MLflow (as separate databases).
2. **Postgres + DuckDB profile now.** Faster local runs and no server, but every check and invariant would have to be
   proven equivalent on both engines (types, numeric rounding, `distinct on`, timestamps). That doubles the test surface before the first result exists.
3. **Static CSV fixtures** instead of a generator. Easy to read, but scenarios need many variants (seeds, dates), and fixtures don't scale to 24 scenarios.

## Decision

- Database `warehouse` on PostgreSQL 17.11. Schemas: `raw`, `ops` (ingestion batches, control totals), `staging`, `marts`,
  `elementary`. `generate_schema_name` uses the custom schema name verbatim.
- dbt project `dbt/` (`drc_finance`). Staging views `stg_*`; marts tables `fct_payments` and `rpt_daily_collections` (the
  "business report"). `stg_payments` deliberately does **not** deduplicate, which is what the DUP scenarios exercise.
- `synth.generate(seed)` uses Faker (`pt_BR`) + `random.Random(seed)`. Business columns depend only on the seed (business
  date fixed at `AS_OF = 2026-09-30`). `_loaded_at` is the real load time, so freshness is meaningful. Payments
  load in one batch per business date, and each load writes a JSONL ingestion log.
- `ops.control_totals` is derived from the generated payments **before** any injection. It plays the role of an independent
  core-banking control total for reconciliation.
- DuckDB is **deferred**.

## Trade-offs

- `_loaded_at` makes full-table hashes differ between runs. Determinism holds for business columns, not load metadata
  (checked: `generate(42).payments == generate(42).payments`).
- Every run rebuilds `raw`/`ops` from scratch (`drop schema … cascade`). Simple and reproducible, but there is no incremental-load behaviour to test yet.
- The dataset is small (400 customers, 600 contracts, 9,120 installments, ~2,946 payments for seed 42). That's fast, but not a performance test.

## Risks

- Synthetic data can make problems look easy. Mitigation: the INS scenarios deliberately leave no explaining evidence.
- Control totals come from the same generator, so they are not truly independent of the injected loss. That's acceptable for a benchmark, but it must not be presented as a real reconciliation design.

## Evidence

- `dbt run` / `dbt test` / `dbt source freshness` succeed on seed 42 (ADR-0001 evidence).
- DUP-01 injection: 14 rows of a daily batch re-inserted. Afterwards `rpt_daily_collections` shows `payments_count=28 control=14` for 2026-09-28.
- Code: `src/drc/synth.py`, `src/drc/scenarios.py`, `dbt/models/`.

## Revisit when (DuckDB profile)

Introduce DuckDB only when **all** of these hold:
1. There is a concrete user of it (offline demo without Docker, or CI time for `make eval` over 10 min).
2. A behaviour-difference test suite runs every invariant, dbt test and benchmark scenario on both engines and diffs the results.
3. The differences found are documented (numeric(16,2) sums, timestamp/timezone casts, `md5`/`string_agg` used in snapshots).
