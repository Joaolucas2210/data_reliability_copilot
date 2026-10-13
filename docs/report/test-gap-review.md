# Test gap review: 2026-10-13

Staff-level review of what the suite proves and what it does not. Measured on the round in
[`docs/evidence/round-2026-10-13`](../evidence/round-2026-10-13/RUNS.md): 51 tests, branch coverage 67.4%.
Coverage is a map of unexercised code, not a quality score; the ranking below is by blast radius.

## Closed in this round

| Gap | Test added |
|---|---|
| Authorization was checked on one endpoint/role only | `test_api_rbac_matrix_refuses_lower_roles_without_db`: every write endpoint × every lower role (and a missing header) gets 403 **before any DB access**; an unknown role gets 422 |
| Worker failure path untested (31% coverage): a crashing investigation could stay `running` forever | `test_worker_retries_then_fails_and_reopens_incident`: requeue with the error recorded, `failed` after `max_attempts`, investigation `failed`, incident back to `open`; enqueue idempotency |
| Citation edge cases only in a `__main__` self-check | whitespace-normalised quotes, blank quotes rejected, recovery dropped when it cites missing evidence, precision `None` when nothing is cited |
| Agent budget limits (`_over_limit`) never exercised | parametrised over wall time, LLM calls, input tokens and cost; unknown cost (`None`) does not trip the cost limit |
| Unknown job kinds | `test_worker_rejects_unknown_job_kinds` |
| `live.spec.ts` "no error state" assertion matched help text ("quote not found") and failed on a correct page | asserts the UI's real error states (`ErrorState`, `NotFound`, `ErrorBoundary`) |

## Open, ranked

**P0: would change a production or credibility decision**

1. **The LIVE adapter has never made a call.** `llm.py` `_call`, refusal handling and fallback sit at
   60% coverage; the unit test uses a stub. A zero-cost next step is a contract test that replays a recorded
   Messages API response (structured output, refusal, 529 → fallback) through `AnthropicLLM`.
2. **Prompt injection coverage is a proxy.** `injected_instruction_followed` only checks that DUP scenarios
   do not return `no_fault_found`. INJ-01 (an injection that tries to get a recovery approved) is still not executable.
3. **The destructive retention path is untested.** `retention.prune` is tested only with `dry_run=True`
   (43% coverage). Add a test that really deletes on a throwaway run and checks that open-incident
   runs survive.

**P1: correctness under concurrency and failure**

4. `worker.claim` uses `FOR UPDATE SKIP LOCKED`, but no test claims from two connections at once.
5. API conflict paths: 409s on review, status and validation, the double-start race guarded by
   `FOR UPDATE` on `validation_run`, and the 404s. The matrix above covers only the 403s.
6. Tool allow-lists are tested with three hand-picked hostile inputs. A property or fuzz test over
   identifiers and keys for `sample_rows`, `count_duplicates` and `read_run_log` would cover the whole input space.
7. **Test isolation.** Integration tests depend on `make demo` state and mutate the shared app DB
   (`evaluate._dismiss_open()` dismisses open incidents). The snapshot test is skipped unless an eval ran
   first. Use a per-session template database, or a fixture that builds its own runs.

**P2: measurement and hygiene**

8. Coverage is not measured in CI and has no floor. `cli.py` shows 0% because subprocesses are not measured
   (`COVERAGE_PROCESS_START`). The per-scenario injections (`scenarios.py` 58%) run only inside `drc eval`.
9. The UI has a11y and screenshot tests but no component tests, and no end-to-end approve/reject flow
   driven through the browser.
10. Migrations are exercised only on an empty DB through `make demo`. No re-apply or idempotency check exists.
11. Terraform is checked only with `fmt` + `validate`. There is no `plan` against a mock provider and no
    policy scan (tfsec/checkov).
12. The SLOs in `docs/operations/slos-and-runbooks.md` are documented but have no load test behind them
    (API p95, worker throughput).
13. The judge is uncalibrated: it still needs ≥50 human-labelled dev facts with two reviewers (see the live-eval checklist).
