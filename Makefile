# Data Reliability Copilot — local entry points. See docs/operations/local-runbook.md.
SHELL := /bin/bash
VENV  := source .venv/bin/activate &&
export MLFLOW_DISABLE_AGENT_HINT := 1

.PHONY: help setup up up-lineage up-obs down destroy migrate dbt-deps demo api worker web eval eval-final \
        test test-unit lint typecheck web-check tf-check check reset gc prune mlflow-ui clean

help:            ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/'

setup:           ## install Python (uv) and web dependencies
	uv sync
	cd web && npm ci

up:              ## start Postgres only (~150 MB RAM)
	docker compose up -d --wait postgres

up-lineage:      ## + Marquez API/web (JVM, ~+700 MB). Then export DRC_MARQUEZ_URL=http://localhost:5000
	docker compose --profile lineage up -d --wait

up-obs:          ## + Jaeger. Then export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
	docker compose --profile obs up -d --wait

down:            ## stop containers, keep data
	docker compose --profile lineage --profile obs down

destroy:         ## stop containers AND delete the local database volume + var/
	docker compose --profile lineage --profile obs down -v
	rm -rf var

dbt-deps:        ## install dbt packages (elementary)
	$(VENV) cd dbt && dbt deps --profiles-dir .

migrate: up dbt-deps ## app DB migrations + checkpoint tables
	$(VENV) drc migrate

demo: migrate    ## vertical slice on DUP-01 (fake LLM unless DRC_LLM_PROVIDER=anthropic)
	$(VENV) drc demo

api:             ## API on :8000
	$(VENV) drc api

worker:          ## job worker (investigations, validations)
	$(VENV) drc worker

web:             ## UI on :5173 (proxies /api to :8000)
	cd web && npm run dev

eval: migrate    ## benchmark, dev split
	$(VENV) drc eval --split dev

eval-final: migrate ## benchmark, held-out final split (don't tune on it)
	$(VENV) drc eval --split final

mlflow-ui:       ## browse eval runs on :5050
	$(VENV) mlflow ui --backend-store-uri sqlite:///var/mlflow.db --port 5050

test-unit:       ## unit tests (no DB)
	$(VENV) pytest tests/test_unit.py -q

test: up         ## all tests; integration tests need `make demo` first
	$(VENV) pytest -q

lint:            ## ruff format check + lint
	$(VENV) ruff format --check src tests && ruff check src tests

typecheck:       ## mypy
	$(VENV) mypy src

web-check:       ## UI typecheck, build, contrast, axe
	cd web && npm run typecheck && npm run build && npm run contrast

tf-check:        ## terraform fmt + validate (docker; no credentials, no plan/apply)
	infra/terraform/check.sh

check: lint typecheck test-unit web-check tf-check ## everything CI runs (except integration)

reset:           ## wipe LOCAL app DB, warehouse marts and run artifacts
	$(VENV) drc reset

gc:              ## drop leftover sandbox databases
	$(VENV) drc gc

prune:           ## retention: keep 20 snapshots, 30 days of run artifacts/checkpoints (add ARGS=--dry-run)
	$(VENV) drc prune $(ARGS)

clean:           ## remove caches and build outputs
	rm -rf .mypy_cache .ruff_cache .pytest_cache web/dist dbt/target dbt/logs
