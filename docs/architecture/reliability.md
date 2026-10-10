# Reliability design

Each item says what is **implemented and tested**, what is **implemented but untested**, and what is **design only**.

## Idempotency

| Operation | Mechanism | Status |
|---|---|---|
| Pipeline run | optional `idempotency_key` (unique) → returns existing run | implemented |
| Detection | checks unique per (run, check_name), `ON CONFLICT DO NOTHING`; re-detecting a run returns its incident whatever its status | tested (`test_detect_is_idempotent`) |
| Incident dedup | partial unique index: one non-terminal incident per fingerprint; recurrence bumps `occurrences` | implemented |
| Investigation create | `idempotency_key` (API `Idempotency-Key` header) | implemented |
| Tool calls | key = sha256(investigation, tool, args); replay returns stored evidence | tested (`test_resume_after_crash_does_not_repeat_tool_calls`) |
| Evidence | content-addressed id, `ON CONFLICT DO NOTHING` | implemented |
| Proposal | deterministic id per investigation | implemented |
| Jobs | `idempotency_key` per job (`investigate:<id>`) | implemented |

LangGraph checkpointing + replay **does not** make external effects exactly-once; the guarantees above do.
Re-executed nodes are safe because every write is an upsert, a transition guarded by current status, or keyed.

## Reprocessing and deduplication

Each pipeline run writes to a new `var/runs/<run_id>/` (artifacts never overwritten). Re-running a scenario
reloads raw data from the seed (deterministic business columns). Data-level dedup is a **recovery playbook**
(`dedupe_payments`), not a silent fix in the pipeline: the incident must stay visible.

## Transactions and migrations

- Forward-only SQL migrations (`src/drc/migrations/NNNN_*.sql`), each in its own transaction, recorded in
  `schema_migrations`, serialized with an advisory lock. LangGraph checkpoint tables via `PostgresSaver.setup()`.
- Cloud: a migration job runs before a new app revision (`docs/operations/cloud-runbook.md`).
  Design rule: migrations are additive (expand → migrate → contract across releases) so the previous revision keeps working during rollout. **Gap:** the app does not yet refuse to start on an unknown newer schema.

## Retries, timeouts, cancellation

| Layer | Limit |
|---|---|
| Job | `max_attempts=2`, retry after 10 s; the lock is a **lease renewed every 20 s by a heartbeat thread**; a lease not renewed for 120 s is reclaimable (worker died). The heartbeat stops if this worker no longer owns the lock (tested) |
| dbt subprocess | 300 s timeout → exit 124 recorded as `error` |
| Warehouse reads (agent) | role `statement_timeout=5s`, read-only transactions, row caps (10 rows / 40 lines) |
| Sandbox | role `statement_timeout=60s` |
| LLM | SDK timeout 90 s, `max_retries=2`; agent limits: 3 rounds, 20 tool calls, 6 LLM calls, 120k input tokens, 300 s wall, $1.00 |
| Cancellation | `POST /api/investigations/{id}/cancel`: queued → `cancelled`; running → cooperative flag checked at each node → `cancelled`, incident back to `open` (tested). Validations are not cancellable yet |

Exhausting an agent limit yields an **abstention** with the limit named, never a partial guess.

## Partial failure and resume

- Investigation crash → job requeued → `agent.run()` resumes from the last checkpointed node (tested with
  fault injection). After `max_attempts`, investigation → `failed`, incident → `open`.
- Validation crash → sandbox left behind → `drc gc` / worker start drops `sandbox_*` DBs whose run was never
  cleaned after 1 h (implemented, not tested under a real crash).
- Marquez down → OpenLineage composite transport continues (file transport still written).

## Concurrency and resource limits

- Workers claim jobs with `FOR UPDATE SKIP LOCKED` → multiple workers are safe. Status transitions lock the row.
- One sandbox DB per validation; Postgres `max_connections=60`; container memory limits in compose.
- **Known limit:** pipeline runs share the `warehouse` raw/ops schemas — two concurrent pipeline runs would
  interfere. Phase 1 assumes one pipeline run at a time (the benchmark is sequential).
- **Fixed in phase 2 (ADR-0014):** tools used to read the *current* warehouse. Each run now freezes its state into `snap_<run_id>`; tools and recovery read that snapshot.
- **Phase 3 fingerprint v2:** SHA-256 of canonical JSON containing sorted failing check names,
  all project-model code checksums from the run manifest, and sorted business dates whose amount/count
  differs from control totals in the run snapshot. Full checksums distinguish changed transformations
  without recomputing a last-known-good comparison on retry. Run IDs, timestamps and transient batch tags
  are excluded when signals exist. Missing artifacts/snapshot, unreadable report or >1000 affected dates
  use a per-run sentinel, conservatively preventing cross-run merging. Original run→incident check links
  preserve replay identity after recurrence or version upgrades. No cause label or catalog ground truth is used.
  See [ADR-0016](../adr/ADR-0016-incident-fingerprint.md).
- **Residual limit:** different ingestion mechanisms with identical checks, model code and affected dates
  can still merge. The fingerprint is an observed signature, not a diagnosis; model comment changes can
  conversely split equivalent incidents. Existing incidents are not rewritten by the v2 change.


## Backup and restore

- Local: `docker compose` volume `pgdata`; `make destroy` deletes it. Data is reproducible from seeds; incident
  history is not — export with `pg_dump app` if it matters.
- Azure (Terraform): PostgreSQL Flexible Server automated backups, 7-day retention, PITR; geo-redundant backup
  off for dev (documented trade-off). Restore drill: **not executed** (no cloud apply in this phase).

## Authentication and authorization

Dev-only header roles; API refuses to start in any other mode (ADR-0013). DB roles: `dbt_prod` (writes
warehouse), `copilot_reader` (read-only, 5 s timeout), `app`, `sandbox_rw` (no CONNECT on warehouse/app),
`marquez`. Restricted evidence content is redacted for viewers. Target: Entra ID app roles + managed identity.

## Retention and expiry

| Data | Proposed retention | Status |
|---|---|---|
| `var/runs/*` artifacts and logs | 30 days, except runs referenced by non-terminal incidents | implemented (`drc prune`) |
| Evidence rows | life of the incident + 180 days | design only |
| Audit events | 1 year minimum, append-only | design only |
| LangGraph checkpoints | delete thread 30 days after the investigation is completed/cancelled/failed | implemented (`drc prune`) |
| Per-run snapshots `snap_<run_id>` | newest 20, plus any referenced by non-terminal incidents | implemented (`drc prune`) |
| `var/traces/spans.jsonl` | rotated above 50 MB | implemented (`drc prune`) |
| Sandbox DBs | dropped at end of validation; GC after 1 h | implemented |
| Eval runs / MLflow | keep (small) | — |

Evidence is excerpted (≤4000 chars), PII columns are never selected (allow-listed columns), and synthetic data
contains no real personal data.
