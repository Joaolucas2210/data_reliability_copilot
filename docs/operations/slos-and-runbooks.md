# Proposed SLOs, indicators, runbooks and rollback

Status: **proposed**. No production traffic exists; targets are starting points to be re-set after 4 weeks of data.

## SLOs

| # | SLI (how measured) | Proposed objective | Source of the number |
|---|---|---|---|
| 1 | Detection latency: `incident.opened_at − pipeline_run.finished_at` | 99 % < 5 min | `pipeline_run`, `incident` |
| 2 | Investigation completion: share of investigations reaching `awaiting_review` (diagnosis **or** abstention) without `failed` | 95 % / 28 days | `investigation.status` |
| 3 | Investigation latency (`usage.wall_ms`) | p90 < 3 min (live LLM) | `investigation.usage` |
| 4 | Grounding: facts removed by citation checks / facts produced | < 5 % / 28 days; any fact shown in UI is 100 % verified (enforced) | `citation_report` |
| 5 | Cost per investigation (`usage.cost_usd`, estimated) | p95 < US$ 0.50; `unknown` share < 1 % | `investigation.usage` |
| 6 | Sandbox hygiene: validations with `cleaned_up_at` set within 1 h | 100 % | `validation_run` |
| 7 | Isolation: validations that ran with any isolation check false | **0** (hard invariant, not a budget) | `validation_run.isolation_checks` |
| 8 | API availability (`/api/healthz` success) | 99.5 % monthly (internal tool) | probe |

Offline quality (not an SLO, a release gate): on the `final` split, no regression in accuracy, abstention rate or
unsupported claims vs the previous prompt/model version.

## Runbooks

**R1: Investigation failed.** `select error from investigation where id=…`; `select * from job where payload->>'investigation_id'=…`.
Provider errors (429/5xx) → retry later; schema validation errors → the model output didn't match the schema → open a
bug with the request id (`usage.request_id`); tool errors → `select * from tool_call where status='error'`.
The incident is back to `open`; a human investigates manually.

**R2: Unsupported-fact rate spike (SLO 4).** Compare `prompt_version` and `llm_model` of recent investigations; if a
change correlates, roll back (below). Sample 10 `unsupported_facts` and label the failure (paraphrased quote vs wrong id).

**R3: Cost spike (SLO 5).** Check `usage.llm_calls`, `input_tokens`; lower `LIMITS`, or switch model via config. Unknown
cost share rising → model not in `llm.PRICES`; add it.

**R4: Leftover sandboxes / isolation check failed.** `drc gc`. If an isolation check is false: stop the worker; verify
role grants (`\l+`, `\du`) against `infra/local/init.sql`; do not re-run validations until fixed.

**R5: Wrong incident volume.** Rule change or upstream change: compare `quality_check_result` counts per check per day.
Dismiss false incidents with a reason (audit), fix the rule, add a benchmark scenario.

## Rollback

| Change | Rollback |
|---|---|
| Prompt / model | config only (`DRC_LLM_MODEL`, `PROMPT_VERSION` in code): redeploy previous revision; eval results are kept per version in MLflow |
| App code | Container Apps: activate previous revision (`az containerapp revision activate`); locally `git checkout` |
| DB migration | forward-only; ship a compensating migration. Migrations must be additive so the previous revision still runs |
| dbt model | revert the model; re-run the pipeline; incidents from the bad version are dismissed with reason |
| Recovery playbook | nothing to roll back in production in phase 1 (never applied) |
