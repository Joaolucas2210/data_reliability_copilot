"""Integration tests: need `make up` (Postgres) and at least one pipeline run with an incident (`make demo`)."""

import json
import os

import psycopg
import pytest

from drc import agent, quality, recovery, store, tools
from drc.config import settings

pytestmark = pytest.mark.integration


def _reachable() -> bool:
    try:
        psycopg.connect(settings.app_dsn, connect_timeout=2).close()
        return True
    except psycopg.OperationalError:
        return False


if not _reachable():
    pytest.skip("postgres not running (make up)", allow_module_level=True)


@pytest.fixture(scope="module")
def latest():
    with store.connect() as c:
        inc = c.execute(
            "select * from incident where fingerprint like 'finance_daily:%' order by opened_at desc limit 1"
        ).fetchone()
    if not inc:
        pytest.skip("no rule-detected incident yet (run `make demo`)")
    return inc


def test_isolation():
    """Sandbox role can reach only its sandbox; reader role cannot write production."""
    name = "sandbox_pytest"
    recovery.drop_sandbox(name)
    with recovery._admin() as a:
        a.execute(f'create database "{name}"')
        a.execute(f'revoke connect on database "{name}" from public')
    try:
        checks = recovery.isolation_checks(name)
        assert all(c["passed"] for c in checks), checks
    finally:
        recovery.drop_sandbox(name)
    with (
        psycopg.connect(settings.warehouse_ro_dsn) as c,
        pytest.raises(psycopg.errors.ReadOnlySqlTransaction),
    ):
        c.execute("insert into ops.control_totals values ('1900-01-01', 0, 0)")


def test_drop_sandbox_refuses_other_databases():
    with pytest.raises(ValueError):
        recovery.drop_sandbox("warehouse")


def test_detect_is_idempotent(latest):
    run_id = latest["last_pipeline_run_id"]
    with store.connect() as c:
        before = c.execute(
            "select count(*) n from quality_check_result where pipeline_run_id=%s", (run_id,)
        ).fetchone()
    assert quality.detect(run_id) == latest["id"] or latest["status"] in ("resolved", "dismissed")
    with store.connect() as c:
        after = c.execute(
            "select count(*) n from quality_check_result where pipeline_run_id=%s", (run_id,)
        ).fetchone()
    assert before == after


def test_closed_incident_cannot_be_investigated():
    with store.connect() as c:
        closed = c.execute(
            "select id from incident where status in ('resolved','dismissed') limit 1"
        ).fetchone()
    if closed:
        with pytest.raises(agent.ClosedIncidentError):
            agent.create(closed["id"], provider="fake")


def test_resume_after_crash_does_not_repeat_tool_calls(latest):
    inc = quality.report_manual(latest["last_pipeline_run_id"], "rpt_daily_collections", "pytest resume")
    inv = agent.create(inc, provider="fake")
    os.environ["DRC_FAULT_INJECT"] = "after_gather"
    with pytest.raises(RuntimeError, match="injected fault"):
        agent.run(inv)
    st = agent.run(inv)  # resume from checkpoint
    assert st["diagnosis"]["outcome"] in ("diagnosed", "abstained", "no_fault_found")
    with store.connect() as c:
        rows = c.execute(
            "select tool, args, count(*) n from tool_call where investigation_id=%s group by 1,2", (inv,)
        ).fetchall()
    assert rows and all(r["n"] == 1 for r in rows)


def test_evidence_does_not_leak_ground_truth(latest):
    with store.connect() as c:
        contents = [r["content"] for r in c.execute("select content from evidence")]
    blob = "\n".join(contents)
    for marker in (
        "DUP-0",
        "INS-0",
        "NOF-0",
        "duplicate_batch",
        "upstream_loss",
        "catalog.yaml",
        "ground truth",
    ):
        assert marker not in blob


def test_tools_refuse_non_allowlisted_inputs(latest):
    ctx = tools.ToolContext(
        "inv_test_refusals",
        latest["last_pipeline_run_id"],
        __import__("pathlib").Path(settings.var_dir / "nowhere"),
    )
    assert "refused" in tools.count_duplicates(ctx, "pg_catalog.pg_authid")[0].content
    assert "refused" in tools.sample_rows(ctx, "raw.payments; drop table x", "1")[0].content
    assert "refused" in tools.read_run_log(ctx, "../../etc/passwd")[0].content


