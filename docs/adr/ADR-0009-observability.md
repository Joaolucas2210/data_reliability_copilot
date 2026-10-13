# ADR-0009: OpenTelemetry spans, structured logs and an audit table from the first investigation

- **Status:** Accepted (2026-10-09)
- **Deciders:** project owner (Staff Engineer role)

## Context

Cost, latency and execution limits must be observable from the first investigation. Debugging an incident means following one
investigation across pipeline, tools, LLM calls and sandbox runs. Human decisions and state changes need a durable audit trail. The local
footprint must stay small.

## Alternatives

1. **Logs only.** Simple, but no causal timing across steps.
2. **Vendor SDK (e.g. App Insights SDK) directly.** Ties code to one cloud and conflicts with ADR-0011 portability.
3. **OpenTelemetry SDK + always-on file exporter + optional OTLP** (chosen), with a separate business audit table.

## Decision

- `obs.setup` installs a TracerProvider. Spans **always** go to `var/traces/spans.jsonl` (ConsoleSpanExporter to file), and also to
  OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Jaeger 2.22.0 runs in the compose `obs` profile (`:16686` UI, `:4318` OTLP).
- Spans: `pipeline.run`, `ingestion.load`, `dbt.<step>`, `investigation.run`, `tool.<name>` (args as attribute), `llm.call`
  (model, tokens, latency, cost), `recovery.validate`, `job`, `eval.run`.
- `obs.log` writes one JSON line per event with `trace_id` (tool calls, dbt exits, incident detection, fallbacks, failures).
- `audit_event` (app DB) records every status transition and decision with actor, from/to, detail and `trace_id`, via `store.transition`/`store.audit`.
- Usage per investigation (`investigation.usage`): LLM calls, tool calls, tokens (None if unknown), cost + `cost_status`, LLM latency,
  wall time, fallbacks, limit hit. The UI shows `mode=fake` and unknown cost explicitly.
- Compose profiles with memory limits: default `postgres` (512 MB cap), `lineage` (Marquez 768 MB + web 256 MB), `obs` (Jaeger 512 MB).

## Trade-offs

- `SimpleSpanProcessor` to file is synchronous. That's fine at this volume and avoids losing spans on crash.
- Two places record "what happened": spans (operational, sampled later) and audit (business, durable). This is intentional, not duplication.

## Risks

- `spans.jsonl` grows without rotation. Retention is not implemented locally (see runbook).
- Tool arguments in span attributes could carry sensitive values if tools ever accept them. Today args are allow-listed identifiers only.

## Evidence

- Measured container memory with all profiles up: postgres 230 MB, Marquez 165 MB, marquez-web 22 MB, Jaeger 14 MB (`docker stats`, 2026-10-09).
- Investigation usage recorded for DUP-01 fake: `llm_calls 3, tool_calls 8, cost_usd null, cost_status unknown, wall_ms 466`.
- OTel Python: https://opentelemetry.io/docs/languages/python/ ; Jaeger OTLP: https://www.jaegertracing.io/docs/2.22/

## Revisit when

- Investigations run in the cloud. Export OTLP to the platform backend (Azure Monitor via the OTel distro) and define span sampling.
- `spans.jsonl` exceeds 100 MB per week locally. Add rotation, or drop the file exporter when OTLP is configured.
- SLO dashboards are needed. Derive metrics (OTel metrics API) for detection-to-diagnosis latency and cost per investigation.
