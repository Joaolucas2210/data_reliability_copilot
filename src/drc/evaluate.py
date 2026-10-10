"""Benchmark harness (ADR-0008). Systems compared on the same scenario runs:
  A_rules          predefined diagnosis from failing-check names (no LLM)
  B_summary_llm    LLM sees only the incident summary (check names), no tools, no evidence
  C_agent_tools    the LangGraph agent with bounded tools + citation enforcement
Scoring is deterministic against benchmark/scenarios/catalog.yaml. With provider=fake, B and C scores
measure the harness and the fake policy — NOT model quality. Results: app.eval_run + MLflow + JSON file.
"""

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from drc import agent, judge, obs, pipeline, quality, recovery, scenarios, store
from drc.config import settings
from drc.domain import Diagnosis, Evidence, HypothesisOut, new_id
from drc.llm import PROMPT_VERSION, get_llm

SYSTEMS = ("A_rules", "B_summary_llm", "C_agent_tools")


def rules_baseline(checks: list[str]) -> Diagnosis:
    """System A: a runbook keyed on failing check names (first match wins), no evidence, no abstention."""
    rules = [
        (lambda c: c.startswith("model_error_"), "schema_drift"),
        (lambda c: c.startswith("unique_") or c == "inv_payment_id_unique", "duplication"),
        (lambda c: c.startswith("freshness_"), "delay"),
        (
            lambda c: c.startswith("inv_reconciliation"),
            "record_loss",
        ),  # runbook default for reconciliation gaps
    ]
    cause = next((cause for match, cause in rules if any(match(c) for c in checks)), None)
    return Diagnosis(
        outcome="diagnosed" if cause else "no_fault_found",
        summary=f"runbook rule: {cause}",
        observed_facts=[],
        hypotheses=[HypothesisOut(id="R1", statement=cause, status="supported", cause_category=cause)]
        if cause
        else [],
        estimated_scope="unknown",
        next_step="follow runbook",
    )


def score(sc: scenarios.Scenario, d: Diagnosis | None, report: dict | None, cited_kinds: set[str]) -> dict:
    exp = sc.expected
    outcome = d.outcome if d else "no_incident"
    expected_outcome = exp["outcome"]
    causes = {h.cause_category for h in d.hypotheses if h.status == "supported"} if d else set()
    want = exp.get("cause_category")
    want_set = set(want) if isinstance(want, list) else ({want} if want else set())
    # exact cause match: an extra (wrong) supported cause makes the diagnosis incorrect
    correct = outcome == expected_outcome and (outcome != "diagnosed" or want_set == causes)
    refuted = {h.cause_category for h in d.hypotheses if h.status == "refuted"} if d else set()
    missing_text = " ".join(d.missing_information).lower() if d else ""
    return {
        "scenario_id": sc.id,
        "expected": expected_outcome,
        "got": outcome,
        "expected_cause": want,
        "got_causes": sorted(c for c in causes if c),
        "correct": correct,
        "appropriate_abstention": (outcome == "abstained") if expected_outcome == "abstained" else None,
        "false_positive_diagnosis": outcome == "diagnosed" and expected_outcome != "diagnosed",
        "unsupported_claims": len(report["unsupported_facts"]) if report else None,
        "missing_citation_ids": len(report["missing_ids"]) if report else None,
        "citation_precision": report["citation_precision"] if report else None,
        "quote_support_rate": (report["facts_supported"] / report["facts_total"])
        if report and report["facts_total"]
        else None,
        "required_kinds_cited": sorted(set(exp.get("must_cite_kinds", [])) & cited_kinds),
        "required_kinds_missing": sorted(set(exp.get("must_cite_kinds", [])) - cited_kinds),
        "missing_info_mentioned": all(
            m.replace("_", " ") in missing_text.replace("_", " ") for m in exp.get("must_mention_missing", [])
        )
        or None,
        "extra_causes": sorted(c for c in causes - want_set if c),
        "missed_causes": sorted(want_set - causes),
        "contradiction_cited": bool(d and d.contradicting_evidence)
        if exp.get("must_cite_contradiction")
        else None,
        "expected_refutation_made": (exp["hypothesis_refuted"] in refuted)
        if exp.get("hypothesis_refuted")
        else None,
        "recovery_expected": exp.get("recovery_playbook"),
        "recovery_proposed": d.recovery.playbook if d and d.recovery else None,
    }


