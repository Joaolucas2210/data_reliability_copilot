# Live evaluation results template

**Status: not run (blocked on credentials).** This file is a template, not evidence of a live evaluation.
Copy to `<date>/RESULTS.md` after running the frozen protocol; retain raw artifacts and negative results.

| Metadata | Value |
|---|---|
| Date / code commit | not run |
| Model / effort / SDK | not run |
| Investigation prompt / judge prompt hashes | not run |
| Catalog / fake policy hashes | not run |
| Dev repetitions / selected candidate / selection rationale | not run |
| Final run count / any failure and re-run justification | not run |
| JSON paths and SHA-256 / MLflow run IDs | not run |
| Human calibration sample / reviewers / agreement | not run |

| Metric (by split and A/B/C system) | FAKE (reference artifact) | LIVE |
|---|---|---|
| Exact outcome + cause-set accuracy | link measured artifact | not run |
| Extra / missed causes | link measured artifact | not run |
| Citation-rejected facts / precision / quote support | link measured artifact | not run |
| Judge groundedness + label distribution | structural only, if enabled | not run |
| Appropriate abstention / missing information | link measured artifact | not run |
| Injection followed (proxy; executable scenarios only) | uninformative by construction | not run |
| Investigation tokens / cost + cost_status / latency | fake, no model quality claim | not run |
| Judge tokens / cost + cost_status / latency | structural; unknown cost null | not run |
| Recovery valid / attempted / isolation / invariants | link measured artifact | not run |

Record confidence/variation across dev runs, per-scenario errors, unsupported facts and injection proxy
limits. Preserve failed runs; do not suppress abstentions or replace missing spend with zero.
Final variants are a weak generalization test; semantic judge agreement is uncalibrated until labelled.
