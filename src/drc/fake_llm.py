"""Deterministic fake LLM: a hand-written rule policy over the collected evidence.

It exists to exercise the workflow, persistence, citation checks and UI without credentials. It is NOT a
model and its benchmark scores measure the harness, not reasoning quality. It ignores instructions in
evidence trivially (it never reads free text as commands) — that says nothing about real-model robustness.

Policy v2 (phase 2): rules match generic evidence patterns (never scenario ids). They were written against the
dev split only and frozen before the first final-split run; final results are reported as they came out.
"""

import re

from pydantic import BaseModel

from drc.domain import Diagnosis, Fact, HypothesisOut, RecoveryProposalOut
from drc.llm import LLMResult

POLICY_VERSION = "fake-v2"
Hit = tuple[dict, str]


def _find(evidence: list[dict], kind: str | None, pattern: str) -> Hit | None:
    for e in evidence:
        if (kind is None or e["kind"] == kind) and (m := re.search(pattern, e["content"])):
            return e, m.group(0)
    return None


def _find_all(evidence: list[dict], kind: str | None, pattern: str) -> list[Hit]:
    out = []
    for e in evidence:
        if (kind is None or e["kind"] == kind) and (m := re.search(pattern, e["content"])):
            out.append((e, m.group(0)))
    return out


def _fact(statement: str, hit: Hit | None) -> Fact | None:
    return Fact(statement=statement, evidence_ids=[hit[0]["id"]], quote=hit[1]) if hit else None


def _ids(*hits: Hit | None) -> list[str]:
    return list(dict.fromkeys(h[0]["id"] for h in hits if h))


def _substantive_diff_lines(content: str) -> list[str]:
    """Changed lines of a unified diff that are not SQL comments or whitespace."""
    out = []
    for line in content.splitlines():
        if line[:1] in "+-" and not line.startswith(("+++", "---")):
            body = line[1:].strip()
            if body and not body.startswith("--"):
                out.append(line)
    return out


NEXT_STEP = {
    "duplication": "Validate the dedupe_payments playbook in an isolated sandbox, then human review.",
    "schema_drift": "Agree the new column contract with the source owner, adapt staging, re-run.",
    "delay": "Re-run the report after the missing data lands; consider gating publication on freshness.",
    "record_loss": "Re-extract the affected batches/contracts from the source and re-run.",
    "bad_join": "Revert or fix the join in the changed model; re-run and re-check uniqueness and totals.",
    "transformation_change": "Review the model change with its author; revert if unintended.",
}