def _dismiss_open(actor: str = "eval-harness") -> None:
    with store.connect() as conn, conn.transaction():
        for r in conn.execute(
            "select id, status from incident where status in ('open','awaiting_review')"
        ).fetchall():
            store.transition(conn, "incident", r["id"], "dismissed", actor, reason="benchmark isolation")


def run_scenario(sc: scenarios.Scenario, provider: str, validate_recovery: bool = True) -> dict:
    _dismiss_open()
    t0 = time.monotonic()
    run_id = pipeline.execute(sc.id)
    inc = quality.detect(run_id)
    detect_ms = int((time.monotonic() - t0) * 1000)
    with store.connect() as conn:
        failing = [
            r["check_name"]
            for r in conn.execute(
                "select check_name from quality_check_result where pipeline_run_id=%s and status in ('fail','error')",
                (run_id,),
            )
        ]
    detection = {
        "failing_checks": failing,
        "expected": sc.expected.get("detected_by", []),
        "detected_all": set(sc.expected.get("detected_by", [])) <= set(failing),
        "rule_false_positive": bool(failing) and not sc.expected.get("detected_by"),
        "pipeline_ms": detect_ms,
    }
    if inc is None and sc.raw.get("manual_report"):
        inc = quality.report_manual(
            run_id, sc.raw["manual_report"]["dataset"], sc.raw["manual_report"]["note"]
        )
    out: dict = {
        "scenario_id": sc.id,
        "split": sc.split,
        "run_id": run_id,
        "incident_id": inc,
        "detection": detection,
        "systems": {},
    }
    if inc is None:
        for s in SYSTEMS:
            out["systems"][s] = {**score(sc, None, None, set()), "latency_ms": 0}
        return out
    with store.connect() as conn:
        checks = conn.execute(
            "select q.check_name, q.check_type, q.status from incident_check ic join"
            " quality_check_result q on q.id=ic.check_id where incident_id=%s",
            (inc,),
        ).fetchall()
    names = [c["check_name"] for c in checks]
    # A
    t = time.monotonic()
    out["systems"]["A_rules"] = {
        **score(sc, rules_baseline(names), None, set()),
        "latency_ms": int((time.monotonic() - t) * 1000),
        "llm_calls": 0,
        "cost_usd": 0.0,
        "cost_status": "measured",
    }
    # B
    t = time.monotonic()
    llm = get_llm(provider, settings.llm_model if provider != "fake" else None)
    summary = f"Incident on {names}. Diagnose from this summary only; you have no evidence ids, so cite none."
    res = llm.complete("summary_only", agent.SYSTEM, summary, Diagnosis, {"checks": checks})
    out["systems"]["B_summary_llm"] = {
        **score(sc, res.parsed, None, set()),  # type: ignore[arg-type]
        "latency_ms": int((time.monotonic() - t) * 1000),
        "llm_calls": 1,
        "input_tokens": res.usage.get("input_tokens"),
        "cost_usd": res.usage.get("cost_usd"),
        "cost_status": res.usage.get("cost_status"),
    }
    # C
    t = time.monotonic()
    inv = agent.create(inc, provider=provider)
    st = agent.run(inv)
    d = Diagnosis.model_validate(st["diagnosis"])
    cited = {i for f in d.observed_facts for i in f.evidence_ids}
    kinds = {e["kind"] for e in st["evidence"] if e["id"] in cited}
    with store.connect() as conn:
        usage = conn.execute("select usage from investigation where id=%s", (inv,)).fetchone()["usage"]
    c: dict[str, Any] = {
        **score(sc, d, st["citation_report"], kinds),
        "latency_ms": int((time.monotonic() - t) * 1000),
        "investigation_id": inv,
        "llm_calls": usage.get("llm_calls"),
        "tool_calls": usage.get("tool_calls"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cost_usd": usage.get("cost_usd"),
        "cost_status": usage.get("cost_status"),
        "injected_instruction_followed": (d.outcome == "no_fault_found")
        if sc.expected.get("must_ignore_injected_instruction")
        else None,
    }
    if judge.enabled(provider):
        c["judge"] = judge.judge(
            d,
            [Evidence(**e) for e in st["evidence"]],
            st["citation_report"],
            provider,
            settings.llm_model if provider != "fake" else None,
        )
        c["groundedness"] = c["judge"]["overall_groundedness"]
    if validate_recovery and st.get("proposal_id"):
        vr = recovery.validate(st["proposal_id"])
        with store.connect() as conn:
            v = conn.execute(
                "select status, invariants, isolation_checks from validation_run where id=%s", (vr,)
            ).fetchone()
        c["recovery_valid"] = v["status"] == "passed"
        c["invariant_violations_after"] = len([i for i in v["invariants"] or [] if not i["passed"]])
        c["isolation_ok"] = all(i["passed"] for i in v["isolation_checks"] or [])
        c["validation_run_id"] = vr
    out["systems"]["C_agent_tools"] = c
    return out


def aggregate(results: list[dict], system: str) -> dict:
    rows = [r["systems"][system] for r in results]

    def mean(key: str) -> float | None:
        vals = [r[key] for r in rows if r.get(key) is not None]
        return round(sum(vals) / len(vals), 3) if vals else None

    costs = [r.get("cost_usd") for r in rows if "cost_usd" in r]
    return {
        "scenarios": len(rows),
        "diagnosis_accuracy": mean("correct"),
        "groundedness": mean("groundedness"),
        "judge_runs": sum("judge" in r for r in rows),
        "judge_cost_usd_total": (
            None
            if not any("judge" in r for r in rows)
            or any(r["judge"]["usage"].get("cost_usd") is None for r in rows if "judge" in r)
            else round(sum(r["judge"]["usage"]["cost_usd"] for r in rows if "judge" in r), 6)
        ),
        "unsupported_claims_total": sum(
            r["unsupported_claims"] or 0 for r in rows if r.get("unsupported_claims") is not None
        )
        if any(r.get("unsupported_claims") is not None for r in rows)
        else None,
        "citation_precision": mean("citation_precision"),
        "quote_support_rate": mean("quote_support_rate"),
        "appropriate_abstention_rate": mean("appropriate_abstention"),
        "false_positive_diagnoses": sum(1 for r in rows if r.get("false_positive_diagnosis")),
        "mean_latency_ms": mean("latency_ms"),
        "llm_calls_total": sum(r.get("llm_calls") or 0 for r in rows),
        "cost_usd_total": None if any(c is None for c in costs) else round(sum(costs), 6),  # unknown != 0
        "cost_status": "unknown"
        if any(c is None for c in costs)
        else ("estimated" if any(r.get("cost_status") == "estimated" for r in rows) else "measured"),
        "recovery_valid": sum(1 for r in rows if r.get("recovery_valid")),
        "recovery_attempted": sum(1 for r in rows if "recovery_valid" in r),
        "invariant_violations_after_recovery": sum(r.get("invariant_violations_after") or 0 for r in rows),
        "injected_instruction_followed": sum(1 for r in rows if r.get("injected_instruction_followed")),
        "extra_causes_total": sum(len(r.get("extra_causes") or []) for r in rows),
        "missed_causes_total": sum(len(r.get("missed_causes") or []) for r in rows),
        "required_evidence_kinds_missing": sum(len(r.get("required_kinds_missing") or []) for r in rows),
    }


def run(split: str = "dev", provider: str | None = None, out_dir: Path | None = None) -> dict:
    provider = provider or settings.llm_provider
    model = None if provider == "fake" else settings.llm_model
    if provider != "fake":
        get_llm(provider, model)  # validate credentials/provider before mutating benchmark state
    selected = [s for s in scenarios.load_all() if s.implemented and (split == "all" or s.split == split)]
    with obs.tracer.start_as_current_span("eval.run", attributes={"split": split, "provider": provider}):
        # a clean run first, so "last known-good run" exists for model-change comparisons (as in production)
        baseline = pipeline.execute(None, 42, "none")
        if quality.detect(baseline):
            raise RuntimeError(f"baseline run {baseline} is not clean; refusing to evaluate")
        results = [run_scenario(s, provider) for s in selected]
    detection = {
        "detected_all_rate": round(sum(r["detection"]["detected_all"] for r in results) / len(results), 3),
        "rule_false_positives": sum(r["detection"]["rule_false_positive"] for r in results),
    }
    summary: dict[str, Any] = {
        "created_at": datetime.now(UTC).isoformat(),
        "split": split,
        "provider": provider,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "judge_enabled": judge.enabled(provider),
        "judge_prompt_version": judge.PROMPT_VERSION if judge.enabled(provider) else None,
        "judge_mode": ("structural_fake" if provider == "fake" else "semantic_live")
        if judge.enabled(provider)
        else None,
        "detection": detection,
        "systems": {s: aggregate(results, s) for s in SYSTEMS},
        "results": results,
        "caveat": "provider=fake: B/C numbers measure the harness and a hand-written policy, not an LLM."
        if provider == "fake"
        else None,
    }
    out_dir = out_dir or settings.var_dir / "eval"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"eval-{split}-{provider}-{datetime.now(UTC):%Y%m%dT%H%M%S}.json"
    path.write_text(json.dumps(summary, indent=2, default=str))
    mlflow_ids = _mlflow(summary, path)
    with store.connect() as conn:
        for s in SYSTEMS:
            conn.execute(
                "insert into eval_run values (%s,now(),%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    new_id("eval"),
                    split,
                    s,
                    provider,
                    model,
                    PROMPT_VERSION,
                    store.j({**summary["systems"][s], **detection}),
                    store.j([r["systems"][s] for r in results]),
                    mlflow_ids.get(s),
                ),
            )
    summary["path"] = str(path)
    return summary


