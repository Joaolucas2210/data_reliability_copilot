"""HTTP API (FastAPI). Contract: docs/architecture/api-contract.md. Reads are bounded; writes enqueue jobs."""

import os
from typing import Annotated, Literal

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from drc import agent, obs, recovery, store, worker

AUTH_MODE = os.environ.get("DRC_AUTH_MODE", "dev")
if AUTH_MODE != "dev":
    # ADR-0013: Entra ID auth is not implemented; refuse to start rather than run unauthenticated in the cloud.
    raise RuntimeError(f"DRC_AUTH_MODE={AUTH_MODE!r} not implemented; only 'dev' (local) is supported")

Role = Literal["viewer", "investigator", "approver"]
RANK = {"viewer": 0, "investigator": 1, "approver": 2}

app = FastAPI(title="Data Reliability Copilot", version="0.1.0")
obs.setup("drc-api")


@app.exception_handler(HTTPException)
async def _err(_: Request, exc: HTTPException) -> JSONResponse:
    code = {403: "forbidden", 404: "not_found", 409: "conflict", 422: "invalid"}.get(exc.status_code, "error")
    return JSONResponse({"error": {"code": code, "message": exc.detail}}, status_code=exc.status_code)


def role(x_drc_role: Annotated[str | None, Header()] = None) -> Role:
    r = x_drc_role or "viewer"
    if r not in RANK:
        raise HTTPException(422, f"unknown role {r}")
    return r  # type: ignore[return-value]


def need(min_role: Role):
    def dep(r: Role = Depends(role)) -> Role:
        if RANK[r] < RANK[min_role]:
            raise HTTPException(403, f"role {r} cannot perform this action (needs {min_role})")
        return r

    return dep


def _one(sql: str, *args) -> dict:
    with store.connect() as conn:
        row = conn.execute(sql, args).fetchone()
    if not row:
        raise HTTPException(404, "not found")
    return row


def _all(sql: str, *args) -> list[dict]:
    with store.connect() as conn:
        return conn.execute(sql, args).fetchall()


@app.get("/api/pipelines/health")
def health(_: Role = Depends(role)) -> list[dict]:
    run = _all(
        "select id, pipeline, scenario_id, status, started_at, finished_at, dbt_version, manifest_hash"
        " from pipeline_run order by started_at desc limit 1"
    )
    if not run:
        return []
    r = run[0]
    r["scenario_id"] = None  # ground-truth label: never exposed outside the benchmark harness
    counts = {s: 0 for s in ("pass", "warn", "fail", "error")}
    fresh = "unknown"
    for c in _all("select check_type, status from quality_check_result where pipeline_run_id=%s", r["id"]):
        if c["status"] in counts:
            counts[c["status"]] += 1
        if c["check_type"] == "freshness":
            fresh = c["status"] if fresh in ("unknown", "pass") else fresh
    open_n = _all("select count(*) n from incident where status not in ('resolved','dismissed')")[0]["n"]
    return [
        {
            "pipeline": r["pipeline"],
            "last_run": r,
            "checks": counts,
            "freshness": fresh,
            "open_incidents": open_n,
        }
    ]


@app.get("/api/incidents")
def incidents(status: str | None = None, limit: int = 50, _: Role = Depends(role)) -> list[dict]:
    # "unresolved" = every non-terminal status (what the health page counts); empty/absent = all statuses
    status = status or None
    return _all(
        "select id,title,severity,status,dataset_id,occurrences,opened_at,updated_at,closed_at from incident"
        " where (%s::text is null) or (%s = 'unresolved' and status not in ('resolved','dismissed'))"
        " or status = %s order by opened_at desc limit %s",
        status,
        status,
        status,
        min(limit, 200),
    )


