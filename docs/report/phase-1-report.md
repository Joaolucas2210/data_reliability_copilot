# Phase 1 report: foundation and first vertical slice

Date: 2026-10-09. Scope: the brief's sections 1-13. All numbers below were produced in this session; the raw
records are in `docs/evidence/` (eval JSONs, demo records, resource usage, UI screenshots + axe results).

## 1. Deliverables

| Area | Deliverable | Location |
|---|---|---|
| Product | Spec, personas, flows, success criteria, epistemic categories | `docs/product/spec.md` |
| Architecture | Module boundaries; Mermaid context, components, deployment (local + Azure), sequence; domain model with state machines; reliability design; agent; quality & lineage; recovery; API contract | `docs/architecture/` |
| Decisions | 13 ADRs (stack, monolith, data, quality, lineage, agent, isolation, evaluation, observability, orchestration, multicloud, design system, auth) | `docs/adr/` |
| Data | Deterministic synthetic finance data (Faker, seeded); dbt project with contracts, tests, freshness, Elementary | `src/drc/synth.py`, `dbt/` |
| Detection | 5 distinct mechanisms, incident dedup by fingerprint | `src/drc/quality.py` |
| Lineage | dbt-ol → file + Marquez (composite transport) | `src/drc/pipeline.py` |
| Evidence | 11 bounded read-only tools, content-addressed evidence, tool-call audit | `src/drc/tools.py` |
| Agent | LangGraph workflow, Postgres checkpoints, limits, citation enforcement, human-review interrupt, provider adapter (fake + Anthropic) | `src/drc/agent.py`, `citations.py`, `llm.py`, `fake_llm.py` |
| Recovery | Separate DB + role, snapshot hashes, 6 staged checks, production fingerprint, cleanup/GC | `src/drc/recovery.py`, `recovery/playbooks/` |
| Benchmark | 24 scenarios with ground truth (6 executable), harness A/B/C, MLflow | `benchmark/`, `src/drc/evaluate.py`, `docs/benchmark/` |
| API / worker / CLI | FastAPI, Postgres job queue worker, `drc` CLI | `src/drc/api.py`, `worker.py`, `cli.py` |
| UI / design system | Tokens (light/dark), components, 6 screens + gallery, axe + reflow + keyboard tests, live-API spec | `web/`, `docs/design-system/` |
| Infra | Compose with profiles; Terraform: Azure reference path, AWS/GCP foundations, equivalence matrix, parity gap, cloud runbook | `docker-compose.yml`, `infra/`, `docs/multicloud/` |
| Engineering | CI (lint, types, tests, demo, secrets, deps, a11y, Terraform), Makefile, SLOs, runbooks, rollback | `.github/workflows/`, `Makefile`, `docs/operations/` |

## 2. Key decisions (details in ADRs)

1. **Rules detect, the agent investigates**: detection never depends on an LLM (ADR-0004).
2. **Grounding is enforced, not requested**: facts need existing ids + a verbatim quote; otherwise removed, and a diagnosis without surviving support becomes an abstention (ADR-0006).
3. **Isolation is verified per run**: separate DB + role, fail closed, production fingerprint before/after (ADR-0007).
4. **Fake LLM is a labelled test double**, not a result; model choice stays provisional until a live eval (ADR-0006/0008).
5. **Unknown cost is `null`, never 0**: in the API, UI, MLflow and aggregates (ADR-0009).
6. **No orchestrator yet**: CLI + Make + Postgres job queue; criteria to add one are written down (ADR-0010).
7. **Azure first, AWS/GCP as real foundations, not empty modules**; parity gaps listed (ADR-0011).

## 3. Verification and results

| Check | Result |
|---|---|
| `ruff format --check`, `ruff check`, `mypy src` | clean (19 source files) |
| `pytest` (unit + integration on live Postgres) | all pass. Unit: transitions, citation enforcement, strict schema, cost unknown≠0, catalog shape, static check (forbidden SQL, undeclared file changes, word-bounded deny-list); integration: isolation, read-only role, sandbox drop guard, detect idempotency, crash→resume without repeated tool calls, no ground-truth leakage, tool refusals, API authz/redaction, closed incidents not investigable |
| UI: `tsc`, `vite build`, contrast script | pass; 33 token pairs ≥ AA in both themes |
| UI: axe (fixtures) | 18/18 tests, 0 violations (7 routes × 2 themes, tab panels, 320 px reflow, keyboard) |
| UI: axe + screenshots on **live API data** | 13/13, 0 violations; requires visible content and no page errors |
| Terraform `fmt -check` + `validate` (6 roots, TF 1.16.5 in Docker) | pass |
| Terraform `plan` | **not run**: no credentials/identities; billable resources out of scope |
| gitleaks v8.28.0 (dir scan) | no leaks (4 false positives on Key Vault secret *names* annotated inline) |
| pip-audit (locked deps) / npm audit | no known vulnerabilities |
| dbt-ol on dbt-core 1.12.5 | 74 OpenLineage events, exit 0; Marquez received 37 jobs, 13-node lineage graph for the report |
| OTLP → Jaeger 2.22 | traces for services `drc-eval`, `drc-demo` |

