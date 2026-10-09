# ADR-0010 — Python CLI + Make + Docker Compose; Postgres job queue; no orchestrator yet

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The slice runs one daily-style pipeline, investigations, and sandbox validations. The brief excludes Airflow and Spark in this
phase, and allows Prefect only for a documented need. Background work must survive process crashes with bounded retries.

## Alternatives

1. **Airflow / Dagster / Prefect now.** Scheduling, UI, retries and asset lineage, but another service, metadata DB and deployment
   model to run before the first result. Their benefits (many DAGs, schedules, backfills, SLAs) don't apply to one pipeline.
2. **Celery/RQ + Redis** for background jobs. A mature worker model, but an extra broker to run and secure.
3. **`drc` CLI (argparse) + Makefile + Compose; Postgres `job` table worker** (chosen).

## Decision

- `drc` subcommands: `migrate, reset, pipeline, investigate, review, validate, eval, demo, worker, gc, api`. `make` wraps them (`make demo`, `make eval`, `make check`).
- The pipeline is a plain function sequence (`pipeline.execute`): load + inject, `dbt-ol run`, `dbt test` (only if the run succeeded),
  `dbt source freshness`, then `quality.detect`. `--idempotency-key` makes a repeated invocation return the existing run.
- The worker (`worker.py`) claims jobs with `FOR UPDATE SKIP LOCKED`. A job is retried up to `max_attempts` (default 2) with a 10 s backoff.
  A job whose lease (renewed every 20 s by a heartbeat thread) is older than 120 s is reclaimable after a worker crash. Handlers are resumable: LangGraph checkpoints plus
  idempotent tools for investigations, and a fresh sandbox per attempt (plus gc) for validations. A final failure moves the investigation to `failed` and the incident back to `open`.
- Compose profiles control resources (ADR-0009).

## Trade-offs

- No scheduler: runs are triggered manually or by CI. No backfill UI.
- No job cancellation endpoint yet. Cancelling means setting the investigation's status to `cancelled`, which is allowed by transitions but not exposed.

## Risks

- A polling worker is single-threaded per process. Long validations block other jobs on that worker, so run more workers.
- Phase 2 replaced the fixed 40-min lock with a heartbeat-renewed lease (20 s / 120 s). A worker that stalls without dying (e.g. a hung dbt subprocess) keeps renewing; the dbt 300 s timeout bounds that case.
  Mitigated by a fresh sandbox per attempt, but it would waste compute. (Noted for tuning.)

## Evidence

- `make demo` runs end to end. `drc eval` runs 3 scenarios per split in about 2 min.
- The resume test proves the worker contract for investigations (`tests/test_integration.py`).

## Revisit when (criteria to adopt an orchestrator)

- At least 3 scheduled pipelines with dependencies between them, or a need for backfills over date ranges. Evaluate Dagster (asset model fits dbt)
  and Airflow (team familiarity, Astronomer/managed options) against concrete requirements.
- More than about 50 jobs/min, or a need for priorities, rate limits per provider, or cancellation propagation. Consider a dedicated queue.
- Prefect only if a documented need appears that the above doesn't cover (e.g. a dynamic Python flows UI for analysts).
