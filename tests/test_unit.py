from datetime import UTC, datetime
from pathlib import Path

import pytest

from drc import citations, llm, recovery, scenarios
from drc.domain import Diagnosis, Evidence, Fact, HypothesisOut, check_transition


def _ev(i: str, content: str) -> Evidence:
    return Evidence(
        id=i,
        kind="invariant",
        source="s",
        pipeline_run_id=None,
        collected_at=datetime.now(UTC),
        locator="l",
        content=content,
        content_hash="h",
    )


def test_transitions_reject_illegal_moves():
    check_transition("incident", "open", "investigating")
    with pytest.raises(ValueError):
        check_transition("incident", "resolved", "investigating")
    with pytest.raises(ValueError):
        check_transition("proposal", "proposed", "approved")  # must be validated first


def test_decided_incident_can_be_closed():
    # a recorded decision moves the incident back to open; it must then still be resolvable or dismissable
    check_transition("incident", "awaiting_review", "open")
    check_transition("incident", "open", "resolved")
    check_transition("incident", "open", "dismissed")


def test_citations_drop_unsupported_and_downgrade():
    ev = [_ev("ev_1", "batch B attempt=2 rows=14 status=loaded")]
    paraphrase = Fact(statement="retried", evidence_ids=["ev_1"], quote="batch was retried twice")
    d = Diagnosis(
        outcome="diagnosed",
        summary="",
        observed_facts=[paraphrase],
        hypotheses=[
            HypothesisOut(id="H", statement="dup", status="supported", supporting_evidence_ids=["ev_1"])
        ],
        estimated_scope="",
        next_step="",
    )
    out, rep = citations.verify(d, ev)
    assert rep["facts_supported"] == 0 and out.outcome == "abstained"  # quote is not verbatim


def test_citations_unknown_id_marks_hypothesis_inconclusive():
    d = Diagnosis(
        outcome="diagnosed",
        summary="",
        estimated_scope="",
        next_step="",
        observed_facts=[Fact(statement="x", evidence_ids=["ev_1"], quote="rows=14")],
        hypotheses=[
            HypothesisOut(id="H", statement="dup", status="supported", supporting_evidence_ids=["ev_404"])
        ],
    )
    out, rep = citations.verify(d, [_ev("ev_1", "rows=14")])
    assert rep["missing_ids"] == ["ev_404"] and out.hypotheses[0].status == "inconclusive"
    assert out.outcome == "abstained"


def test_strict_schema_closes_objects():
    s = llm.strict_schema(Diagnosis)
    assert s["additionalProperties"] is False and set(s["required"]) == set(s["properties"])
    fact = s["properties"]["observed_facts"]["items"]
    assert fact["additionalProperties"] is False and "$ref" not in str(s)


def test_cost_unknown_is_none_not_zero():
    assert llm.cost(None, {"input_tokens": None}) == (None, "unknown")
    assert llm.cost("some-unpriced-model", {"input_tokens": 10, "output_tokens": 5}) == (None, "unknown")
    usd, status = llm.cost("claude-opus-5-5", {"input_tokens": 1_000_000, "output_tokens": 0})
    assert usd == 4.0 and status == "estimated"


def test_catalog_has_20_plus_scenarios_with_required_fields():
    all_s = scenarios.load_all()
    assert len(all_s) >= 20
    for s in all_s:
        assert {"seed", "injection", "expected", "invariants", "cleanup"} <= set(s.raw), s.id
        assert s.split in ("dev", "final")
    implemented = [s for s in all_s if s.implemented]
    assert {part for s in implemented for part in s.injection.split("+")} <= set(scenarios.INJECTIONS)
    assert {"dev", "final"} <= {s.split for s in implemented}


def _project_copy(tmp_path: Path) -> Path:
    import shutil

    proj = tmp_path / "project"
    for sub in ("models", "macros"):
        shutil.copytree(recovery.settings.dbt_dir / sub, proj / sub)
    return proj


def test_static_check_flags_forbidden_sql(tmp_path: Path):
    proj = _project_copy(tmp_path)
    (proj / "models/staging/stg_payments.sql").write_text("select 1")
    compiled = tmp_path / "target" / "compiled" / "x" / "models" / "staging"
    compiled.mkdir(parents=True)
    (compiled / "stg_payments.sql").write_text(
        "select * from dblink('host=prod', 'delete from raw.payments')"
    )
    res = recovery.static_check(proj, {"replaces": ["models/staging/stg_payments.sql"]}, tmp_path / "target")
    assert not res["passed"] and any("dblink" in f for f in res["findings"])


def test_static_check_detects_undeclared_changes(tmp_path: Path):
    proj = _project_copy(tmp_path)
    (proj / "models/marts/rpt_daily_collections.sql").write_text(
        "select 1 as x"
    )  # not declared by the playbook
    compiled = tmp_path / "target" / "compiled" / "x" / "models"
    compiled.mkdir(parents=True)
    for n in ("stg_payments", "rpt_daily_collections"):
        (compiled / f"{n}.sql").write_text("select 1 as x")
    res = recovery.static_check(proj, {"replaces": ["models/staging/stg_payments.sql"]}, tmp_path / "target")
    assert not res["passed"] and "models/marts/rpt_daily_collections.sql" in res["changed_files"]
    assert any("outside the playbook" in f for f in res["findings"])


def test_deny_list_is_word_bounded():
    assert not recovery.DENY.search('select whatsapp.id from "sandbox_x"."raw"."payments"')
    assert recovery.DENY.search('select * from "warehouse"."raw"."payments"')


# ---------------- phase 2 ----------------


def test_composite_injection_rejects_unknown_parts_before_running():
    with pytest.raises(KeyError, match="nope"):
        scenarios.apply("duplicate_batch+nope", None)  # type: ignore[arg-type]


def test_scoring_requires_exact_cause_set():
    from drc import evaluate

    sc = next(s for s in scenarios.load_all() if s.id == "MULTI-01")

    def diag(*causes):
        return Diagnosis(
            outcome="diagnosed",
            summary="",
            observed_facts=[],
            estimated_scope="",
            next_step="",
            hypotheses=[
                HypothesisOut(id=c, statement=c, status="supported", cause_category=c) for c in causes
            ],
        )

    assert evaluate.score(sc, diag("duplication", "delay"), None, set())["correct"]
    partial = evaluate.score(sc, diag("duplication"), None, set())
    assert not partial["correct"] and partial["missed_causes"] == ["delay"]
    extra = evaluate.score(sc, diag("duplication", "delay", "record_loss"), None, set())
    assert not extra["correct"] and extra["extra_causes"] == ["record_loss"]


def test_rules_baseline_cannot_abstain():
    from drc import evaluate

    assert evaluate.rules_baseline(["inv_reconciliation_amount"]).outcome == "diagnosed"
    assert (
        evaluate.rules_baseline(["model_error_stg_payments", "inv_reconciliation_amount"])
        .hypotheses[0]
        .cause_category
        == "schema_drift"
    )
    assert evaluate.rules_baseline([]).outcome == "no_fault_found"


def test_fake_policy_ignores_comment_only_diffs():
    from drc.fake_llm import _substantive_diff_lines

    cosmetic = "--- a\n+++ b\n@@ -1,2 +1,3 @@\n -- header\n+-- Owner: finance-analytics.\n select 1"
    real = "--- a\n+++ b\n@@ -1 +1 @@\n-join x i using (id)\n+join x i on i.k = p.k"
    assert _substantive_diff_lines(cosmetic) == []
    assert len(_substantive_diff_lines(real)) == 2
