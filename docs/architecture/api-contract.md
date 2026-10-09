# API contract (v0, vertical slice)

Base path `/api`. JSON. Timestamps ISO-8601 UTC. Field names match `src/drc/domain.py` and
`src/drc/migrations/0001_init.sql`. All list endpoints are bounded (`limit` ≤ 200).

## Auth (local/dev only — see ADR-0013)

`DRC_AUTH_MODE=dev`: the caller sends `X-DRC-Role: viewer | investigator | approver`.
Missing header → `viewer`. In cloud mode the role comes from Entra ID app roles (not implemented yet).

| Action | viewer | investigator | approver |
|---|---|---|---|
| read health, incidents, investigations, evals | ✓ | ✓ | ✓ |
| read evidence with `access=restricted` | content replaced by `null` + `redacted: true` | ✓ | ✓ |
| start investigation / validation | 403 | ✓ | ✓ |
| review decision | 403 | 403 | ✓ |

Errors: `{"error": {"code": "forbidden" | "not_found" | "conflict" | "invalid", "message": str}}` with 403/404/409/422.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/pipelines/health` | `[{pipeline, last_run: PipelineRun, checks: {pass, warn, fail, error}, freshness: "pass"\|"warn"\|"fail"\|"unknown", open_incidents}]` |
| GET | `/api/incidents?status=` | `[Incident]` |
| GET | `/api/incidents/{id}` | `{incident, checks: [QualityCheckResult], timeline: [AuditEvent], investigations: [InvestigationSummary]}` |
| POST | `/api/incidents/{id}/investigations` | `202 {investigation_id, job_id}` (idempotent via `Idempotency-Key` header) |
| GET | `/api/investigations/{id}` | `Investigation` (below) |
| POST | `/api/investigations/{id}/review` | body `{decision: "approve"\|"reject", note}` → `Investigation` |
| POST | `/api/proposals/{id}/validations` | `202 {job_id}` — the run id appears as `latest_validation_run_id` on the investigation's proposal once the worker starts it |
| POST | `/api/investigations/{id}/cancel` | `202 {result: "cancelled" \| "cancel_requested"}`; 409 if not queued/running (investigator+) |
| GET | `/api/validation-runs/{id}` | `ValidationRun` |
| GET | `/api/evaluations/latest` | `{runs: [EvalRun]}` |

### Shapes

```text
PipelineRun   {id, pipeline, scenario_id, status, started_at, finished_at, dbt_version, manifest_hash}
Incident      {id, title, severity: "low"|"medium"|"high", status, dataset_id, occurrences, opened_at, updated_at, closed_at}
QualityCheckResult {id, pipeline_run_id, check_type: schema_contract|data_test|freshness|invariant|anomaly|model_run,
              check_name, dataset_id, status: pass|warn|fail|error|skipped, observed_value, expected, failures, message, evaluated_at}
AuditEvent    {id, at, actor, action, entity_type, entity_id, from_status, to_status, detail, trace_id}
InvestigationSummary {id, status, outcome, mode, llm_provider, llm_model, created_at, finished_at}
Investigation {id, incident_id, status, outcome, mode: "fake"|"live", llm_provider, llm_model, prompt_version,
              diagnosis: Diagnosis | null, citation_report, evidence: [Evidence (+redacted?)],
              hypotheses: [...], tool_calls: [{tool, args, status, rows_returned, duration_ms}],
              proposals: [RemediationProposal], usage: {llm_calls, input_tokens, output_tokens,
              cost_usd: number|null, cost_status: "measured"|"estimated"|"unknown", latency_ms}, limits}
citation_report {cited: int, existing: int, missing_ids: [str], quote_supported: int, quote_unsupported: [statement]}
RemediationProposal {id, playbook, rationale, evidence_ids, status, latest_validation_run_id}
ValidationRun {id, proposal_id, status, sandbox_db, steps: [{name: compile|static_check|dbt_build|data_tests|invariants,
              status: pass|fail|skipped|error, detail, duration_ms}], isolation_checks: [{name, passed, detail}],
              metrics_before: {...}, metrics_after: {...}, invariants: [{name, before, after, passed}],
              started_at, finished_at, cleaned_up_at}
EvalRun       {id, created_at, split: dev|final, system: A_rules|B_summary_llm|C_agent_tools, llm_provider, llm_model,
              prompt_version, metrics: {...}, per_scenario: [{scenario_id, expected, got, correct, unsupported_claims, ...}]}
```

UI must render `mode: "fake"` and `cost_status != "measured"` visibly. `cost_usd: null` means unknown — never show it as 0.
