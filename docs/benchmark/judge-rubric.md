# Groundedness judge — judge-v1

`src/drc/judge.py` is evaluation-only. It does not replace `citations.verify`, deterministic exact
cause-set scoring, human decisions, or recovery isolation. It grades **observed facts**, not the
whole summary, hypotheses or recovery safety. A correct diagnosis can contain unjustified facts.

| Per-fact label | Strict criterion | Weight |
|---|---|---|
| supported | Entire statement follows from cited evidence, including quantity, scope and causality. | 1 |
| weakly_supported | Only part follows, or a limited inference is required; explain the gap. | 0.5 |
| unsupported | Evidence missing, contradictory, irrelevant or insufficient for the claim. | 0 |
| not_applicable | Non-factual statement only; never an uncertain factual claim. | excluded |

Overall = mean of applicable weights, with citation-rejected facts included as zeroes. Any missing
citation IDs in the input report forces overall zero. Empty/non-applicable facts return null, not 1.
The judge returns fact indices, rationales, model, prompt version, mode and usage. Missing/duplicate/
reordered indices abort evaluation rather than silently producing a score. Invalid quotes or evidence
IDs override model scores to unsupported. No broad semantic truth is inferred from a literal quote.

Enabled by default for live evaluation, off for fake unless `DRC_JUDGE=1`. With fake provider,
`fake-judge-v1` is a conservative structural test: quote must exist and statement must occur literally
inside the quote. Paraphrases score unsupported. This is **not semantic groundedness accuracy**.
To exercise CI locally: `DRC_JUDGE=1 make eval` (fake provider). Results persist under `systems.C_agent_tools.judge`
in JSON/DB artifacts; MLflow logs aggregate groundedness, judge count and known judge cost separately
from investigation cost. Unknown judge cost remains null with `usage.cost_status=unknown`.

LIVE uses the existing Anthropic adapter and the investigation model/medium effort, a separate prompt,
and explicitly untrusted JSON input. It adds one model call per diagnosis containing observed facts.
It can share the diagnosing model's bias and can itself follow prompt injection. Scores are provisional
until calibration: label at least 50 facts from a sample of live dev runs independently by two humans,
adjudicate disagreements, report confusion matrix/agreement and unsupported false-negative rate.
Freeze rubric/prompt before final. No calibration or live judge call has been measured yet.

Abstention is welcome when evidence cannot discriminate causes. No facts means no groundedness score;
abstention quality remains the catalog's separate outcome/missing-information measurement.

## Local Laya follow-up

A separate [measured Laya probe](../evidence/laya/2026-10-10/REPORT.md) classified archived FAKE dev facts
using real local model inference. It failed several elementary negative controls; it is not integrated
into `judge.py`, not agent accuracy, and not human calibration. Anthropic evaluation remains unrun.
