"""Deterministic grounding checks on a Diagnosis (ADR-0006).

Two levels, reported separately:
1. existence  — every cited evidence id was actually collected in this investigation;
2. quote      — each fact's `quote` is a verbatim (whitespace-normalised) substring of one of its cited evidences.
Passing both still does not prove the statement follows from the quote (that needs human or judge review).
Enforcement: facts failing either check are removed and reported; a `diagnosed` outcome left without any
supported fact or supported hypothesis is downgraded to `abstained`.
"""

import re

from drc.domain import Diagnosis, Evidence


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def verify(d: Diagnosis, evidence: list[Evidence]) -> tuple[Diagnosis, dict]:
    by_id = {e.id: e for e in evidence}
    cited: set[str] = set()
    missing: set[str] = set()
    kept: list = []
    unsupported: list = []
    for f in d.observed_facts:
        cited.update(f.evidence_ids)
        absent = [i for i in f.evidence_ids if i not in by_id]
        missing.update(absent)
        quote_ok = bool(f.quote.strip()) and any(
            _norm(f.quote) in _norm(by_id[i].content) for i in f.evidence_ids if i in by_id
        )
        (kept if not absent and quote_ok else unsupported).append(f)
    for h in d.hypotheses:
        for i in h.supporting_evidence_ids + h.contradicting_evidence_ids:
            cited.add(i)
            if i not in by_id:
                missing.add(i)
    for i in d.contradicting_evidence:
        cited.add(i)
        if i not in by_id:
            missing.add(i)
    if d.recovery:
        cited.update(d.recovery.evidence_ids)
        missing.update(i for i in d.recovery.evidence_ids if i not in by_id)

    hyps = [
        h.model_copy(update={"status": "inconclusive"})
        if h.status == "supported" and any(i not in by_id for i in h.supporting_evidence_ids)
        else h
        for h in d.hypotheses
    ]
    out = d.model_copy(update={"observed_facts": kept, "hypotheses": hyps})
    enforced = None
    if d.outcome == "diagnosed" and (not kept or not any(h.status == "supported" for h in hyps)):
        enforced = "downgraded diagnosed -> abstained: no fact/hypothesis survived citation checks"
        out = out.model_copy(
            update={
                "outcome": "abstained",
                "recovery": None,
                "missing_information": [*d.missing_information, enforced],
            }
        )
    if out.recovery and any(i not in by_id for i in out.recovery.evidence_ids):
        out = out.model_copy(update={"recovery": None})
        enforced = (enforced or "") + "; recovery dropped: cites missing evidence"
    report = {
        "facts_total": len(d.observed_facts),
        "facts_supported": len(kept),
        "unsupported_facts": [f.statement for f in unsupported],
        "cited_ids": len(cited),
        "existing_ids": len(cited - missing),
        "missing_ids": sorted(missing),
        "citation_precision": round(len(cited - missing) / len(cited), 3) if cited else None,
        "enforcement": enforced,
    }
    return out, report


if __name__ == "__main__":  # self-check
    from datetime import UTC, datetime

    from drc.domain import Fact, HypothesisOut

    ev = Evidence(
        id="ev_1",
        kind="invariant",
        source="s",
        pipeline_run_id=None,
        collected_at=datetime.now(UTC),
        locator="l",
        content="2026-09-28: report payments_count=28 control=14",
        content_hash="h",
    )
    good = Fact(statement="count doubled", evidence_ids=["ev_1"], quote="payments_count=28 control=14")
    bad = Fact(statement="made up", evidence_ids=["ev_9"], quote="x")
    d = Diagnosis(
        outcome="diagnosed",
        summary="s",
        observed_facts=[good, bad],
        hypotheses=[
            HypothesisOut(id="h", statement="dup", status="supported", supporting_evidence_ids=["ev_1"])
        ],
        estimated_scope="1 day",
        next_step="n",
    )
    out, rep = verify(d, [ev])
    assert rep["facts_supported"] == 1 and rep["missing_ids"] == ["ev_9"] and out.outcome == "diagnosed"
    out2, _ = verify(d.model_copy(update={"observed_facts": [bad]}), [ev])
    assert out2.outcome == "abstained"
    print("citations self-check ok")
