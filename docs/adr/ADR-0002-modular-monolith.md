# ADR-0002 — Modular monolith with a separate worker process

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The product spans data generation, transformation, detection, metadata/lineage, incidents and evidence,
investigation, isolated recovery, evaluation, audit/observability, and API/UI. These are distinct
**responsibilities**, but one person builds them. There is one database server and no independent scaling or
release cadence yet. Investigations (LLM calls) and recovery validations (dbt runs, minutes) must not block HTTP requests.

## Alternatives

1. **Microservices per bounded context.** Independent deploys and scaling, but they need network contracts,
   distributed tracing to debug a single incident, and per-service ops. None of that is justified at one team and
   one workload.
2. **Single process including background work** (threads in the API). Simplest, but a crash or redeploy loses
   in-flight work, and long dbt runs compete with request handling.
3. **Modular monolith + separate worker process over a DB-backed queue** (chosen).

## Decision

One Python package `drc` (`src/drc/`) with module boundaries that follow the domain:

| Boundary | Modules |
|---|---|
| Data & transformations | `synth.py`, `scenarios.py` (injections), `pipeline.py`, `dbt/` |
| Quality | `quality.py` (checks, invariants, incident detection) |
| Metadata & lineage | `tools.get_lineage`, `pipeline.openlineage_config` |
| Incidents & evidence | `domain.py` (entities, transitions, output contract), `store.py`, `migrations/` |
| Investigation | `agent.py`, `citations.py`, `llm.py`, `fake_llm.py`, `tools.py` |
| Isolated recovery | `recovery.py`, `recovery/playbooks/` |
| Evaluation | `evaluate.py`, `benchmark/scenarios/catalog.yaml` |
| Audit & observability | `obs.py`, `store.audit`, `audit_event` table |
| API & interface | `api.py`, `cli.py`, `worker.py`, `web/` |

Rules: modules talk through function calls and the `app` database, never through each other's tables in
another module's transaction. State changes go through `store.transition` (validated against `domain.TRANSITIONS`
and audited). Long work runs in `drc worker`, which claims rows from the `job` table with
`SELECT … FOR UPDATE SKIP LOCKED` (`worker.claim`).

## Trade-offs

- One deployable and one image for API and worker (different commands). Simple ops; no independent scaling per boundary.
- Boundaries are enforced by convention and review, not by the runtime. Nothing stops an import across them.
- The Postgres queue avoids a broker (Redis/RabbitMQ). It scales to tens of jobs per minute, which is far above current load.

## Risks

- **Boundary erosion** (e.g. `api.py` querying tables owned by `agent.py`). This already exists in read endpoints, and is accepted for reads only.
- **Queue contention** at high job volume. A polling worker with a 2 s interval adds latency.

## Evidence

- `make demo` runs the whole slice in-process. `drc worker` + `POST /api/incidents/{id}/investigations` run the same code asynchronously.
- `tests/test_integration.py::test_resume_after_crash_does_not_repeat_tool_calls` shows a killed run can be resumed without repeating effects.
- Postgres skip-locked queues: https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE

## Revisit when

- A boundary needs a different scaling profile or release cadence. Recovery validation is the likely first one, since it needs its own compute and isolation.
- The job queue sustains more than about 50 jobs/min, or p95 claim latency exceeds 10 s.
- A second team owns a boundary.
- Import-linter style checks become necessary because boundary violations show up in review.
