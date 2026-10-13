# Product specification: Data Reliability Copilot (phase 1)

## Problem

A daily finance pipeline (customers → contracts → installments → payments → `rpt_daily_collections`)
can **finish successfully and still publish a wrong report**. Today the investigation is manual:
someone notices the number, then digs through dbt logs, ingestion logs, tables and recent changes.
Time to an explained diagnosis is long, and conclusions are often not traceable to evidence.

## Users

| Persona | Needs | Role in the product (ADR-0013) |
|---|---|---|
| Data engineer on call | Fast, evidence-backed explanation; safe recovery path | `investigator` |
| Analytics / finance owner | Know whether the report can be trusted, and the blast radius | `viewer` |
| Data platform lead | Approve or reject recovery; audit trail | `approver` |

## Flow (what the product does)

1. Run the pipeline and **deterministic checks** (contracts, dbt tests, freshness, business invariants, anomaly tests).
2. A failing check **opens or updates an incident** (rules decide; the agent never decides whether an incident exists).
3. Collect evidence: test results, logs, metadata, lineage, schema, model changes, bounded samples.
4. One **investigation agent** forms and tests hypotheses using bounded, read-only tools.
5. Output a **structured diagnosis**: facts (each citing evidence with a verbatim quote), hypotheses with status, contradicting evidence, missing information, scope, next step, or an **abstention**.
6. Propose recovery **only from an allow-listed playbook** when the evidence supports it.
7. **Validate recovery in an isolated sandbox** (separate DB + role) and compare before/after.
8. A human approves or rejects. Every state change is in the audit log. Nothing is applied to production in this phase.

## Scope of phase 1 (this delivery)

- Vertical slice for **duplicated payments** end to end, plus two more executable scenarios
  (insufficient evidence → abstain; no failure → no fault found), each with a held-out seed variant.
- 24-scenario catalog with ground truth (18 specified, not yet executable).
- Fake deterministic LLM mode for local runs; Anthropic adapter implemented, **not live-evaluated** (no credentials).
- UI for the six screens + component gallery; Azure Terraform reference path + AWS/GCP foundations (validate only).

### Non-goals (phase 1)

Automatic remediation in production; executing AI-generated code; multiple agents; vector store;
Airflow/Spark/Dagster; DuckDB profile; MCP server; cloud deployment (no `apply`).

## Success criteria and how they are measured

| Criterion | Measure | Where |
|---|---|---|
| Detects the failure class | `detected_all_rate` per scenario | `drc eval` → `detection` |
| Correct diagnosis | outcome + cause category vs ground truth | `diagnosis_accuracy` |
| No unsupported claims | facts failing existence/verbatim-quote checks | `unsupported_claims_total`, `citation_precision`, `quote_support_rate` |
| Abstains when it should | abstain on INS-* scenarios | `appropriate_abstention_rate` |
| Doesn't invent faults | diagnosed when ground truth is abstain/no-fault | `false_positive_diagnoses` |
| Recovery is valid | sandbox validation passed; invariants hold after | `recovery_valid`, `invariant_violations_after_recovery` |
| Cost/latency are visible | per investigation: LLM calls, tokens, cost status, latency | `investigation.usage`, MLflow |

Live-model numbers for these criteria do **not** exist yet (see `docs/report/phase-1-report.md`).

## Epistemic categories (shown distinctly in the UI)

| Category | Meaning | Source |
|---|---|---|
| Fact | Observed in evidence; cites ids + verbatim quote | `Diagnosis.observed_facts` after citation checks |
| Hypothesis | Candidate cause with status supported / refuted / inconclusive | `Diagnosis.hypotheses` |
| Recommendation | Proposed recovery playbook and next step | `Diagnosis.recovery`, `next_step` |
| Verified result | Outcome of a deterministic validation | `ValidationRun` stages + invariants |

Self-reported confidence is shown as such and is never treated as a probability.
