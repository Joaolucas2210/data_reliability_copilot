# ADR-0001 — Stack and pinned versions

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

The brief fixes a direction (Python, PostgreSQL, dbt Core, Elementary OSS, OpenLineage + Marquez, LangGraph,
FastAPI, React + TypeScript, MLflow, OpenTelemetry, Docker Compose). Changing it requires an ADR and concrete
evidence. The risk is not the choice of tools but **unverified compatibility**. For example, dbt adapters are now
released separately from dbt-core, and dbt packages and the OpenLineage wrapper each declare their own dbt ranges.
A reproducible demo needs every version pinned exactly, and compatibility verified by running it rather than
assumed from release notes.

## Alternatives

1. **Floating ranges** (`dbt-core>=1.8`). Less maintenance, but runs stop being reproducible and benchmark results
   can drift for reasons unrelated to our code.
2. **Pin exactly + lock file** (chosen). `pyproject.toml` uses `==` pins and `uv.lock` pins transitive dependencies.
   Images use version tags and `web/package.json` uses exact versions. Upgrading becomes deliberate work.
3. **Pin by image digest as well.** Stronger supply-chain guarantee. Deferred, because tags are enough for a local
   demo and the rest of the toolchain doesn't consume digests yet.

## Decision

Option 2. Versions were taken from PyPI JSON, Docker Hub and the npm registry on 2026-10-09:

| Area | Pin |
|---|---|
| Python | 3.12 (`requires-python = ">=3.12,<3.13"`; uv-managed CPython 3.12.14) |
| dbt | dbt-core 1.12.5, dbt-postgres 1.11.0, elementary dbt package 0.26.0 (+ dbt_utils 1.4.1 transitively) |
| Elementary CLI | elementary-data 0.26.0 (`<3.14` Python) |
| Lineage | openlineage-dbt 1.53.0, openlineage-python 1.53.0; Marquez / marquez-web 0.51.1 |
| Agent | langgraph 1.2.14, langgraph-checkpoint-postgres 3.1.2, anthropic 1.12.1, pydantic 2.14.0 |
| API | fastapi 0.143.0, uvicorn 0.54.0, psycopg 3.3.6 |
| Eval / obs | mlflow 3.17.0, opentelemetry-sdk + exporter-otlp-proto-http 1.45.1; Jaeger 2.22.0 |
| Data | faker 40.41.0, sqlglot 30.21.0; PostgreSQL 17.11-alpine |
| Dev | ruff 0.16.10, mypy 2.4.0, pytest 9.1.1, pip-audit |
| Web | react 19.3.0, vite 8.3.4, typescript 7.0.2, @playwright/test 1.64.0, @axe-core/playwright 4.13.0 |
| IaC | Terraform 1.16.5 (Docker image), providers per ADR-0011 |

Python is 3.12, not 3.13: elementary-data requires `<3.14`, and 3.12 is the newest version where every pinned
package declares support. The host had only 3.10, so uv installs the interpreter.

## Trade-offs

- Exact pins mean upgrades are manual PRs. Dependabot or Renovate is not configured yet.
- `dbt-postgres` (1.11.0) is one minor version behind `dbt-core` (1.12.5). This is expected now that adapters are
  decoupled (dbt-postgres declares `dbt-core>=1.8.0rc1,<2.0`), but it is a pairing dbt Labs may test less often.
- TypeScript 7.0.2 is a new major version. The UI fork verified it with Vite 8 (ADR-0012).

## Risks

- **Transitive drift without the lock.** `uv sync` without `--frozen` re-resolves. CI uses `--frozen`.
- **Version churn in agent tooling** (LangGraph, the Anthropic SDK) is fast. Mitigated by the provider adapter
  (ADR-0006) and the deterministic fake mode used in tests.
- **Unknown CVEs over time.** `pip-audit` and `npm audit` run in CI, as advisory jobs for now.

## Evidence

Each compatibility claim below comes from a command run in this session:
- `uv sync` resolved all pins with no conflicts. `uv.lock` is committed.
- `dbt deps` installed elementary 0.26.0 and dbt_utils 1.4.1. The package declares `require-dbt-version: [">=1.0.0", "<3.0.0"]`.
- `dbt-ol run` on dbt-core 1.12.5 printed "Emitted 74 OpenLineage events" and "Underlying dbt execution returned 0".
- `dbt test`: PASS=13 (11 data tests + 2 elementary hooks). `dbt source freshness` passed for 4 sources.
- Marquez 0.51.1 started against PostgreSQL 17.11 (Flyway migrations ran), and `GET /api/v1/namespaces` answered.
- `langgraph` `PostgresSaver.setup()` created checkpoint tables in the `app` DB. A crash/resume test passes (`tests/test_integration.py`).
- `pip-audit` (`--no-deps`) found no known vulnerabilities. `npm audit` found 0 vulnerabilities.
- Sources: https://pypi.org/project/dbt-core/1.12.5/, https://pypi.org/project/dbt-postgres/1.11.0/,
  https://hub.getdbt.com/elementary-data/elementary/latest/, https://pypi.org/project/openlineage-dbt/1.53.0/,
  https://hub.docker.com/r/marquezproject/marquez/tags, https://pypi.org/project/langgraph/1.2.14/,
  https://pypi.org/project/langgraph-checkpoint-postgres/3.1.2/, https://hub.docker.com/_/postgres/tags.

## Revisit when

- A pinned package publishes a security advisory, or `pip-audit`/`npm audit` turns blocking.
- dbt-postgres ships 1.12.x: align the minor versions and re-run `make demo` + `make eval`.
- elementary-data supports Python 3.13+ and we need a 3.13-only feature.
- Upgrades become frequent enough to justify Renovate (more than 2 manual bump PRs a month).
