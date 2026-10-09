# Architecture overview

Modular monolith (`src/drc/`) + a separate worker process for long-running jobs (ADR-0002).
One Postgres server hosts separate databases with separate roles; nothing shares credentials.

## Module boundaries

| Boundary | Modules | Owns | Talks to |
|---|---|---|---|
| Data & transformations | `synth.py`, `scenarios.py`, `dbt/` | raw/ops schemas, dbt models | warehouse DB as `dbt_prod` |
| Pipeline execution | `pipeline.py` | `pipeline_run`, `var/runs/<run_id>/` artifacts | dbt / dbt-ol subprocesses |
| Quality | `quality.py` | `quality_check_result`, `incident` creation | warehouse as `copilot_reader` (read-only) |
| Metadata & lineage | `tools.get_lineage`, `pipeline.openlineage_config` | OpenLineage events (file + Marquez) | Marquez (optional) |
| Incidents & evidence | `domain.py`, `store.py`, `tools.py` | `incident`, `evidence`, `tool_call`, `audit_event` | app DB as `app` |
| Investigation | `agent.py`, `citations.py`, `llm.py`, `fake_llm.py` | `investigation`, `hypothesis`, LangGraph checkpoints | tools (never SQL/shell directly) |
| Isolated recovery | `recovery.py`, `recovery/playbooks/` | `remediation_proposal`, `validation_run`, `sandbox_*` DBs | sandbox DB as `sandbox_rw` |
| Evaluation | `evaluate.py`, `benchmark/` | `eval_run`, MLflow runs | everything above, as a harness |
| Audit & observability | `obs.py`, `store.audit` | spans, JSON logs, audit trail | OTLP collector (optional) |
| API & UI | `api.py`, `cli.py`, `worker.py`, `web/` | HTTP contract, job queue | app DB |

Rule: modules call each other through Python functions; only `store.py`/`tools.py`/`recovery.py`/`quality.py`
open DB connections, each with the narrowest role that works.

## Context

```mermaid
flowchart LR
  oncall([Data engineer on call]) -->|investigates, reviews| DRC
  owner([Finance / analytics owner]) -->|reads status| DRC
  approver([Platform lead]) -->|approves / rejects| DRC
  subgraph DRC[Data Reliability Copilot]
  end
  core[(Core banking\ncontrol totals)] -->|ops.control_totals| DRC
  ingest[Ingestion job\nlogs + batches] --> DRC
  DRC -->|dbt run/test/freshness| wh[(Warehouse\nPostgres)]
  DRC -->|OpenLineage events| marquez[Marquez]
  DRC -->|Messages API| llm[LLM provider\nAnthropic or fake]
  DRC -->|OTLP spans| otel[Jaeger / App Insights]
```

## Components

```mermaid
flowchart TB
  subgraph clients
    ui[React UI] --> api
    cli[drc CLI]
  end
  api[FastAPI api.py] -->|enqueue| jobs[(job table)]
  worker[worker.py] -->|claim SKIP LOCKED| jobs
  worker --> agent[agent.py LangGraph]
  worker --> recovery[recovery.py]
  cli --> pipeline[pipeline.py] --> dbt[dbt-ol / dbt]
  cli --> quality[quality.py]
  pipeline --> quality
  agent --> tools[tools.py bounded tools]
  agent --> citations[citations.py]
  agent --> llm[llm.py adapter] --> fake[fake_llm.py]
  llm --> anthropic[(Anthropic API)]
  tools -->|copilot_reader RO| wh[(warehouse)]
  tools --> artifacts[[var/runs/run_id: manifest, run_results, logs, openlineage.jsonl]]
  recovery -->|sandbox_rw| sbx[(sandbox_* DB)]
  recovery -->|copilot_reader RO snapshot| wh
  agent --> app[(app DB: incidents, evidence, audit, checkpoints)]
  api --> app
  evaluate[evaluate.py] --> mlflow[(MLflow sqlite)]
  dbt -->|dbt_prod| wh
  dbt -->|events| marquez[Marquez]
```

## Deployment

Local (implemented, Docker Compose profiles — `docs/operations/local-runbook.md`):

```mermaid
flowchart LR
  subgraph host[Developer machine]
    py[drc CLI / api / worker\n.venv Python 3.12]
    vite[Vite dev server :5173]
    subgraph compose[docker compose]
      pg[(postgres:17.11\nwarehouse, app, mlflow, marquez, sandbox_*)]
      mq[marquez 0.51.1\nprofile lineage]
      mw[marquez-web\nprofile lineage]
      jg[jaeger 2.22.0\nprofile obs]
    end
  end
  py --> pg
  py -.-> mq
  py -.-> jg
  vite --> py
```

Azure reference (Terraform written and validated, **not applied** — ADR-0011):

```mermaid
flowchart LR
  gh[GitHub Actions\nOIDC federated identity] -->|plan/apply - manual| arm[Azure RM]
  subgraph rg[Resource group drc-dev]
    aca_api[Container App api] --> pgf[(PostgreSQL Flexible Server 17)]
    aca_w[Container App worker] --> pgf
    job[Container Apps Job migrate] --> pgf
    kv[Key Vault] -.secret refs.-> aca_api & aca_w
    mi[User-assigned identity] --> kv & acr[ACR] & st[(Storage: artifacts)]
    aca_api & aca_w --> ai[App Insights / Log Analytics]
  end
```

## Main sequence — incident to reviewed recovery

```mermaid
sequenceDiagram
  autonumber
  participant CLI as drc / scheduler
  participant P as pipeline.py
  participant Q as quality.py
  participant A as API
  participant W as worker
  participant G as agent (LangGraph)
  participant T as tools
  participant L as LLM adapter
  participant R as recovery.py
  participant H as Human approver
  CLI->>P: execute(run)
  P->>P: load + dbt-ol run, dbt test, freshness (artifacts per run)
  CLI->>Q: detect(run_id)
  Q->>Q: contracts, tests, freshness, invariants → open/dedupe incident
  A->>W: enqueue investigate (idempotency key)
  W->>G: run(investigation_id) [checkpoint per node]
  G->>T: baseline tools (checks, control totals, model changes, lineage)
  loop ≤ max_rounds
    G->>L: plan (hypotheses + tool requests)
    G->>T: bounded tool calls (cached by key)
  end
  G->>L: diagnose (structured)
  G->>G: verify citations → drop unsupported facts / downgrade to abstain
  G->>G: propose (allow-listed playbook only)
  G-->>H: interrupt: awaiting review
  A->>W: enqueue validate(proposal)
  W->>R: sandbox DB + isolation checks + snapshot → compile → static → build → tests → invariants → drop
  H->>A: approve / reject
  A->>G: resume(Command) → record decision, audit
```

Related: [domain model](domain-model.md), [reliability](reliability.md), [agent](agent.md),
[quality and lineage](quality-and-lineage.md), [recovery](recovery.md), [API contract](api-contract.md).