def test_api_authorization(latest):
    from fastapi.testclient import TestClient

    from drc.api import app

    client = TestClient(app)
    assert client.post(f"/api/incidents/{latest['id']}/investigations").status_code == 403
    r = client.get(f"/api/incidents/{latest['id']}")
    assert r.status_code == 200 and r.json()["incident"]["id"] == latest["id"]
    health = client.get("/api/pipelines/health").json()
    assert health[0]["last_run"]["scenario_id"] is None  # ground truth label hidden
    with store.connect() as c:
        inv = c.execute(
            "select id from investigation where incident_id=%s limit 1", (latest["id"],)
        ).fetchone()
    if inv:
        body = client.get(f"/api/investigations/{inv['id']}").json()
        assert all(e["content"] is None for e in body["evidence"] if e["access"] == "restricted")
        assert "idempotency_key" not in json.dumps(body)


# ---------------- phase 2 ----------------


def test_pipeline_history_and_run_detail(latest):
    from fastapi.testclient import TestClient

    from drc.api import app

    client = TestClient(app)
    history = client.get("/api/pipeline-runs?limit=2")
    assert history.status_code == 200
    assert 0 < len(history.json()) <= 2
    assert all("scenario_id" not in r and "artifacts_dir" not in r for r in history.json())
    for invalid in (0, -1, 201):
        assert client.get(f"/api/pipeline-runs?limit={invalid}").status_code == 422
    assert client.get("/api/pipeline-runs/run_missing").status_code == 404
    run_id = latest["last_pipeline_run_id"]
    detail = client.get(f"/api/pipeline-runs/{run_id}").json()
    assert detail["run"]["id"] == run_id
    assert "scenario_id" not in detail["run"] and "artifacts_dir" not in detail["run"]
    assert detail["execution"]["rc_run"] == 0
    assert detail["checks"] and all(c["pipeline_run_id"] == run_id for c in detail["checks"])
    assert latest["id"] in {i["id"] for i in detail["incidents"]}
    summary = next(r for r in client.get("/api/pipeline-runs?limit=200").json() if r["id"] == run_id)
    assert summary["total_checks"] == len(detail["checks"])
    assert summary["failed_checks"] == sum(c["status"] in ("fail", "error") for c in detail["checks"])


def test_pipeline_run_without_results_is_not_reported_as_passed():
    from fastapi.testclient import TestClient

    from drc.api import app
    from drc.domain import new_id

    run_id = new_id("run")
    with store.connect() as c:
        c.execute(
            "insert into pipeline_run(id,pipeline,status,started_at,artifacts_dir,scenario_id)"
            " values (%s,'test_pending_run','running',now(),'var/test_pending_run','DUP-01')",
            (run_id,),
        )
    try:
        client = TestClient(app)
        detail = client.get(f"/api/pipeline-runs/{run_id}").json()
        assert detail["execution"] is None and detail["checks"] == []
        assert detail["run"]["snapshot_schema"] is None
        summary = client.get("/api/pipeline-runs?limit=1").json()[0]
        assert summary["id"] == run_id and summary["total_checks"] == 0
        health = client.get("/api/pipelines/health").json()[0]
        assert health["last_run"]["id"] == run_id
        assert health["checks"] == {"pass": 0, "warn": 0, "fail": 0, "error": 0, "skipped": 0}
        assert health["freshness"] == "unknown"
    finally:
        with store.connect() as c:
            c.execute("delete from pipeline_run where id=%s", (run_id,))


def _two_runs_with_snapshots():
    with store.connect() as c:
        rows = c.execute(
            "select id, artifacts_dir, snapshot_schema from pipeline_run where snapshot_schema is not null"
            " order by started_at"
        ).fetchall()
    if len(rows) < 2:
        pytest.skip("needs >=2 runs with snapshots (run `make eval`)")
    return rows[0], rows[-1]


def test_evidence_reads_the_incident_runs_snapshot_not_current_state():
    old, new = _two_runs_with_snapshots()
    from pathlib import Path

    ctx = tools.ToolContext(
        "inv_test_snapshot", old["id"], Path(old["artifacts_dir"]), old["snapshot_schema"]
    )
    ev = tools.reconcile_ingestion_batches(ctx, "payments")[0]
    assert ev.source.startswith(f"warehouse:{old['snapshot_schema']}/") and "WARNING" not in ev.content
    with psycopg.connect(settings.warehouse_ro_dsn) as c:
        snap_n = c.execute(f'select count(*) from "{old["snapshot_schema"]}"."raw__payments"').fetchone()[0]
        live_n = c.execute("select count(*) from raw.payments").fetchone()[0]
    landed = sum(int(x) for x in __import__("re").findall(r"landed=(\d+)", ev.content))
    assert snap_n > 0 and live_n > 0  # both exist; the tool counted the snapshot, not live
    assert landed <= snap_n