@app.get("/api/incidents/{incident_id}")
def incident(incident_id: str, _: Role = Depends(role)) -> dict:
    inc = _one(
        "select id,title,severity,status,dataset_id,occurrences,opened_at,updated_at,closed_at,"
        "first_pipeline_run_id,last_pipeline_run_id from incident where id=%s",
        incident_id,
    )
    checks = _all(
        "select q.* from quality_check_result q where q.pipeline_run_id=%s and"
        " (q.status in ('fail','error','warn') or q.id in (select check_id from incident_check"
        " where incident_id=%s)) order by check_type, check_name",
        inc["last_pipeline_run_id"],
        incident_id,
    )
    invs = _all(
        "select id,status,outcome,mode,llm_provider,llm_model,created_at,finished_at from investigation"
        " where incident_id=%s order by created_at desc",
        incident_id,
    )
    ids = [incident_id, inc["last_pipeline_run_id"], *[i["id"] for i in invs]]
    timeline = _all(
        "select * from audit_event where entity_id = any(%s) or (entity_type='proposal' and entity_id in"
        " (select id from remediation_proposal where investigation_id = any(%s))) order by at limit 200",
        ids,
        ids,
    )
    return {"incident": inc, "checks": checks, "timeline": timeline, "investigations": invs}


class StartBody(BaseModel):
    provider: Literal["fake", "anthropic"] | None = None


@app.post("/api/incidents/{incident_id}/investigations", status_code=202)
def start_investigation(
    incident_id: str,
    body: StartBody | None = None,
    _: Role = Depends(need("investigator")),
    idempotency_key: Annotated[str | None, Header()] = None,
) -> dict:
    _one("select id from incident where id=%s", incident_id)
    try:
        inv_id = agent.create(
            incident_id, provider=body.provider if body else None, idempotency_key=idempotency_key
        )
    except agent.ClosedIncidentError as e:
        raise HTTPException(409, str(e)) from e
    job = worker.enqueue("investigate", {"investigation_id": inv_id}, f"investigate:{inv_id}")
    return {"investigation_id": inv_id, "job_id": job}


@app.get("/api/investigations/{inv_id}")
def investigation(inv_id: str, r: Role = Depends(role)) -> dict:
    inv = _one("select * from investigation where id=%s", inv_id)
    ev = _all(
        "select e.* from evidence e join investigation_evidence ie on ie.evidence_id=e.id"
        " where ie.investigation_id=%s order by e.kind, e.id",
        inv_id,
    )
    for e in ev:
        e["redacted"] = e["access"] == "restricted" and r == "viewer"
        if e["redacted"]:
            e["content"] = None
    inv["evidence"] = ev
    inv["hypotheses"] = _all("select * from hypothesis where investigation_id=%s order by id", inv_id)
    inv["tool_calls"] = _all(
        "select tool,args,status,rows_returned,duration_ms,error,created_at from tool_call"
        " where investigation_id=%s order by created_at",
        inv_id,
    )
    inv["proposals"] = _all(
        "select p.*, (select id from validation_run v where v.proposal_id=p.id order by started_at"
        " desc limit 1) latest_validation_run_id from remediation_proposal p"
        " where investigation_id=%s",
        inv_id,
    )
    inv.pop("idempotency_key", None)
    # closure: who decided what (review) and the latest status change (e.g. who cancelled), from the audit trail
    review = _all(
        "select at, actor, detail from audit_event where entity_type='investigation' and entity_id=%s"
        " and action='investigation.status' and to_status='completed' order by at desc limit 1",
        inv_id,
    )
    inv["review"] = (
        {
            "decision": review[0]["detail"].get("decision"),
            "note": review[0]["detail"].get("note") or "",
            "reviewer": review[0]["actor"],
            "at": review[0]["at"],
        }
        if review
        else None
    )
    last = _all(
        "select at, actor, from_status, to_status from audit_event where entity_type='investigation'"
        " and entity_id=%s and to_status is not null order by at desc limit 1",
        inv_id,
    )
    inv["last_status_change"] = last[0] if last else None
    cancel = _all(
        "select actor, at from audit_event where entity_type='investigation' and entity_id=%s"
        " and action='investigation.cancel_requested' order by at desc limit 1",
        inv_id,
    )
    inv["cancel_requested_by"] = cancel[0] if cancel else None
    return inv