def _mlflow(summary: dict, artifact: Path) -> dict[str, str]:
    import mlflow

    mlflow.set_tracking_uri(f"sqlite:///{settings.var_dir / 'mlflow.db'}")
    if mlflow.get_experiment_by_name("drc-benchmark") is None:
        mlflow.create_experiment(
            "drc-benchmark", artifact_location=(settings.var_dir / "mlartifacts").as_uri()
        )
    mlflow.set_experiment("drc-benchmark")
    ids = {}
    for system, m in summary["systems"].items():
        with mlflow.start_run(run_name=f"{summary['split']}-{system}-{summary['provider']}") as r:
            mlflow.log_params(
                {
                    "split": summary["split"],
                    "system": system,
                    "provider": summary["provider"],
                    "model": summary["model"] or "none",
                    "prompt_version": summary["prompt_version"],
                    "judge_prompt_version": summary["judge_prompt_version"] or "off",
                }
            )
            mlflow.log_metrics(
                {k: float(v) for k, v in m.items() if isinstance(v, int | float) and not isinstance(v, bool)}
            )
            mlflow.set_tags(
                {"cost_status": m["cost_status"], "mode": "fake" if summary["provider"] == "fake" else "live"}
            )
            mlflow.log_artifact(str(artifact))
            ids[system] = r.info.run_id
    return ids
