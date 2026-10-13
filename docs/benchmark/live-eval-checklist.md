# Live evaluation checklist

Status (2026-10-10): **not run (blocked on credentials)**. No LIVE accuracy, cost or groundedness result exists.

## Prepare

1. `make setup && make demo` establishes local services/migrations/packages. Activate `.venv`.
2. Provide `ANTHROPIC_API_KEY` through the shell/secret store, never a committed file or command literal.
3. Freeze commit, `llm.py` investigation prompt (`inv-v0.1`), `agent.SYSTEM`, `judge.py` (`judge-v1`),
   `fake_llm.py` (`fake-v2`) and catalog hashes before measuring. Record seeds, SDK, model and effort.
4. Compare at most two candidates: `claude-opus-5-5` / medium and `claude-sonnet-5-5` / medium.
   These IDs are listed in the [official model overview](https://platform.claude.com/docs/en/models/overview)
   (checked 2026-10-10); account access is unverified. The adapter currently fixes effort to medium.
   Verify model availability and pricing before execution; these are candidates, not a measured recommendation.
5. Live judging is ON automatically, using the same model and medium effort. Record its separate usage/cost;
   same-model bias limits interpretation. Freeze judge prompt too. Unknown cost stays null + cost_status.

## Execute and select on dev

```bash
source .venv/bin/activate
DRC_LLM_PROVIDER=anthropic DRC_LLM_MODEL=claude-opus-5-5 drc eval --split dev
# Equivalent explicit provider:
drc eval --provider anthropic --split dev
```

Predeclare N=5 dev repetitions per candidate and selection criteria before running. Preserve every run,
including errors, abstentions, unsupported statements and fallback use. Never tune on final.
Candidate selection prioritizes exact cause-set accuracy, unsupported claims and injection resilience;
use cost and latency to choose between comparable candidates. Freeze selected model and all code/prompts.
Run `drc eval --provider anthropic --split final` **once**. A harness failure must be reported and any re-run
explicitly justified with unchanged policy/prompt hashes, preserving the original artifact.
Copy raw JSON from `var/eval/`, hash manifest and completed results into `docs/evidence/live/<date>/`.

## Metrics and interpretation

- Correct outcome + **exact cause-set**, extra/missed causes (A/B/C comparison).
- Unsupported claims from deterministic citation enforcement **and** semantic judge (report separately).
- Citation precision and quote support; neither proves entailment.
- Appropriate abstention, required missing information, contradictions/refutations.
- `injected_instruction_followed` on executable DUP-01/02 (false means did not return injected no-fault).
  This is a narrow outcome proxy, not proof all instructions were ignored. INJ-01 remains non-executable;
  do not claim recovery-approval injection coverage until that scenario/tool is implemented.
- Investigation tokens/cost/latency and judge usage separately; null costs are unknown, not zero.
- Recovery validation rate, invariant violations and isolation checks; no production application.

Calibrate judge with >=50 human-labelled dev facts, two reviewers and adjudication; report label confusion,
agreement and unsupported false negatives. Include abstentions and rejected facts. Record unmeasured
metrics as not run. Complete [RESULTS_TEMPLATE](../evidence/live/RESULTS_TEMPLATE.md), with FAKE/LIVE
columns and code/hash/model references. Live path unit tests use a stub; they establish wiring, not API success.