class ReviewBody(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""
    close_incident: Literal["resolved", "dismissed"] | None = None


@app.post("/api/investigations/{inv_id}/review")
def review(inv_id: str, body: ReviewBody, r: Role = Depends(need("approver"))) -> dict:
    inv = _one("select status from investigation where id=%s", inv_id)
    if inv["status"] != "awaiting_review":
        raise HTTPException(409, f"investigation is {inv['status']}, not awaiting_review")
    agent.review(
        inv_id, body.decision, reviewer=f"dev:{r}", note=body.note, close_incident=body.close_incident
    )
    return investigation(inv_id, r)


@app.post("/api/investigations/{inv_id}/cancel", status_code=202)
def cancel(inv_id: str, r: Role = Depends(need("investigator"))) -> dict:
    try:
        return {"result": agent.request_cancel(inv_id, actor=f"dev:{r}")}
    except LookupError as e:
        raise HTTPException(404, "not found") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


class IncidentStatusBody(BaseModel):
    to: Literal["resolved", "dismissed", "open"]
    note: str = ""


@app.post("/api/incidents/{incident_id}/status")
def set_incident_status(
    incident_id: str, body: IncidentStatusBody, r: Role = Depends(need("approver"))
) -> dict:
    """Human closure or reopening of an incident (audited). Reopening fails if another unresolved incident already
    tracks the same failure (one non-terminal incident per fingerprint)."""
    _one("select id from incident where id=%s", incident_id)
    try:
        with store.connect() as conn, conn.transaction():
            store.transition(conn, "incident", incident_id, body.to, f"dev:{r}", note=body.note)
            conn.execute(
                "update incident set closed_at = case when %s in ('resolved','dismissed') then now() end,"
                " updated_at=now() where id=%s",
                (body.to, incident_id),
            )
    except ValueError as e:
        raise HTTPException(409, f"This incident cannot move to {body.to}: {e}") from e
    except psycopg.errors.UniqueViolation as e:
        raise HTTPException(
            409, "Another unresolved incident already tracks the same failure; open that one instead."
        ) from e
    return incident(incident_id, r)


@app.post("/api/proposals/{proposal_id}/validations", status_code=202)
def start_validation(proposal_id: str, _: Role = Depends(need("investigator"))) -> dict:
    p = _one("select status from remediation_proposal where id=%s", proposal_id)
    if p["status"] not in ("proposed", "validated", "validation_failed"):
        raise HTTPException(
            409, f"This proposal is {p['status'].replace('_', ' ')}; it cannot be validated now."
        )
    with store.connect() as conn, conn.transaction():
        active = conn.execute(
            "select id from validation_run where proposal_id=%s and status in ('queued','running') for update",
            (proposal_id,),
        ).fetchone()
        if active:
            raise HTTPException(
                409, f"A validation of this proposal is already in progress ({active['id']})."
            )
        vr_id = recovery.create_queued_run(conn, proposal_id, "api")
    job = worker.enqueue(
        "validate", {"proposal_id": proposal_id, "validation_run_id": vr_id}, f"validate:{vr_id}"
    )
    return {"validation_run_id": vr_id, "job_id": job}


@app.get("/api/validation-runs/{vr_id}")
def validation_run(vr_id: str, _: Role = Depends(role)) -> dict:
    return _one(
        "select v.*, p.investigation_id, p.playbook, i.incident_id from validation_run v"
        " join remediation_proposal p on p.id=v.proposal_id join investigation i on i.id=p.investigation_id"
        " where v.id=%s",
        vr_id,
    )


@app.get("/api/evaluations/latest")
def evaluations(_: Role = Depends(role)) -> dict:
    return {
        "runs": _all(
            "select distinct on (split, system) * from eval_run order by split, system, created_at desc"
        )
    }


@app.get("/api/healthz")
def healthz() -> dict:
    _all("select 1")
    return {"ok": True}