### Benchmark (provider = **fake**; read the caveat)

| System | Split | Accuracy | False-positive diagnoses | Appropriate abstention | Unsupported claims | Citation precision | Recovery valid | Cost |
|---|---|---|---|---|---|---|---|---|
| A rules | dev / final | 0.667 / 0.667 | 1 / 1 | 0.0 / 0.0 | n/a | n/a | n/a | 0 (no LLM) |
| B summary-only | dev / final | 0.667 / 0.667 | 1 / 1 | 0.0 / 0.0 | n/a | n/a | n/a | unknown |
| C agent + tools | dev / final | 1.0 / 1.0 | 0 / 0 | 1.0 / 1.0 | 0 | 1.0 | 1/1 per split, 0 invariant violations after | unknown |

Detection: all expected checks fired in 6/6 scenarios; 0 rule false positives on the no-fault scenarios.

**Caveat.** C's 100 % is a hand-written policy written with knowledge of these three scenario families. It shows
that the harness, tools, citation checks, review interrupt and recovery path work end to end. It is **not**
evidence that an LLM agent outperforms the baselines. The informative negative result is that both baselines
confidently diagnose a cause on INS-* where the evidence supports none.

### Vertical slice (DUP-01): what the local run does

1. Generates seeded data (400 customers, 600 contracts, 9 120 installments, 2 946 payments) and replays one
   payments batch (14 rows) with an ack-timeout log + a planted prompt-injection line.
2. `dbt-ol run` builds staging → marts; the run **succeeds**.
3. Detection: `unique_fct_payments_payment_id`, `inv_payment_id_unique`, `inv_reconciliation_amount`,
   `inv_reconciliation_count` fail; contracts and freshness pass → 1 incident.
4. Lineage: file + Marquez.
5. Investigation (fake, labelled): 8 tool calls, 3 LLM-adapter calls, 6/6 facts verified, H1 duplication
   supported, H2 transformation change refuted, recovery `dedupe_payments` proposed.
6. UI shows facts/hypotheses/recommendation/verified distinctly, with citations to evidence.
7. Sandbox validation: snapshot hashes match; compile, static check (changed files = the declared one),
   build, tests, invariants pass; 5/5 isolation checks; `fct_rows` 2960→2946, report amount
   11 691 327.25→11 650 312.20; sandbox dropped.
8. Approval via API (approver role) → proposal `approved` (not applied), incident `resolved`; the audit timeline
   has every transition.
9. Spans in `var/traces/spans.jsonl` + Jaeger; eval runs in MLflow.

## 4. Implemented vs simulated vs validated vs pending

