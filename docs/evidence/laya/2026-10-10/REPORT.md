# Local Laya groundedness probe: 2026-10-10

**Measured local model inference, not FAKE inference and not live agent accuracy.** The diagnosis
inputs are 39 facts from the archived FAKE-generated dev investigations. No final-split replay or
Anthropic call occurred. This is a small exploratory probe, not human calibration or a model comparison.

## Configuration and reproduction

- Package: `laya[serve]==0.3.21`, isolated uv environment; no project dependency or lockfile change.
- Checkpoint: `convaiinnovations/laya/multilingual`, revision
  `7b928d828b7b0e022f929d9bd2e44165aa270148` (server `/health`).
- Actual device: MPS, zero recorded CPU fallbacks during the run.
- Prompt: `laya-groundedness-probe-v1`; typed `choice` over the four judge-rubric labels;
  `max_len=4096`, one fact with only its cited evidence per request.
- Inputs are explicitly untrusted; the existing structural citation gate runs before model inference.
- Eight predeclared model controls plus two citation-gate controls, then all 39 archived dev facts.
  There was one earlier HTTP smoke call with a two-label literal example to verify the API format.
- No confidence threshold, automatic approval, production provider or semantic judge integration added.
  Laya returns labels/probabilities, not the generative JSON/rationales the investigator adapter requires.

```bash
LAYA_HOST=127.0.0.1 LAYA_PORT=8081 LAYA_MODELS=multilingual \
  uv run --python 3.12 --with 'laya[serve]==0.3.21' laya-serve
# Separate terminal, existing DRC venv and local app DB with archived phase-3 dev investigations:
.venv/bin/python benchmark/laya_probe.py --self-check
.venv/bin/python benchmark/laya_probe.py
```

The script uses the fixed localhost endpoint and reads the app DB in a read-only transaction. It
persists completed cases incrementally, so failures do not erase previous answers. The archived dev
investigation IDs must remain available; this is not a portable dataset-only replay command.
No source data or evidence is sent to a hosted model service by this script.
Upstream API reference: [Laya repository](https://github.com/NandhaKishorM/laya).

## Results (one probe)

| Control | Expected | Observed | Evaluator |
|---|---|---|---|
| literal | supported | supported | Laya |
| paraphrase | supported | supported | Laya |
| contradiction | unsupported | supported | Laya |
| causal_leap | unsupported | supported | Laya |
| partial_support | weakly_supported | supported | Laya |
| non_fact | not_applicable | supported | Laya |
| injection | unsupported | supported | Laya |
| portuguese | supported | supported | Laya |
| missing_id | unsupported | unsupported | citation gate |
| invalid_quote | unsupported | unsupported | citation gate |

**3/8 model-control labels matched (37.5%).** The two structural refusals passed separately and
are excluded from that model figure. The model labelled every model control supported, including
contradiction, unsupported causal inference and the injection control. The injection result alone
cannot establish that instructions were followed: the same false support occurs without injection.
The probe demonstrates failure to reject unsupported claims with this checkpoint/rubric setup.

On the 39 unlabelled dev facts, Laya classified **37 supported / 2 unsupported**. These counts are
not semantic accuracy, ground truth, or a replacement for the catalog's exact cause-set score.
No human-labelled calibration sample or label-order robustness experiment was run. Results may be
sensitive to prompt phrasing, option order and the small hand-authored control set.

47 model requests: median end-to-end latency **28.94 ms**, observed range **21.40-446.09 ms**, on
this local MPS setup after an earlier warm-up smoke call. This is not a GPU throughput benchmark.
`confidence` ranged 0.0373-0.6868; it is distinct from `answer_confidence` (both preserved).
Compute cost is unmeasured: `cost_usd=null`, `cost_status=unknown`, never an invented zero bill.

## Decision and validation

Do **not** integrate this checkpoint as a trusted groundedness judge based on this result. Keep
citation enforcement, human review and recovery isolation authoritative. Investigating/fine-tuning
Laya, independent human labels and label-order checks would be separate work before adoption.
The frozen fake policy and investigation/judge prompts were not changed.

Validation: probe parser self-check passed (rejects unknown labels and non-finite confidence);
ruff format/lint for the probe passed; current unit suite passed. Raw request inputs and model
responses are preserved in [probe-182807.json](probe-182807.json), with adjacent SHA-256. Evidence is synthetic.
