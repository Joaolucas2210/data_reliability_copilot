# Data Reliability Copilot

Investigates data-pipeline incidents — including the case where **the pipeline succeeds but the report is wrong** —
on a fictional consumer-finance operation with synthetic customers, contracts, installments and payments.

**Rules detect. The agent investigates and proposes. Humans decide.** Every factual claim cites evidence that
is checked programmatically; the agent abstains when evidence is insufficient; recovery runs only in an
isolated, verified sandbox; nothing is applied to production in this phase.

> Phase 1 = foundation + one vertical slice. The live-LLM path is implemented but **has not been evaluated**
> (no credentials in the build session); all numbers in this repo come from a deterministic fake LLM unless
> labelled otherwise. See the [phase-1](docs/report/phase-1-report.md) and [phase-2](docs/report/phase-2-report.md)
> reports for what is implemented, simulated, validated and pending.

## Quickstart

```bash
make setup     # Python 3.12 venv via uv + web deps
make demo      # Postgres → synthetic data with a duplicated batch → dbt (+OpenLineage) → checks → incident
               # → investigation (fake LLM) → recovery validated in an isolated sandbox
make api & make web   # UI at http://127.0.0.1:5173 (link printed by make demo)
make test      # unit + integration
make eval      # benchmark (dev split); make eval-final for the held-out split
make destroy   # remove containers, volume and var/
```

Details, profiles (Marquez, Jaeger) and resource use: [local runbook](docs/operations/local-runbook.md).

## Repository map

| Path | What |
|---|---|
| `src/drc/` | modular monolith: `synth` `scenarios` `pipeline` `quality` `tools` `agent` `citations` `llm` `fake_llm` `recovery` `evaluate` `store` `domain` `obs` `api` `worker` `cli` |
| `dbt/` | dbt project (staging → marts → `rpt_daily_collections`), contracts, tests, freshness, Elementary |
| `benchmark/scenarios/catalog.yaml` | 24 scenarios with ground truth (19 executable: 10 dev, 9 held-out final) |
| `recovery/playbooks/` | allow-listed recovery playbooks (`dedupe_payments`) |
| `web/` | React + TypeScript UI, design tokens, component gallery, axe tests |
| `infra/local/` | Postgres roles/DBs bootstrap, Marquez config |
| `infra/terraform/` | Azure reference path; AWS/GCP foundations; `check.sh` (fmt + validate) |
| `tests/` | unit + integration (isolation, resume, idempotency, leakage, authz, snapshots, cancel, lease, retention) |
| `docs/` | [spec](docs/product/spec.md) · [architecture](docs/architecture/overview.md) · [domain](docs/architecture/domain-model.md) · [reliability](docs/architecture/reliability.md) · [agent](docs/architecture/agent.md) · [quality & lineage](docs/architecture/quality-and-lineage.md) · [recovery](docs/architecture/recovery.md) · [API](docs/architecture/api-contract.md) · [benchmark](docs/benchmark/README.md) · [design system](docs/design-system/README.md) · [multicloud](docs/multicloud/equivalence-matrix.md) · [ADRs](docs/adr/README.md) · [SLOs & runbooks](docs/operations/slos-and-runbooks.md) · [sources](docs/sources.md) · [report](docs/report/phase-1-report.md) |

## Stack (pinned; see [sources](docs/sources.md))

Python 3.12 · PostgreSQL 17 · dbt-core 1.12.5 + dbt-postgres 1.11.0 · Elementary OSS 0.26.0 · OpenLineage 1.53.0 +
Marquez 0.51.1 · LangGraph 1.2.14 (Postgres checkpoints) · FastAPI · React 19 + TypeScript 7 + Vite 8 · MLflow 3.17 ·
OpenTelemetry 1.45 · Docker Compose · Terraform 1.16 (azurerm 5.9 / aws 6.68 / google 8.6).

## Checks

`make check` = ruff format + lint, mypy, unit tests, UI typecheck/build/contrast, Terraform fmt/validate.
CI (`.github/workflows/ci.yml`, `terraform.yml`) adds integration tests on a Postgres service, the end-to-end demo,
gitleaks, pip-audit, npm audit, Playwright + axe, dependency review. CI runs on GitHub Actions for every push to `main` and every PR.