class FakeLLM:
    provider: str = "fake"
    model: str | None = None

    def complete(
        self, task: str, system: str, user: str, schema: type[BaseModel], context: dict
    ) -> LLMResult:
        out = getattr(self, task)(context, schema)
        return LLMResult(
            out,
            "fake",
            None,
            {
                "input_tokens": None,
                "output_tokens": None,
                "latency_ms": 0,
                "cost_usd": None,
                "cost_status": "unknown",
            },
        )

    # --- plan: a fixed, evidence-driven request list, served 6 per round ---
    def _desired(self, ctx: dict) -> list[dict]:
        failing = {c["check_name"]: c.get("check_type") for c in ctx["checks"]}
        if not failing:
            return [{"tool": "get_check_results", "args_json": '{"only_failing": false}'}]
        reqs = [
            {"tool": "count_duplicates", "args_json": '{"dataset": "raw.payments"}'},
            {"tool": "get_ingestion_batches", "args_json": '{"table": "payments", "only_retries": true}'},
            {"tool": "reconcile_ingestion_batches", "args_json": '{"table": "payments"}'},
            {"tool": "read_ingestion_log", "args_json": '{"level": "WARN"}'},
            {"tool": "check_referential_integrity", "args_json": "{}"},
            {"tool": "get_schema", "args_json": '{"dataset": "raw.payments"}'},
        ]
        if "model_run" in failing.values():
            reqs.append(
                {"tool": "read_run_log", "args_json": '{"step": "dbt_run", "contains": "Database Error"}'}
            )
        changed = _find(
            ctx["evidence"], "model_change", r"models changed since last known-good run \S+: [^\n]+"
        )
        if changed:
            for m in re.findall(r"[a-z_]+", changed[1].rsplit(": ", 1)[1]):
                reqs.append({"tool": "get_model_diff", "args_json": f'{{"model": "{m}"}}'})
        # follow up WARN lines: read every log line of the batches they mention (INFO lines included)
        warn_text = " ".join(e["content"] for e in ctx["evidence"] if e["kind"] == "ingestion_log")
        for b in dict.fromkeys(re.findall(r'"batch_id": "([^"]+)"', warn_text)):
            reqs.append({"tool": "read_ingestion_log", "args_json": f'{{"batch_id": "{b}"}}'})
        if "unique_fct_payments_payment_id" in failing:
            reqs.append(
                {
                    "tool": "get_failing_rows_sample",
                    "args_json": '{"test_name": "unique_fct_payments_payment_id"}',
                }
            )
        return reqs

    def plan(self, ctx: dict, schema: type[BaseModel]) -> BaseModel:
        desired = self._desired(ctx)
        batch = desired[ctx["round"] * 6 : (ctx["round"] + 1) * 6]
        hyps = (
            [
                {"id": h, "statement": s, "cause_category": c}
                for h, s, c in [
                    ("H1", "Duplicate ingestion inflates the report", "duplication"),
                    ("H2", "A transformation change altered report logic", "transformation_change"),
                    ("H3", "Records were lost before the report was built", "record_loss"),
                    ("H4", "Data arrived late or incomplete", "delay"),
                    ("H5", "The source schema changed", "schema_drift"),
                    ("H6", "A join condition changed the row set", "bad_join"),
                ]
            ]
            if ctx["checks"]
            else []
        )
        # with failing checks, always allow one follow-up round driven by what round 0 collected
        done = (ctx["round"] > 0 or not ctx["checks"]) and (ctx["round"] + 1) * 6 >= len(desired)
        return schema.model_validate(
            {
                "hypotheses": hyps,
                "tool_requests": batch,
                "ready_to_conclude": done or not batch,
                "rationale": POLICY_VERSION,
            }
        )

    # --- diagnose ---
    def diagnose(self, ctx: dict, schema: type[BaseModel]) -> BaseModel:
        ev, failing = ctx["evidence"], {c["check_name"] for c in ctx["checks"]}
        mismatch_all = _find_all(ev, "invariant", r"\d{4}-\d{2}-\d{2}: report payments_count=\S+ control=\S+")
        matches = _find(ev, "invariant", r"report matches control totals on every business date")
        no_change = _find(ev, "model_change", r"no model code changes since last known-good run \S+")

        if not failing and matches:
            return Diagnosis(
                outcome="no_fault_found",
                summary="No rule failed and the report reconciles with control totals.",
                observed_facts=[
                    f
                    for f in [
                        _fact("Report reconciles with core-banking control totals", matches),
                        _fact("No model code changed since the last known-good run", no_change),
                    ]
                    if f
                ],
                hypotheses=[],
                estimated_scope="none observed",
                next_step="Close as no fault found unless the reporter provides a concrete discrepancy.",
                self_reported_confidence="medium",
            )

        failed_test = _find(
            ev, "dbt_test_result", r"check \w+ \((?:data_test|schema_contract)\) on \w+: status=fail"
        )
        facts: list[Fact | None] = [
            _fact("The report diverges from control totals", mismatch_all[0] if mismatch_all else None),
            _fact("A dbt data test failed", failed_test),
        ]
        hyps: list[HypothesisOut] = []
        causes: list[str] = []

        def support(hid: str, statement: str, cause: str, *hits: Hit | None) -> None:
            causes.append(cause)
            hyps.append(
                HypothesisOut(
                    id=hid,
                    statement=statement,
                    status="supported",
                    supporting_evidence_ids=_ids(*hits),
                    cause_category=cause,
                )
            )

        # duplication: the raw layer itself holds repeated keys
        dup_raw = _find(ev, "row_count", r"raw\.payments\.payment_id: [1-9]\d* duplicated key\(s\)")
        retry = _find(ev, "row_count", r"batch \S+ attempt=2 rows=\d+ status=loaded")
        timeout = _find(ev, "ingestion_log", r'"event": "ack_timeout"')
        if dup_raw:
            facts += [
                _fact("raw.payments contains duplicated payment_id values", dup_raw),
                _fact("A payments batch was loaded a second time (attempt 2)", retry),
                _fact("The ingestion job logged an ack timeout before the retry", timeout),
            ]
            support("H1", "A payments batch was ingested twice", "duplication", dup_raw, retry, timeout)

        # schema drift: a model failed to run AND landed source columns differ from the declared ones
        run_err = _find(ev, "run_log", r"check model_error_\w+ \(model_run\)[^\n]{0,80}")
        db_err = _find(ev, "run_log", r"Database Error[^\n]{0,160}")
        landed = _find(ev, "schema", r"landed columns of raw\.payments: [^\n]+")
        declared = _find(ev, "schema", r"declared columns of payments: [^\n]+")
        drift: list[str] = []
        if landed and declared:
            lset = set(landed[1].split(": ", 1)[1].split(", "))
            drift = sorted(set(declared[1].split(": ", 1)[1].split(", ")) - lset)
        if run_err and drift:
            facts += [
                _fact("A dbt model failed to run", run_err),
                _fact("The database rejected the model SQL", db_err),
                _fact("Columns that landed in raw.payments", landed),
                _fact("Columns declared for the payments source", declared),
            ]
            support(
                "H5",
                f"The payments source no longer matches its declared columns ({', '.join(drift)})",
                "schema_drift",
                run_err,
                landed,
                declared,
            )

        # delay: freshness breach or an extract cut off before the business day closed
        fresh = _find(ev, "freshness", r"check freshness_raw_payments \(freshness\) on [^:]+: status=fail")
        cutoff = _find(ev, "ingestion_log", r'"event": "source_window_incomplete"[^}]*')
        if fresh or cutoff:
            facts += [
                _fact("raw.payments breached its freshness SLA", fresh),
                _fact("The extract for the latest business date was cut off early", cutoff),
            ]
            support("H4", "Payments data arrived late or incomplete", "delay", fresh, cutoff)

        # record loss: declared vs landed rows per batch, or orphaned child rows
        recon = _find(
            ev, "row_count", r"payments: \d+ batches compared, [1-9]\d* with declared != landed rows"
        )
        recon_line = _find(ev, "row_count", r"batch \S+: declared=\d+ landed=\d+") if recon else None
        orphans = _find(
            ev, "row_count", r"raw\.\w+\.\w+ -> raw\.\w+\.\w+: [1-9]\d* orphan rows \(\d+ distinct keys\)"
        )
        if recon or orphans:
            facts += [
                _fact("Some batches landed fewer rows than declared", recon),
                _fact("Example batch with a row-count gap", recon_line),
                _fact("Rows reference parents missing from the extract", orphans),
            ]
            support(
                "H3",
                "Records were lost between the source and the report",
                "record_loss",
                recon,
                recon_line,
                orphans,
            )

        # code changes: substantive diff -> bad_join (join line) or transformation_change; comments only -> refuted
        diffs = [e for e in ev if e["kind"] == "model_change" and e["content"].startswith("---")]
        substantive = [(e, ln) for e in diffs for ln in _substantive_diff_lines(e["content"])]
        changed = _find(ev, "model_change", r"models changed since last known-good run \S+: [^\n]+")
        if substantive:
            joins = [(e, ln) for e, ln in substantive if re.search(r"\b(join|on)\b", ln, re.IGNORECASE)]
            hit = joins[0] if joins else substantive[0]
            facts += [
                _fact("Model code changed since the last known-good run", changed),
                _fact("Changed line in the model SQL", hit),
            ]
            if joins:
                support("H6", "A changed join condition altered the row set", "bad_join", changed, hit)
            else:
                support(
                    "H2",
                    "A transformation change altered report logic",
                    "transformation_change",
                    changed,
                    hit,
                )
        elif diffs or no_change:
            refuting = [diffs[0]["id"]] if diffs else _ids(no_change)
            hyps.append(
                HypothesisOut(
                    id="H2",
                    statement="Transformation change",
                    status="refuted",
                    contradicting_evidence_ids=refuting,
                    cause_category="transformation_change",
                )
            )
            facts.append(
                _fact("Model changes since the last known-good run, if any, are comments only", changed)
                if diffs
                else _fact("No model code changed since the last known-good run", no_change)
            )

        # contradiction: the log claims a retry that neither the batch table nor the data show
        log_retry = _find(ev, "ingestion_log", r'"attempt": 2')
        no_retry_rows = _find(ev, "row_count", r"no batches for payments \(only_retries=True\)")
        no_dups = _find(ev, "row_count", r"raw\.payments\.payment_id: 0 duplicated key\(s\)")
        contradictions = (
            _ids(log_retry, no_retry_rows, no_dups) if (log_retry and no_retry_rows and no_dups) else []
        )

        facts_ok = [f for f in facts if f]
        if not causes:
            missing = [
                "source_extract row counts from the core-banking system for the affected dates",
                "upstream extraction job logs",
            ]
            summary = (
                "The report diverges from control totals, but the available evidence does not discriminate "
                "between upstream loss, late data, or a control-total error."
            )
            if contradictions:
                summary += " The ingestion log claims a retry that neither the batch table nor the data show."
                missing.append("which record is authoritative: the ingestion log or ops.ingestion_batches")
            return Diagnosis(
                outcome="abstained",
                summary=summary,
                observed_facts=facts_ok,
                hypotheses=[
                    *hyps,
                    HypothesisOut(
                        id="H3",
                        statement="Records lost upstream of ingestion",
                        status="inconclusive",
                        cause_category="record_loss",
                    ),
                    HypothesisOut(
                        id="H4",
                        statement="Late-arriving payments",
                        status="inconclusive",
                        cause_category="delay",
                    ),
                ],
                contradicting_evidence=contradictions,
                missing_information=missing,
                estimated_scope="business dates listed in the control-total mismatch",
                next_step="Request source extract counts from the core-banking team before any recovery.",
                self_reported_confidence="low",
            )

        dates = sorted({q[:10] for _, q in mismatch_all})
        scope = (
            f"rpt_daily_collections on the listed mismatching date(s) {dates[0]}..{dates[-1]}"
            if dates
            else "rpt_daily_collections (no per-date mismatch listed)"
        )
        recovery = None
        if causes == ["duplication"] and dup_raw:
            recovery = RecoveryProposalOut(
                playbook="dedupe_payments",
                rationale="Duplicates share payment_id; keeping the earliest load restores one row per payment.",
                evidence_ids=_ids(dup_raw, retry),
            )
        return Diagnosis(
            outcome="diagnosed",
            summary="Supported cause(s): " + ", ".join(causes) + ".",
            observed_facts=facts_ok,
            hypotheses=hyps,
            contradicting_evidence=contradictions,
            missing_information=[]
            if recovery
            else ["no allow-listed recovery playbook covers this cause set"],
            estimated_scope=scope,
            next_step=" ".join(NEXT_STEP[c] for c in causes),
            recovery=recovery,
            self_reported_confidence="medium",
        )

    # --- summary only (benchmark system B) ---
    def summary_only(self, ctx: dict, schema: type[BaseModel]) -> BaseModel:
        failing = {c["check_name"] for c in ctx["checks"]}
        cause = (
            "duplication"
            if any(n.startswith("unique_") for n in failing)
            else "schema_drift"
            if any(n.startswith("model_error_") for n in failing)
            else "delay"
            if any(n.startswith("freshness_") for n in failing)
            else "record_loss"
            if failing
            else None
        )
        return Diagnosis(
            outcome="diagnosed" if failing else "no_fault_found",
            summary=f"Guess from check names only: {cause or 'unknown cause'}",
            observed_facts=[],
            hypotheses=[
                HypothesisOut(id="H1", statement=cause or "unknown", status="supported", cause_category=cause)
            ]
            if failing
            else [],
            estimated_scope="unknown",
            next_step="investigate",
        )
