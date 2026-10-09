# Plan and assumptions (phase 1)

## Repository state at start (2026-10-09)

Empty directory (only an empty `.qodo/`), not a git repository, no `AGENTS.md` or other instructions.
No prior decisions to preserve. Tooling available: Docker 28 + Compose 2.38, uv 0.12, Node 24, Make.
Not available: Terraform (run via Docker), `psql` (run inside the container), LLM credentials.

## Assumptions (reversible; each has an owner document)

| # | Assumption | Why | Revisit |
|---|---|---|---|
| A1 | One Postgres **server**, separate databases/roles for warehouse, app, sandboxes, Marquez, MLflow | lowest local footprint; isolation by credentials is verifiable | cloud: separate server for sandboxes (ADR-0007) |
| A2 | Fake LLM is the default; live Anthropic path implemented, not evaluated | no credentials in session | first live eval run (ADR-0006) |
| A3 | Default live model `claude-opus-5-5` | current default in the vendor guidance consulted; brief requires choosing by evaluation → provisional | after live eval |
| A4 | One pipeline run at a time | benchmark is sequential; shared raw schemas | concurrent runs → schema-per-run or DB-per-run |
| A5 | Docs in English, final report summary in Portuguese | API/code vocabulary is English; easier reuse | owner preference |
| A6 | Benchmark `final` split = seed variants of the 3 implemented mechanisms | brief asks for 3 complete scenarios now | when ≥3 more mechanisms are executable, re-split by mechanism |
| A7 | Dev-only header auth; API refuses non-dev modes | no identity provider locally | before any cloud exposure (ADR-0013) |
| A8 | Lineage read from the run's OpenLineage file (Marquez optional) | keeps default profile light | if cross-run lineage queries are needed → query Marquez API |

## Execution plan (as executed)

1. Inspect repo and tooling; query registries for current versions; verify riskiest compatibility first
   (dbt 1.12 + elementary + dbt-ol) before writing more code.
2. Data: Compose + roles, deterministic generator, dbt project with contracts/tests/freshness/anomaly.
3. Domain + migrations; pipeline runner with per-run artifacts; detection with dedup.
4. Bounded evidence tools; LangGraph agent with checkpoints, limits, citation enforcement, human interrupt;
   provider adapter + fake.
5. Isolated recovery (separate DB + role, snapshot hashes, staged validation, cleanup).
6. Benchmark catalog (24) + harness (A/B/C) + MLflow.
7. In parallel: UI + design system; Terraform multicloud; ADRs.
8. Tests, lint, types, secret scan, dependency audit, Terraform validate; full evidence run; UI screenshots
   against the live API; report.
