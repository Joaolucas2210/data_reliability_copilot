# ADR-0007 — Recovery validated only in a separate database with a separate role

- **Status:** Accepted (2026-10-09). Isolation is verified per run, but it is logical isolation on a shared server (see Risks).
- **Deciders:** project owner (Staff Engineer role)

## Context

A diagnosis may propose a recovery. Nothing may be applied to production in this phase. Even a validation run must not be
able to write production data, and proposed code (SQL, dbt macros, Jinja) must be treated as untrusted. "dbt compile succeeded"
proves the SQL renders. It proves nothing about correctness.

## Alternatives

1. **Same database, isolated schema.** Cheap, but one grant mistake gives write access to production schemas, and dbt macros can address any schema.
2. **Separate database + separate role on the same server** (chosen).
3. **Separate server/container per validation** (ephemeral Postgres). Strongest isolation, but slower and heavier locally. It's the next step.

## Decision

`recovery.validate(proposal_id)`:
1. Creates `sandbox_<id>` as role `sandbox_rw` and revokes PUBLIC CONNECT on it. `sandbox_rw` has no CONNECT on `warehouse`, `app`,
   `marquez` or `mlflow`. It can connect to `postgres` only to create and drop its databases. Its `statement_timeout` is 60 s.
2. **Verifies isolation before running anything** (`isolation_checks`). `sandbox_rw` must fail to connect to `warehouse` and `app`
   with `permission denied for database`, the session must be in the sandbox DB, and the role must not be a superuser. If any check fails, the run is refused.
3. Fingerprints production (`warehouse_fingerprint`: count + md5 of `raw.payments`, `stg_payments`, `fct_payments`,
   `rpt_daily_collections`, read with `copilot_reader`) before and after. The run fails unless they are equal.
4. Snapshot: copies `raw` and `ops` table by table, from the read-only role into the sandbox, comparing per-table `count:md5` of source and copy.
5. Builds the **unpatched** project on the snapshot to get "before" metrics, then applies the allow-listed playbook files
   (`recovery/playbooks/<id>/`, which declare `replaces`) to a copy of the project in `var/validations/<id>/project`.
6. Runs stages, each recorded separately, with what each one does **not** prove:

| Stage | Proves | Does not prove |
|---|---|---|
| compile | SQL renders for target `sandbox` | correctness, safety |
| static_check | files actually changed (content diff vs repo, models + macros) ⊆ playbook `replaces`; no macro changed; sqlglot parses SELECT-only; word-bounded deny-list regex hits none (`dblink`, `pg_read_file`, `copy`, `grant`, cross-DB refs `"warehouse".`…) | absence of all dangerous constructs |
| dbt_build | executes on the snapshot | business correctness |
| data_tests | declared dbt tests hold | anything not declared |
| invariants | report reconciles with control totals; payment ids unique | correctness on other data/dates |

7. Cleanup: `DROP DATABASE … WITH (FORCE)` in `finally`. `drop_sandbox` refuses names without the `sandbox_` prefix. `gc_sandboxes`
   drops sandboxes of runs not cleaned after 1 h (`SANDBOX_TTL_S`). Each dbt step has a 300 s timeout.
- Only allow-listed playbooks run. Executing AI-generated fixes is a separate future evolution.

## Trade-offs

- A full rebuild per validation (about 50 s locally) is simple and deterministic, but slow for large data.
- "Before" is measured on the snapshot with unpatched code, not read from production, so it is an apples-to-apples comparison.

## Risks

- **Same Postgres server.** Resource contention can affect production, and a server-level compromise isn't isolated.
- `sandbox_rw` has `CREATEDB`. It could create many databases (no quota). Mitigated by gc and statement timeouts, not by a hard limit.
- dbt Jinja in playbook files runs at **compile time** on the worker, with sandbox credentials in env. The static check runs after compile.
  Today this is acceptable only because playbooks are repo files reviewed like code.
- The deny-list is a heuristic tripwire (word-bounded regex since 2026-10-09; it was a plain substring check before). It can be bypassed; it is not a safety proof.

## Evidence

- First validation attempt: the isolation matcher looked at the wrong error line. The run **refused** and still cleaned up (fail-closed).
- After the fix (DUP-01, dedupe_payments): snapshot hashes equal. compile, static_check, dbt_build, data_tests and invariants all pass.
  Isolation checks 4/4 in that first run; the fifth check (`production_warehouse_unchanged`) was added afterwards and is in later runs. Before: `fct_rows 2960, report_payments 2960, amount 11691327.25`. After: `2946, 2946, 11650312.20`.
  Invariants went fail → pass, and the sandbox was dropped.
- `tests/test_integration.py::test_isolation` and `test_drop_sandbox_refuses_other_databases`; `tests/test_unit.py::test_static_check_flags_forbidden_sql`.

## Revisit when

- AI-generated fixes are in scope. That requires an ephemeral Postgres per validation (separate container/server), compile in a
  network-less sandbox before credentials are present, and a resource quota.
- Validation time exceeds 5 min, or data exceeds about 1 GB. Use sampled or incremental snapshots.
- More than 3 playbooks exist. Consider a declarative playbook contract with property tests.
