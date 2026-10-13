# Local runbook

For a Portuguese walkthrough with beginner and staff engineer sections, trigger diagrams, investigation details and data concepts, see the [end-to-end guide](guia-ponta-a-ponta.md).

Prerequisites: Docker (Compose v2), [uv](https://docs.astral.sh/uv/), Node 24, GNU Make. Terraform is not needed
locally (`make tf-check` runs it in Docker).

## Setup → demo → tests → eval → cleanup

```bash
make setup            # uv sync (Python 3.12 venv) + npm ci
make up               # Postgres 17 only
make demo             # migrate, dbt deps, DUP-01 pipeline, detection, investigation (fake), sandbox validation
make api              # terminal 2: API on :8000
make web              # terminal 3: UI on :5173  → open the "ui" URL printed by `make demo`
make worker           # terminal 4 (optional): processes jobs queued from the UI (investigate / validate)
make test             # unit + integration (integration needs `make demo` first)
make eval             # benchmark dev split;  make eval-final for the held-out split
make mlflow-ui        # :5050
make prune            # retention (ARGS=--dry-run to preview)
make down             # stop, keep data      |  make destroy  # stop + delete volume + var/
```

Live LLM: `export DRC_LLM_PROVIDER=anthropic` (credentials via `ANTHROPIC_API_KEY` or `ant auth login`;
model `DRC_LLM_MODEL`, default `claude-opus-5-5`). Every run then costs money; check `investigation.usage`.

Human review from the CLI: `drc review <investigation_id> approve --close-incident resolved`.

## Compose profiles and resource use

| Profile | Services | Memory limit | Observed (this session, idle after a run) |
|---|---|---|---|
| default | postgres | 512 MiB | ~230 MiB |
| `lineage` (`make up-lineage`) | + marquez, marquez-web | +768 MiB, +256 MiB | marquez ~165 MiB at start, web ~22 MiB |
| `obs` (`make up-obs`) | + jaeger | +512 MiB | ~14 MiB at start |

Enable exporters: `export DRC_MARQUEZ_URL=http://localhost:5000` (Marquez UI on :3000) and
`export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (Jaeger UI on :16686).
Spans are always written to `var/traces/spans.jsonl`, JSON logs go to stderr.

Disk: `.venv` ≈ 1 GB (dbt + MLflow + LangGraph); Playwright Chromium ≈ 680 MB (only for `npm run a11y`);
`infra/terraform/.plugin-cache` ≈ 1.2 GB after `make tf-check`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `connection refused :55432` | `make up` |
| `permission denied for database warehouse` in a validation | expected for `sandbox_rw` (that is the isolation check); if it appears for `dbt_prod`, the volume was initialised by an older `init.sql` → `make destroy && make demo` |
| validation `refusing to run` | an isolation check failed: read `validation_run.isolation_checks`; do not bypass |
| leftover `sandbox_*` databases | `make gc` |
| investigation stuck `running` | worker died: its lease expires after 120 s and the next `make worker` reclaims the job; or `drc cancel <investigation_id>` |
| `dbt deps` fails offline | packages come from hub.getdbt.com; cache `dbt/dbt_packages` |
