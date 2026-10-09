# Pinned versions and sources (queried 2026-10-09)

Versions were read from the registries on the date above, pinned exactly, and the combinations marked
"verified" were exercised in this session. Nothing here is a claim about other combinations.

## Python (`pyproject.toml`, lock: `uv.lock`, Python 3.12.14 via uv)

| Package | Version | Source | Verified in session |
|---|---|---|---|
| dbt-core | 1.12.5 | https://pypi.org/project/dbt-core/ | `dbt run/test/source freshness` |
| dbt-postgres | 1.11.0 (requires dbt-core ≥1.8, adapters decoupled) | https://pypi.org/project/dbt-postgres/ | yes, with dbt-core 1.12.5 |
| elementary-data (CLI) + dbt package `elementary-data/elementary` | 0.26.0 / 0.26.0 (`require-dbt-version: [">=1.0.0","<3.0.0"]`) | https://pypi.org/project/elementary-data/ · https://hub.getdbt.com/elementary-data/elementary/latest/ | package hooks + `volume_anomalies` ran |
| openlineage-dbt / openlineage-python | 1.53.0 | https://pypi.org/project/openlineage-dbt/ | `dbt-ol run` → 74 events, exit 0; composite transport file+HTTP |
| langgraph / langgraph-checkpoint-postgres | 1.2.14 / 3.1.2 | https://pypi.org/project/langgraph/ | checkpoint, interrupt, resume after injected crash |
| anthropic | 1.12.1 | https://pypi.org/project/anthropic/ | import + signature only (`output_config` present); **no live call** |
| fastapi / uvicorn | 0.143.0 / 0.54.0 | PyPI | TestClient + live server |
| mlflow | 3.17.0 (sqlite backend) | https://pypi.org/project/mlflow/ | runs logged |
| opentelemetry-sdk / exporter-otlp-proto-http | 1.45.1 | PyPI | file exporter; OTLP to Jaeger |
| psycopg[binary,pool] | 3.3.6 | PyPI | yes |
| pydantic / faker / sqlglot | 2.14.0 / 40.41.0 / 30.21.0 | PyPI | yes |
| ruff / mypy / pytest / pip-audit | 0.16.10 / 2.4.0 / 9.1.1 / latest | PyPI | yes |

## Containers

| Image | Tag | Source |
|---|---|---|
| postgres | 17.11-alpine | https://hub.docker.com/_/postgres |
| marquezproject/marquez, marquez-web | 0.51.1 (ran on Postgres 17.11, migrations OK) | https://hub.docker.com/r/marquezproject/marquez |
| jaegertracing/jaeger | 2.22.0 | https://hub.docker.com/r/jaegertracing/jaeger |
| hashicorp/terraform | 1.16.5 | https://hub.docker.com/r/hashicorp/terraform |
| zricethezav/gitleaks | v8.28.0 | https://github.com/gitleaks/gitleaks |

## Web (`web/package.json`)

react / react-dom 19.3.0, vite 8.3.4, typescript 7.0.2, @playwright/test 1.64.0, @axe-core/playwright 4.13.0
(npm registry). TypeScript 7 + Vite 8 typecheck/build verified.

## Terraform providers (see ADR-0011)

azurerm 5.9.0, aws 6.68.0, google 8.6.0, random 3.9.1 (registry.terraform.io, 2026-10-09).

## LLM

Model ids and list prices: Claude API guidance bundled with Claude Code (model table cached 2026-10-06):
`claude-opus-5-5` $4 / $20 per MTok in/out, `claude-sonnet-5-5` $2 / $10, `claude-haiku-5-5` $0.10 / $0.50.
Re-check https://platform.claude.com/docs (pricing page) before relying on cost numbers.
