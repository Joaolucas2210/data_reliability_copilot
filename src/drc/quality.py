"""Deterministic detection. Four distinct mechanisms, recorded with distinct check_type:
- schema_contract: dbt model contracts (enforced at build time; failure = model error)
- data_test:       dbt data tests (row-level rules after build)
- freshness:       dbt source freshness (timeliness of raw data)
- invariant:       business invariants vs. independent control totals (this module)
- anomaly:         Elementary OSS anomaly tests (statistical; needs history to be meaningful)
Rules detect; the agent never decides whether an incident exists (ADR-0004).
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg

from drc import obs, store
from drc.config import settings
from drc.domain import new_id

INVARIANT_SQL = {
    # report must reconcile with the core-banking control totals, per business date
    "inv_reconciliation_amount": """
        select count(*) filter (where r.collected_amount is distinct from c.collected_amount) as bad,
               coalesce(sum(coalesce(r.collected_amount,0) - coalesce(c.collected_amount,0)),0) as diff
        from marts.rpt_daily_collections r full join ops.control_totals c using (business_date)""",
    "inv_reconciliation_count": """
        select count(*) filter (where r.payments_count is distinct from c.payments_count) as bad,
               coalesce(sum(coalesce(r.payments_count,0) - coalesce(c.payments_count,0)),0) as diff
        from marts.rpt_daily_collections r full join ops.control_totals c using (business_date)""",
    "inv_payment_id_unique": """
        select count(*) - count(distinct payment_id) as bad, 0 as diff from marts.fct_payments""",
}


def evaluate_invariants(dsn: str) -> dict[str, dict]:
    out = {}
    with psycopg.connect(dsn) as conn:
        for name, sql in INVARIANT_SQL.items():
            try:
                bad, diff = conn.execute(sql).fetchone()  # type: ignore[misc]
                out[name] = {"passed": bad == 0, "violations": int(bad), "diff": str(diff)}
            except psycopg.Error as e:
                conn.rollback()
                out[name] = {
                    "passed": False,
                    "violations": None,
                    "diff": None,
                    "error": str(e).splitlines()[0],
                }
    return out


def collect_checks(run_id: str, run_dir: Path) -> list[dict]:
    now = datetime.now(UTC)
    checks: list[dict] = []
    manifest = _load(run_dir / "dbt_run" / "target" / "manifest.json") or {}
    nodes = manifest.get("nodes", {})
    run_res = _load(run_dir / "dbt_run" / "target" / "run_results.json") or {"results": []}
    for r in run_res["results"]:
        if not r["unique_id"].startswith("model."):  # skip on-run hooks
            continue
        node = nodes.get(r["unique_id"], {})
        name, msg = node.get("name", r["unique_id"]), r.get("message") or ""
        contract_violation = r["status"] == "error" and "contract" in msg.lower()
        if node.get("config", {}).get("contract", {}).get("enforced"):
            # skipped (upstream failed) is NOT a contract failure; only a reported contract violation is
            st = {"success": "pass", "skipped": "skipped"}.get(
                r["status"], "fail" if contract_violation else "pass"
            )
            checks.append(_chk(run_id, "schema_contract", f"contract_{name}", name, st, msg, now))
        if r["status"] == "error" and not contract_violation:
            checks.append(_chk(run_id, "model_run", f"model_error_{name}", name, "error", msg, now))
    tests = _load(run_dir / "dbt_test" / "target" / "run_results.json") or {"results": []}
    test_nodes = (_load(run_dir / "dbt_test" / "target" / "manifest.json") or {}).get("nodes", {})
    for r in tests["results"]:
        if not r["unique_id"].startswith("test."):  # skip on-run-start/end hooks (e.g. elementary)
            continue
        node = test_nodes.get(r["unique_id"], {})
        name = node.get("name", r["unique_id"])
        ctype = "anomaly" if "elementary" in name else "data_test"
        model = (node.get("attached_node") or "").split(".")[-1] or None
        checks.append(
            _chk(run_id, ctype, name, model, r["status"], r.get("message"), now, failures=r.get("failures"))
        )
    fresh = _load(run_dir / "dbt_freshness" / "target" / "sources.json") or {"results": []}
    for r in fresh["results"]:
        src = r["unique_id"].split(".", 2)[-1]
        st = {"pass": "pass", "warn": "warn", "error": "fail", "runtime error": "error"}.get(
            r["status"], "error"
        )
        checks.append(
            _chk(
                run_id,
                "freshness",
                f"freshness_{src.replace('.', '_')}",
                src,
                st,
                f"max_loaded_at_time_ago_in_s={r.get('max_loaded_at_time_ago_in_s')}",
                now,
            )
        )
    for name, res in evaluate_invariants(settings.warehouse_ro_dsn).items():
        checks.append(
            _chk(
                run_id,
                "invariant",
                name,
                "rpt_daily_collections" if "recon" in name else "fct_payments",
                "pass" if res["passed"] else ("error" if res.get("error") else "fail"),
                json.dumps(res),
                now,
                failures=res["violations"],
                observed=res["diff"],
                expected="0",
            )
        )
    return checks


def _chk(
    run_id, ctype, name, dataset, status, message, at, failures=None, observed=None, expected=None
) -> dict:
    status = {"success": "pass"}.get(status, status)
    return {
        "id": new_id("chk"),
        "pipeline_run_id": run_id,
        "check_type": ctype,
        "check_name": name,
        "dataset_id": dataset,
        "status": status,
        "observed_value": observed,
        "expected": expected,
        "failures": failures,
        "message": (message or "")[:2000],
        "evaluated_at": at,
    }


def _load(p: Path) -> dict | None:
    return json.loads(p.read_text()) if p.exists() else None


def detect(run_id: str) -> str | None:
    """Persist check results and open/update an incident if any check failed. Re-running is idempotent:
    checks are unique per (run, check_name); an open incident with the same fingerprint is reused."""
    with store.connect() as conn:
        run = conn.execute("select * from pipeline_run where id=%s", (run_id,)).fetchone()
        assert run, run_id
        checks = collect_checks(run_id, Path(run["artifacts_dir"]))
        with conn.transaction():
            for c in checks:
                conn.execute(
                    "insert into quality_check_result(id,pipeline_run_id,check_type,check_name,dataset_id,status,"
                    "observed_value,expected,failures,message,evaluated_at) values (%(id)s,%(pipeline_run_id)s,"
                    "%(check_type)s,%(check_name)s,%(dataset_id)s,%(status)s,%(observed_value)s,%(expected)s,"
                    "%(failures)s,%(message)s,%(evaluated_at)s) on conflict (pipeline_run_id, check_name) do nothing",
                    c,
                )
            failing = conn.execute(
                "select * from quality_check_result where pipeline_run_id=%s and status in"
                " ('fail','error') order by check_name",
                (run_id,),
            ).fetchall()
            if not failing:
                return None
            return _open_incident(conn, run_id, failing)


def incident_title(check_names: list[str]) -> str:
    """Plain-language incident title from the failing checks (the check names stay visible on the incident page)."""
    phrases = []
    if any(n.startswith("model_error_") for n in check_names):
        phrases.append("A transformation failed to build")
    if any(n.startswith("contract_") for n in check_names):
        phrases.append("A model broke its schema contract")
    if any(n.startswith("unique_") or n.endswith("_unique") for n in check_names):
        phrases.append("Duplicate records")
    if any(n.startswith("freshness_") for n in check_names):
        phrases.append("Source data is late")
    if any(n.startswith("inv_reconciliation") for n in check_names):
        phrases.append("Report does not match control totals")
    if not phrases:
        phrases.append("Quality checks failed")
    n = len(check_names)
    return f"{'; '.join(phrases[:2])} ({n} failing check{'' if n == 1 else 's'})"


def _open_incident(conn: psycopg.Connection[Any], run_id: str, failing: list[dict]) -> str:
    # ponytail: fingerprint = pipeline + sorted failing check names; per-dataset grouping when incidents get noisy
    names = [f["check_name"] for f in failing]
    fingerprint = "finance_daily:" + ",".join(names)
    # re-detecting the same run (retry/replay) must not open or bump anything, whatever the incident status
    same_run = conn.execute(
        "select id from incident where fingerprint=%s and last_pipeline_run_id=%s", (fingerprint, run_id)
    ).fetchone()
    if same_run:
        return same_run["id"]
    existing = conn.execute(
        "select id from incident where fingerprint=%s and status not in ('resolved','dismissed')",
        (fingerprint,),
    ).fetchone()
    if existing:
        conn.execute(
            "update incident set occurrences=occurrences+1, last_pipeline_run_id=%s, updated_at=now(),"
            " version=version+1 where id=%s",
            (run_id, existing["id"]),
        )
        store.audit(conn, "rules", "incident.recurred", "incident", existing["id"], run_id=run_id)
        inc_id = existing["id"]
    else:
        inc_id = new_id("inc")
        sev = (
            "high" if any(f["check_type"] in ("invariant", "schema_contract") for f in failing) else "medium"
        )
        title = incident_title(names)
        dataset = next(
            (f["dataset_id"] for f in failing if f["check_type"] == "invariant"), failing[0]["dataset_id"]
        )
        conn.execute(
            "insert into incident(id,fingerprint,title,severity,status,dataset_id,first_pipeline_run_id,"
            "last_pipeline_run_id,opened_at,updated_at) values (%s,%s,%s,%s,'open',%s,%s,%s,now(),now())",
            (inc_id, fingerprint, title, sev, dataset, run_id, run_id),
        )
        store.audit(
            conn, "rules", "incident.opened", "incident", inc_id, None, "open", run_id=run_id, checks=names
        )
    for f in failing:
        conn.execute("insert into incident_check values (%s,%s) on conflict do nothing", (inc_id, f["id"]))
    obs.log("incident.detected", incident_id=inc_id, run_id=run_id, checks=names)
    return inc_id


def report_manual(run_id: str, dataset: str, note: str, actor: str = "analyst") -> str:
    """A human-reported suspicion with no failing rule. Still an incident, flagged as manual."""
    with store.connect() as conn, conn.transaction():
        inc_id = new_id("inc")
        conn.execute(
            "insert into incident(id,fingerprint,title,severity,status,dataset_id,first_pipeline_run_id,"
            "last_pipeline_run_id,opened_at,updated_at) values (%s,%s,%s,'low','open',%s,%s,%s,now(),now())",
            (inc_id, f"manual:{inc_id}", f"Manual report: {note[:120]}", dataset, run_id, run_id),
        )
        store.audit(conn, actor, "incident.reported_manually", "incident", inc_id, None, "open", note=note)
    return inc_id