| Item | Status |
|---|---|
| Synthetic data, dbt transforms, contracts/tests/freshness/invariants, detection, dedup | **Implemented and validated** (runs + tests) |
| Elementary anomaly test | Implemented; **not effective** (needs history; PASS with 1 day) |
| OpenLineage emission, Marquez ingestion | **Validated** locally |
| Bounded tools, evidence model, citation enforcement | **Validated** (tests, eval) |
| LangGraph checkpoint/resume, human interrupt | **Validated** (fault-injection test, API review) |
| LLM reasoning | **Simulated** (fake policy). Anthropic adapter implemented, **never called** |
| Model choice (`claude-opus-5-5`) | **Provisional**: not evaluated |
| Prompt-injection robustness | **Not measured** (the fake can't be fooled; metric exists for live runs) |
| Isolated recovery of a known playbook | **Validated** locally (same Postgres server; see limits) |
| Recovery of arbitrary AI-generated code | **Not implemented** (out of scope) |
| Benchmark: 6 executable / 24 specified | 18 scenarios **pending** implementation |
| API, worker, idempotency, authz (dev roles) | **Validated** locally; Entra ID **pending** |
| UI + design system | **Validated** with axe/keyboard/reflow automation; screen readers/zoom **not tested** |
| Azure Terraform | **Statically validated** only; never planned/applied |
| AWS/GCP Terraform | Foundations statically validated; app path **pending** (parity gap doc) |
| CI workflows | Written; **never executed** (no remote repo) |
| SLOs | **Proposed**, no data |

## 5. Local consumption (this machine: 12 vCPU, 15 GiB RAM, WSL2)

| Run | Wall time | Peak RSS (Python) |
|---|---|---|
| `drc eval --split dev` (3 scenarios, A/B/C + 1 recovery) | ~3:00 | ~310 MB |
| `drc eval --split final` | ~3:00 | ~300 MB |
| `drc demo` | ~1:22 | ~155 MB |
| One pipeline run (load + dbt run/test/freshness) | 39-47 s (dbt + Elementary hooks dominate) | - |
| Fake investigation | 0.4-0.7 s | - |

Containers idle: Postgres ~230 MiB, Marquez ~165 MiB, Jaeger ~14 MiB. Disk: `.venv` 1.2 GB, Playwright Chromium
681 MB, Terraform plugin cache 1.2 GB, `var/` ~220 MB. LLM spend: **US$ 0** (no live calls were made).
Exact figures: `docs/evidence/resource-usage.txt`.

## 6. Limitations and negative results (kept on purpose)

- No live-LLM evaluation; all agent quality numbers are from the fake.
- The first UI render against real API data **crashed** (blank pages) because my API contract doc did not
  match the backend; axe reported 0 violations on the blank pages. Found by looking at screenshots; fixed, and
  the live spec now requires visible content and no page errors.
- Warehouse tools read current state, not state as of the incident's run; re-investigating an old incident sees
  newer data. Evidence is now flagged; real fix pending.
- First isolation run failed closed because my matcher read the wrong line of the Postgres error, the guard
  worked, the check was wrong.
- Review found: static check trusted the playbook's own file list (fixed: real diff), substring deny-list
  (fixed: word-bounded regex), job lock shorter than worst-case validation (raised; heartbeat pending).
- Sandbox shares the Postgres server with production data; Jinja executes at compile time before static checks.
- Final split = seed variants of the same mechanisms (tests seed robustness, not generalisation).
- Concurrent pipeline runs are unsupported (shared raw schemas). No cancel endpoint. No retention jobs.
- `spans.jsonl` is never rotated.

## 7. Backlog: next phases (ordered)

1. **Live evaluation:** run dev split with 2-3 models/efforts (`--provider anthropic`), ≥5 repetitions; pick model by accuracy, unsupported claims, abstention, cost; then run final once. Record in ADR-0006.
2. **Per-run warehouse state** (snapshot schema per run or retained copies) so evidence is time-consistent.
3. Implement the 18 specified scenarios, starting with SCH-01, LAT-01, LOSS-01, JOIN-01, CON-01; re-split final by mechanism.
4. Groundedness judge (statement ↔ quote), calibrated on ~30 human labels, reported separately.
5. Separate Postgres server (or ephemeral container) for sandboxes; Jinja/macro allow-list before compile.
6. Entra ID auth; artifact storage on Blob; then first `terraform plan`/`apply` on Azure dev with budget alarms.
7. Job heartbeat leases, cancel endpoint, retention/pruning jobs, span file rotation.
8. Elementary: backfill history so anomaly tests are meaningful, or remove them.
9. MCP server exposing the same tool functions; contracts for more sources; Dagster/Airflow when the criteria in ADR-0010 are met; Databricks/Unity Catalog integration; vector store only with a demonstrated retrieval need.
10. AWS/GCP app path to reach the parity criteria in `docs/multicloud/parity-gap.md`.

## 8. LinkedIn post ideas (based only on what this phase produced)

1. **"O pipeline passou. O relatório estava errado."**: How four independent checks (dbt unique test, two
   reconciliations against control totals, an id invariant) caught a re-sent batch while contracts and freshness
   stayed green, and why contracts, tests, freshness and business invariants answer different questions.
2. **"Uma citação que existe não prova nada."**: Enforcing grounding in an AI investigator: evidence ids must
   exist and quotes must be verbatim, unsupported facts are dropped and the diagnosis is downgraded to an abstention.
   Include the honest part: these checks are a lower bar, and the live-model numbers don't exist yet.
3. **"O teste de acessibilidade passou numa página em branco."**: Zero axe violations on pages that had crashed,
   found only by looking at screenshots; the fix (assert content + no page errors) and the broader lesson about
   tests that pass vacuously; the same lesson as the sandbox isolation check that failed closed on a matcher bug.
