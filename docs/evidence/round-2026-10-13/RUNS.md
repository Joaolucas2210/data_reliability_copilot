# Validation round — 2026-10-13

Code base `76dfbf8` plus this round's test changes (`tests/test_unit.py`, `tests/test_integration.py`,
`web/tests/live.spec.ts`). Product code and frozen policy unchanged: `freeze.sha256` matches phase 3
(`fake_llm.py` sha256[:16] `66a86a5855b34aee`). `artifacts.sha256` hashes the raw files in `raw/`.

**Provider: FAKE (`fake-v2`) for every agent number. LIVE was not run.** No Anthropic credential exists on
this machine and the owner vetoed any spend. A local generative model was not viable (no GPU, ~5 GB free RAM,
Hugging Face unreachable). Using a Claude subscription as the app's API backend was rejected: it is not
an API entitlement and would not be reproducible. System C's 1.00 measures the harness plus a hand-written
policy, **not LLM quality**.

## Environment deviation

Docker's daemon could not resolve the registry (Tailscale DNS), so `make up` failed. PostgreSQL **17.11**
(the same pinned version, `postgresql-binaries==17.11.0` from PyPI, theseus-rs builds) ran natively on
`127.0.0.1:55432`, bootstrapped with the unmodified `infra/local/init.sql`. Roles, databases, grants and
read-only/sandbox isolation are identical; the container's 512 MB / 1 CPU limits were not applied.
The remaining Makefile steps ran as written (`dbt deps`, `drc migrate`, `drc demo`, `drc eval`).
Python 3.12.14, packages from `uv.lock`; `pytest-cov 7.1.0` was installed into the venv only to measure
coverage and is not a project dependency.

## Commands and results (all exit 0 unless noted)

| Step | Result |
|---|---|
| `ruff format --check` + `ruff check` + `mypy src` | clean; 21 source files |
| `drc demo` (DUP-01) | diagnosed, 5/5 facts passed citation checks, recovery `passed` in isolated sandbox; 139.7 s wall, 152 MB max RSS |
| `pytest --cov --cov-branch` **before** | 34 passed, 1 skipped (snapshot test needs ≥2 runs); branch coverage **64.4%** |
| `DRC_JUDGE=1 drc eval --split dev` | 10 scenarios; identical to phase 3 (deterministic); 462.9 s wall, 272 MB max RSS |
| `pytest --cov --cov-branch` **after** | **51 passed, 0 skipped**; branch coverage **67.4%**; worker 31% → 78%, citations 66% → 75% |
| `npm run typecheck` / `contrast` | ok; all WCAG ratios ≥ minimum in light and dark |
| Playwright `a11y.spec.ts` (fixtures) | 18 passed |
| Playwright `live.spec.ts` (real API data) | first run 11/13: the "no error state" regex matched help text ("quote not found"). The assertion was fixed to match the UI's real error states; rerun **13/13**, 0 axe violations |
| final split | **not re-run** (phase 3 protocol: final once; policy unchanged) |

## Dev benchmark (FAKE)

| System | Exact cause-set accuracy | False-positive diagnoses | Appropriate abstention | Citation precision | Recovery valid | Invariant violations |
|---|---|---|---|---|---|---|
| A rules | 0.50 | 2 | 0.00 | – | 0/0 | 0 |
| B summary-only | 0.50 | 2 | 0.00 | – | 0/0 | 0 |
| C agent + tools | 1.00 | 0 | 1.00 | 1.00 | 1/1 | 0 |

Rule detection: 100% of expected checks fired, 0 rule false positives. The structural FAKE groundedness
score is still 0.0 (literal judge vs. paraphrased facts); see the phase-3 report.

Files: `terminal/*.txt|png` (renders of the real logs), `ui/*.png` + `ui/a11y-live-results.json`
(Playwright on the live API, demo incident `inc_01a135aa28c4ce1b6314`), `raw/` (eval JSON, pytest log,
demo log, coverage summaries).
