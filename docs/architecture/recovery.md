# Isolated recovery validation

Code: `src/drc/recovery.py`; playbooks: `recovery/playbooks/<id>/`; decision: ADR-0007.

## Isolation (verified on every run, not assumed)

| Control | How it is enforced | Verified by |
|---|---|---|
| Separate database | `CREATE DATABASE sandbox_<id>` per validation, `REVOKE CONNECT … FROM PUBLIC` | `sandbox_target_is_sandbox_db` |
| Separate credentials | role `sandbox_rw` (non-superuser) has no CONNECT on `warehouse`, `app` | `sandbox_role_cannot_connect_warehouse/app` expect `permission denied for database` |
| Read-only snapshot | `copilot_reader` (read-only txns) copies `raw` + `ops` | per-table `count:md5` of source vs copy |
| Production untouched | hash of `raw.payments`, `stg_payments`, `fct_payments`, `rpt_daily_collections` before/after | `production_warehouse_unchanged` |
| Separate artifacts | `var/validations/<id>/{baseline_project,project,compile,dbt_build,…}` | — |
| Fail closed | any isolation check false → refuse to run, still drop the sandbox | observed in-session (first run refused due to a matcher bug) |
| Cleanup | `DROP DATABASE … WITH (FORCE)` in `finally`; `drc gc` drops uncleaned sandboxes after 1 h | `cleaned_up_at` set |
| Limits | sandbox role `statement_timeout=60s`, dbt 300 s/step, `threads: 2` | — |

## Stages — and what each does *not* prove

| Stage | Proves | Does not prove |
|---|---|---|
| `snapshot` | the copy equals production raw data (hash) | anything about the fix |
| `compile` | SQL renders against the sandbox target | correctness; note Jinja/macros **execute** at compile time |
| `static_check` | only playbook-declared files changed, macros unchanged, compiled SQL parses as SELECT, no deny-listed tokens (`dblink`, `pg_read_file`, `copy`, `grant`, `warehouse.` …) | absence of every dangerous construct (deny-lists are incomplete) |
| `dbt_build` | the patched models execute on real-shaped data | that results are right |
| `data_tests` | declared dbt tests pass | business correctness |
| `invariants` | report reconciles with control totals; ids unique | that nothing else regressed |

Before/after: the **unpatched** project is built first on the same snapshot (`metrics_before`), then the patched
one (`metrics_after`), so the comparison isolates the playbook's effect.

## Result observed in this session (DUP-01, seed 42)

`fct_rows` 2960 → 2946, `report_payments` 2960 → 2946, `report_amount` 11 691 327.25 → 11 650 312.20;
`inv_payment_id_unique`, `inv_reconciliation_amount`, `inv_reconciliation_count`: fail → pass; all 5 isolation
checks pass; sandbox dropped. (Full record in `docs/evidence/`.)

## Phase 2: replay the incident, not the present

The sandbox is now seeded from the incident run's frozen snapshot `snap_<run_id>` (raw + ops), and the playbook is
applied on top of the incident run's own dbt project copy (`var/runs/<run_id>/project`); the static check diffs against
that copy. The snapshot step records `source: snap_<run>.raw__payments` per table next to the `count:md5` comparison.
In the phase-2 benchmark both proposed recoveries (DUP-01 dev, CON-02 final) validated with all invariants holding and
production fingerprints unchanged. See ADR-0014.

## Limits of this design

- Same Postgres **server** as production: isolates data and credentials, not CPU/IO; a server-level
  compromise is not contained. Next step for cloud: a separate Flexible Server (or ephemeral container) for sandboxes.
- `sandbox_rw` has `CREATEDB` (needed to create its sandboxes) and CONNECT on the `postgres` maintenance DB.
- Playbooks are trusted repo code. Running **AI-generated** SQL needs more: a separate server, no network
  egress, Jinja sandboxing/macro allow-list, resource quotas — separate evolution (backlog).
- "Recovery validated" means *this playbook fixed this snapshot*. It is not a claim that applying it to
  production is safe.