def test_cancel_queued_and_running(latest):
    inc = quality.report_manual(latest["last_pipeline_run_id"], "rpt_daily_collections", "pytest cancel")
    queued = agent.create(inc, provider="fake")
    assert agent.request_cancel(queued, "pytest") == "cancelled"
    assert agent.run(queued) == {"status": "cancelled"}
    running = agent.create(inc, provider="fake")
    with store.connect() as c:
        c.execute(
            "update investigation set status='running', cancel_requested_at=now() where id=%s", (running,)
        )
    agent.run(running)
    with store.connect() as c:
        assert (
            c.execute("select status from investigation where id=%s", (running,)).fetchone()["status"]
            == "cancelled"
        )
        assert (
            c.execute("select count(*) n from tool_call where investigation_id=%s", (running,)).fetchone()[
                "n"
            ]
            == 0
        )
    with pytest.raises(ValueError):
        agent.request_cancel(running, "pytest")  # terminal: refused


def test_job_heartbeat_renews_lease_only_for_owner(monkeypatch):
    import threading

    from drc import worker

    job = worker.enqueue("noop", {}, f"pytest-hb-{os.getpid()}")
    with store.connect() as c:
        c.execute(
            "update job set status='running', locked_by=%s, locked_at=now() - interval '1 hour' where id=%s",
            (worker.WORKER_ID, job),
        )
    monkeypatch.setattr(worker, "HEARTBEAT_S", 0.05)
    stop = threading.Event()
    t = threading.Thread(target=worker._heartbeat, args=(job, stop))
    t.start()
    __import__("time").sleep(0.3)
    stop.set()
    t.join()
    with store.connect() as c:
        row = c.execute(
            "select heartbeat_at, locked_at > now() - interval '1 minute' fresh from job where id=%s", (job,)
        ).fetchone()
        c.execute("update job set status='done' where id=%s", (job,))
    assert row["heartbeat_at"] is not None and row["fresh"]


def test_prune_protects_runs_of_open_incidents():
    from drc import retention

    report = retention.prune(keep_snapshots=0, run_days=0, checkpoint_days=0, dry_run=True)
    with store.connect() as c:
        open_runs = {
            r["last_pipeline_run_id"]
            for r in c.execute(
                "select last_pipeline_run_id from incident where status not in ('resolved','dismissed')"
            )
        }
    assert open_runs <= set(report["protected_runs"])
    assert not (open_runs & set(report["run_dirs_removed"]))


def test_distinct_causes_with_same_checks_do_not_merge():
    from drc import evaluate, pipeline

    # Same eval baseline and app DB, but deliberately leave LOSS open across TRF.
    evaluate._dismiss_open()
    baseline = pipeline.execute(None, 42, "none")
    assert quality.detect(baseline) is None
    loss_run = pipeline.execute("LOSS-01")
    loss = quality.detect(loss_run)
    trf_run = pipeline.execute("TRF-01")
    trf = quality.detect(trf_run)
    assert loss and trf and loss != trf
    with store.connect() as c:

        def names(run):
            return {
                r["check_name"]
                for r in c.execute(
                    "select check_name from quality_check_result where pipeline_run_id=%s "
                    "and status in ('fail','error')",
                    (run,),
                )
            }

        assert names(loss_run) == names(trf_run)
    assert quality.detect(loss_run) == loss
    assert quality.detect(trf_run) == trf


def test_eval_fake_judge_wiring_on_existing_snapshot(latest, monkeypatch):
    from drc import evaluate, scenarios

    run = latest["last_pipeline_run_id"]
    inc = quality.report_manual(run, "rpt_daily_collections", "pytest judge structural path")
    # Reuse frozen data while preserving a fresh incident; no extra pipeline needed for judge wiring.
    monkeypatch.setattr(evaluate, "_dismiss_open", lambda: None)
    monkeypatch.setattr(evaluate.pipeline, "execute", lambda *args: run)
    monkeypatch.setattr(evaluate.quality, "detect", lambda *args: inc)
    monkeypatch.setenv("DRC_JUDGE", "1")
    sc = next(s for s in scenarios.load_all() if s.id == "DUP-01")
    result = evaluate.run_scenario(sc, "fake", validate_recovery=False)
    measured = result["systems"]["C_agent_tools"]
    assert measured["judge"]["mode"] == "structural_fake"
    assert measured["judge"]["prompt_version"] == "judge-v1"
    assert measured["judge"]["usage"]["cost_usd"] is None
    assert evaluate.aggregate([result], "C_agent_tools")["judge_runs"] == 1
    assert measured["injected_instruction_followed"] == (
        measured["got"] == "no_fault_found"
    )  # same proxy for fake and live providers


