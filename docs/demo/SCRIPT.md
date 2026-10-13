# Demo script: 3-4 minutes

Prepare off camera: `make setup`, `make demo`, then `make api` and `make web` in separate terminals.
Keep the demo JSON: it prints one `ui` URL plus `investigation_id`, `proposal_id` and `validation_run_id`.
The demo runs synchronously, so a worker is unnecessary for this prepared flow. Start `make worker` if
launching another investigation/validation through the UI. Run `make eval` beforehand for the evaluation page.

- **0:00-0:35: Problem.** Show the end of `make demo`, open its `ui` URL. “A green pipeline can publish
  the wrong financial report. This synthetic duplicated batch violates independent control totals.”
- **0:35-1:25: Investigation.** Open the linked investigation. Point out FAKE mode, observed facts and
  their evidence IDs/quotes. “Rules detected this. The agent investigates; citation enforcement removes
  invalid facts. A quote's existence alone does not establish the conclusion.” Show supported/refuted
  hypotheses. Explain that insufficient or contradictory evidence produces abstention (INS/CON scenarios).
- **1:25-2:25: Recovery.** Open “View sandbox validation”. Show the separate sandbox DB, isolation
  checks, unchanged production fingerprint and before/after invariants. “Validated means this playbook
  fixed this frozen snapshot. The sandbox is dropped; no production fix is applied.”
- **2:25-3:00: Human decision.** Return to the investigation. Select the local **approver** role.
  Show approve/reject and the required rejection note. On a disposable demo choose one decision;
  approval requires passed validation, rejection leaves the incident unresolved. Do not claim this is cloud auth.
- **3:00-3:40: Benchmark.** Open Evaluations or the README result table. Show A/B/C exact cause-set
  comparison. “These are FAKE policy scores, not live LLM accuracy. LIVE is not run, blocked on credentials.
  We freeze prompts/policy, choose on dev, run final once, then calibrate semantic judging with human labels.”

CLI decision alternative: `drc review <investigation_id> approve` or
`drc review <investigation_id> reject --note 'Need stronger evidence'`.
Never execute both for the same investigation; decisions are recorded in the audit trail.