def test_heartbeat_stops_after_lease_ownership_changes(monkeypatch):
    import threading

    from drc import worker
    from drc.domain import new_id

    job = worker.enqueue("noop", {}, new_id("test_lease"))
    with store.connect() as c:
        c.execute(
            "update job set status='running', locked_by='other-worker', "
            "locked_at=now() - interval '1 hour' where id=%s",
            (job,),
        )
    monkeypatch.setattr(worker, "HEARTBEAT_S", 0.01)
    stop = threading.Event()
    thread = threading.Thread(target=worker._heartbeat, args=(job, stop))
    thread.start()
    try:
        thread.join(timeout=2)
        assert not thread.is_alive()
        with store.connect() as c:
            row = c.execute(
                "select heartbeat_at, locked_at < now() - interval '120 seconds' expired "
                "from job where id=%s",
                (job,),
            ).fetchone()
        assert row["heartbeat_at"] is None and row["expired"]
    finally:
        stop.set()
        thread.join(timeout=2)
        with store.connect() as c:
            c.execute("update job set status='done' where id=%s", (job,))


def test_recovery_isolation_failure_refuses_snapshot_and_cleans_sandbox(monkeypatch):
    from drc.domain import new_id

    proposal = new_id("prop")
    with store.connect() as c:
        inserted = c.execute(
            "insert into remediation_proposal(id,investigation_id,playbook,rationale,evidence_ids,status,created_at) "
            "select %s, investigation_id,playbook,'pytest fail closed',evidence_ids,'proposed',now() "
            "from remediation_proposal order by created_at desc limit 1 returning id",
            (proposal,),
        ).fetchone()
    assert inserted, "make demo must create a recovery proposal"
    monkeypatch.setattr(
        recovery,
        "isolation_checks",
        lambda *args: [{"name": "simulated_denial_failure", "passed": False, "detail": "pytest"}],
    )
    monkeypatch.setattr(recovery, "snapshot", lambda *args: pytest.fail("snapshot must not run"))
    validation = recovery.validate(proposal)
    with store.connect() as c:
        row = c.execute(
            "select status,error,cleaned_up_at,steps,sandbox_db from validation_run where id=%s",
            (validation,),
        ).fetchone()
    assert row["status"] == "error" and "isolation checks failed" in row["error"]
    assert row["cleaned_up_at"] is not None and row["steps"] == []
    with recovery._admin() as c:
        assert (
            c.execute("select 1 from pg_database where datname=%s", (row["sandbox_db"],)).fetchone() is None
        )


# ---------------- test-gap hardening ----------------


def test_worker_retries_then_fails_and_reopens_incident(latest, monkeypatch):
    """A crashing investigation is retried, then failed; the incident goes back to open, never stuck."""
    from drc import worker

    with store.connect() as c:
        if c.execute(
            "select 1 from job where status in ('queued','running') and kind <> 'noop' limit 1"
        ).fetchone():
            pytest.skip("other claimable jobs present; worker test needs an idle queue")
    inc = quality.report_manual(latest["last_pipeline_run_id"], "rpt_daily_collections", "pytest worker fail")
    inv = agent.create(inc, provider="fake")
    with store.connect() as c:
        c.execute("update job set status='done' where kind='noop' and status in ('queued','running')")
    job_id = worker.enqueue("investigate", {"investigation_id": inv}, f"investigate:{inv}")
    assert (
        worker.enqueue("investigate", {"investigation_id": inv}, f"investigate:{inv}") == job_id
    )  # idempotent
    with store.connect() as c:
        job = c.execute("select id, max_attempts from job where id=%s", (job_id,)).fetchone()

    def crash(investigation_id):  # same start transitions as agent.run, then the process dies mid-graph
        with store.connect() as c, c.transaction():
            if (
                c.execute("select status from investigation where id=%s", (investigation_id,)).fetchone()[
                    "status"
                ]
                == "queued"
            ):
                store.transition(c, "investigation", investigation_id, "running", "pytest")
                store.transition(c, "incident", inc, "investigating", "pytest")
        raise RuntimeError("simulated worker crash")

    monkeypatch.setattr(worker.agent, "run", crash)
    for attempt in range(1, job["max_attempts"] + 1):
        with store.connect() as c:
            c.execute("update job set run_after=now() where id=%s", (job["id"],))
        assert worker.run_once()
        with store.connect() as c:
            row = c.execute("select status, attempts, error from job where id=%s", (job["id"],)).fetchone()
        assert row["attempts"] == attempt and "simulated worker crash" in row["error"]
        assert row["status"] == ("failed" if attempt == job["max_attempts"] else "queued")
    with store.connect() as c:
        assert (
            c.execute("select status from investigation where id=%s", (inv,)).fetchone()["status"] == "failed"
        )
        assert c.execute("select status from incident where id=%s", (inc,)).fetchone()["status"] == "open"
