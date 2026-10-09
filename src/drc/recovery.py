"""Isolated recovery validation (ADR-0007).

Isolation: a fresh database `sandbox_<id>` owned by role `sandbox_rw`, which has no CONNECT on `warehouse`
or `app` (verified on every run, not assumed). The snapshot is copied by the read-only role, so no
credential used here can write to production. Only allow-listed playbooks (repo files) are applied —
AI-generated code is not executed in this phase.

Stages (recorded separately, because each proves something different):
  compile       dbt compiles against the sandbox target          (proves: SQL renders; NOT correctness)
  static_check  sqlglot parse + deny-list + changed-files check  (proves: no forbidden constructs found)
  dbt_build     dbt run on the snapshot copy                      (proves: executes on real-shaped data)
  data_tests    dbt test on the result                            (proves: declared rules hold)
  invariants    business invariants vs control totals             (proves: report reconciles)
"""

import re
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import sqlglot
import yaml
from psycopg import sql

from drc import obs, quality, store
from drc.config import ROOT, settings
from drc.domain import new_id
from drc.pipeline import dbt_env, run_dbt

PLAYBOOK_DIR = ROOT / "recovery" / "playbooks"
SNAPSHOT_SCHEMAS = ("raw", "ops")
# Word-bounded patterns over compiled SQL. A deny-list is a tripwire, not a proof of safety (see docs/architecture/recovery.md).
DENY = re.compile(
    r"\b(dblink|pg_read_file|pg_write_file|pg_read_binary_file|lo_import|lo_export|pg_terminate_backend)\b"
    r"|\bcopy\s|\bset\s+role\b|\balter\s+system\b|\bcreate\s+extension\b|\bgrant\s"
    r'|"?\b(warehouse|app|postgres)"?\s*\.',  # cross-database references
    re.IGNORECASE,
)
SANDBOX_TTL_S = 3600


def _admin() -> psycopg.Connection:
    return psycopg.connect(settings.dsn("sandbox_rw", settings.sandbox_password, "postgres"), autocommit=True)


def isolation_checks(sandbox_db: str) -> list[dict]:
    out = []
    for db in ("warehouse", "app"):
        try:
            psycopg.connect(
                settings.dsn("sandbox_rw", settings.sandbox_password, db), connect_timeout=5
            ).close()
            out.append(
                {
                    "name": f"sandbox_role_cannot_connect_{db}",
                    "passed": False,
                    "detail": "connection succeeded",
                }
            )
        except psycopg.OperationalError as e:
            msg = " ".join(str(e).split())
            denied = f'permission denied for database "{db}"' in msg
            out.append({"name": f"sandbox_role_cannot_connect_{db}", "passed": denied, "detail": msg[:400]})
    with psycopg.connect(settings.sandbox_dsn(sandbox_db)) as c:
        db, user = c.execute("select current_database(), current_user").fetchone()  # type: ignore[misc]
        superuser = c.execute("select rolsuper from pg_roles where rolname=current_user").fetchone()[0]  # type: ignore[index]
    out.append(
        {
            "name": "sandbox_target_is_sandbox_db",
            "passed": db == sandbox_db and db != "warehouse",
            "detail": db,
        }
    )
    out.append(
        {
            "name": "sandbox_role_not_superuser",
            "passed": user == "sandbox_rw" and not superuser,
            "detail": f"{user} super={superuser}",
        }
    )
    return out


def warehouse_fingerprint() -> dict[str, str]:
    """Hash of production tables relevant to the playbooks, read with the read-only role."""
    with psycopg.connect(settings.warehouse_ro_dsn) as c:
        return {
            t: _table_hash(c, sql.Identifier(*t.split(".")))
            for t in (
                "raw.payments",
                "staging.stg_payments",
                "marts.fct_payments",
                "marts.rpt_daily_collections",
            )
        }


def snapshot(sandbox_db: str, source_snapshot: str | None = None) -> dict:
    """Copy raw+ops into the sandbox with the read-only role; returns per-table row count + content hash.
    Source = the incident run's frozen schema (snap_<run_id>, tables <schema>__<table>) when it exists, so the
    validation replays the data the incident was detected on; otherwise the live raw/ops schemas."""
    manifest = {}
    with (
        psycopg.connect(settings.warehouse_ro_dsn) as src,
        psycopg.connect(settings.sandbox_dsn(sandbox_db)) as dst,
    ):
        for schema in SNAPSHOT_SCHEMAS:
            dst.execute(sql.SQL("create schema if not exists {}").format(sql.Identifier(schema)))
            src_schema, prefix = (source_snapshot, f"{schema}__") if source_snapshot else (schema, "")
            tables = [
                r[0]
                for r in src.execute(
                    "select table_name from information_schema.tables where table_schema=%s and"
                    " starts_with(table_name, %s) order by 1",
                    (src_schema, prefix),
                )
            ]
            for st in tables:
                t = st[len(prefix) :]
                cols = src.execute(
                    "select column_name, data_type from information_schema.columns where table_schema=%s"
                    " and table_name=%s order by ordinal_position",
                    (src_schema, st),
                ).fetchall()
                ident, src_ident = sql.Identifier(schema, t), sql.Identifier(src_schema, st)
                dst.execute(
                    sql.SQL("create table {} ({})").format(
                        ident,
                        sql.SQL(", ").join(
                            sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL(dt)) for c, dt in cols
                        ),
                    )
                )  # type: ignore[arg-type]
                with (
                    src.cursor().copy(sql.SQL("copy {} to stdout").format(src_ident)) as out,
                    dst.cursor().copy(sql.SQL("copy {} from stdin").format(ident)) as inp,
                ):
                    for chunk in out:
                        inp.write(chunk)
                manifest[f"{schema}.{t}"] = {
                    "source": f"{src_schema}.{st}",
                    "src": _table_hash(src, src_ident),
                    "copy": _table_hash(dst, ident),
                }
        dst.commit()
    return manifest


def _table_hash(conn: psycopg.Connection, ident: sql.Identifier) -> str:
    q = sql.SQL(
        "select count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from {} t"
    ).format(ident)
    n, h = conn.execute(q).fetchone()  # type: ignore[misc]
    return f"{n}:{h[:16]}"


def changed_files(project: Path, origin: Path) -> list[str]:
    """Files that differ between the working copy and the code the incident run executed (models + macros)."""
    out = []
    for sub in ("models", "macros"):
        for p in sorted((project / sub).rglob("*")):
            if p.is_file():
                rel = p.relative_to(project)
                orig = origin / rel
                if not orig.exists() or orig.read_bytes() != p.read_bytes():
                    out.append(str(rel))
        for p in sorted((origin / sub).rglob("*")):
            if p.is_file() and not (project / p.relative_to(origin)).exists():
                out.append(f"{p.relative_to(origin)} (deleted)")
    return out


def static_check(project: Path, playbook: dict, target_dir: Path, origin: Path | None = None) -> dict:
    changed = changed_files(
        project, origin or settings.dbt_dir
    )  # measured, not taken from the playbook's own declaration
    findings = []
    undeclared = [c for c in changed if c not in playbook["replaces"]]
    if undeclared:
        findings.append(f"files changed outside the playbook declaration: {undeclared}")
    if any(c.startswith("macros/") for c in changed):
        findings.append("macros changed")  # macros can run arbitrary SQL at compile time
    inspect = sorted(
        set(playbook["replaces"]) | {c for c in changed if c.endswith(".sql") and "(deleted)" not in c}
    )
    for rel in inspect:
        name = Path(rel).stem
        compiled = next(target_dir.rglob(f"compiled/**/{name}.sql"), None)
        if not compiled:
            findings.append(f"no compiled SQL for {name}")
            continue
        text = compiled.read_text()
        findings += [f"{name}: forbidden token {m.group(0)!r}" for m in DENY.finditer(text)]
        try:
            stmts = sqlglot.parse(text, read="postgres")
            kinds = {type(s).__name__ for s in stmts if s is not None}
            if kinds - {"Select", "Union", "With"}:
                findings.append(f"{name}: non-SELECT statements {kinds}")
        except sqlglot.errors.ParseError as e:
            findings.append(f"{name}: parse error {str(e)[:120]}")
    return {"passed": not findings, "changed_files": changed, "findings": findings}


def metrics(dsn: str) -> dict:
    with psycopg.connect(dsn) as c:
        r = c.execute(
            "select count(*), coalesce(sum(payments_count),0), coalesce(sum(collected_amount),0)"
            " from marts.rpt_daily_collections"
        ).fetchone()
        f = c.execute("select count(*), count(distinct payment_id) from marts.fct_payments").fetchone()
    return {
        "report_days": r[0],
        "report_payments": int(r[1]),
        "report_amount": str(r[2]),  # type: ignore[index]
        "fct_rows": f[0],
        "fct_distinct_payment_ids": f[1],
    }  # type: ignore[index]


def create_queued_run(conn, proposal_id: str, actor: str) -> str:
    """Create the validation run row up front (status queued) so callers get its id immediately."""
    vr_id = new_id("val")
    conn.execute(
        "insert into validation_run(id,proposal_id,status,sandbox_db,started_at) values (%s,%s,'queued',%s,now())",
        (vr_id, proposal_id, f"sandbox_{vr_id[4:]}"),
    )
    store.audit(
        conn, actor, "validation.queued", "validation", vr_id, None, "queued", proposal_id=proposal_id
    )
    return vr_id


def validate(proposal_id: str, keep_sandbox: bool = False, validation_run_id: str | None = None) -> str:
    with store.connect() as conn, conn.transaction():
        prop = conn.execute("select * from remediation_proposal where id=%s", (proposal_id,)).fetchone()
        assert prop, proposal_id
        store.transition(conn, "proposal", proposal_id, "validating", "worker")
        vr_id = validation_run_id or create_queued_run(conn, proposal_id, "worker")
        sandbox_db = f"sandbox_{vr_id[4:]}"
        conn.execute("update validation_run set started_at=now() where id=%s", (vr_id,))
        store.transition(conn, "validation", vr_id, "running", "worker")
        store.audit(
            conn,
            "worker",
            "validation.started",
            "validation",
            vr_id,
            None,
            "running",
            proposal_id=proposal_id,
        )
        run = conn.execute(
            "select r.snapshot_schema, r.project_dir from remediation_proposal p join investigation i on"
            " i.id=p.investigation_id join incident n on n.id=i.incident_id join pipeline_run r on"
            " r.id=n.last_pipeline_run_id where p.id=%s",
            (proposal_id,),
        ).fetchone()
    # replay the incident's own data and code; older runs without them fall back to live data / repo code
    origin = Path(run["project_dir"]) if run and run["project_dir"] else settings.dbt_dir
    source_snapshot = run["snapshot_schema"] if run else None
    pb_dir = PLAYBOOK_DIR / prop["playbook"]
    playbook = yaml.safe_load((pb_dir / "playbook.yaml").read_text())
    work = settings.var_dir / "validations" / vr_id
    steps: list[dict] = []
    result: dict = {"isolation_checks": [], "metrics_before": None, "metrics_after": None, "invariants": []}
    status = "error"
    with obs.tracer.start_as_current_span("recovery.validate", attributes={"validation_run_id": vr_id}):
        try:
            with _admin() as a:
                a.execute(sql.SQL("create database {}").format(sql.Identifier(sandbox_db)))
                a.execute(
                    sql.SQL("revoke connect on database {} from public").format(sql.Identifier(sandbox_db))
                )
            prod_before = warehouse_fingerprint()
            result["isolation_checks"] = iso = isolation_checks(sandbox_db)
            if not all(c["passed"] for c in iso):
                raise RuntimeError("isolation checks failed; refusing to run")
            t0 = time.monotonic()
            snap = snapshot(sandbox_db, source_snapshot)
            steps.append(
                {
                    "name": "snapshot",
                    "status": "pass" if all(v["src"] == v["copy"] for v in snap.values()) else "fail",
                    "detail": snap,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                }
            )
            env = dbt_env(
                "sandbox", {"DRC_SANDBOX_PASSWORD": settings.sandbox_password, "DRC_SANDBOX_DB": sandbox_db}
            )
            # baseline: unpatched project on the same snapshot -> "before"
            base = work / "baseline_project"
            _copy_project(base, origin)
            rc = run_dbt(["run"], work, base, env, "baseline_run")
            result["metrics_before"] = metrics(settings.sandbox_dsn(sandbox_db)) if rc == 0 else {"error": rc}
            inv_before = quality.evaluate_invariants(settings.sandbox_dsn(sandbox_db))
            # patched project
            proj = work / "project"
            _copy_project(proj, origin)
            for rel in playbook["replaces"]:
                shutil.copyfile(pb_dir / rel, proj / rel)
            steps.append(_step("compile", run_dbt(["compile"], work, proj, env, "compile")))
            sc = static_check(proj, playbook, work / "compile" / "target", origin)
            steps.append({"name": "static_check", "status": "pass" if sc["passed"] else "fail", "detail": sc})
            if sc["passed"] and steps[-2]["status"] == "pass":
                steps.append(_step("dbt_build", run_dbt(["run"], work, proj, env, "dbt_build")))
                steps.append(_step("data_tests", run_dbt(["test"], work, proj, env, "data_tests")))
                result["metrics_after"] = metrics(settings.sandbox_dsn(sandbox_db))
                inv_after = quality.evaluate_invariants(settings.sandbox_dsn(sandbox_db))
                result["invariants"] = [
                    {"name": k, "before": inv_before[k], "after": v, "passed": v["passed"]}
                    for k, v in inv_after.items()
                ]
                steps.append(
                    {
                        "name": "invariants",
                        "status": "pass" if all(i["passed"] for i in result["invariants"]) else "fail",
                        "detail": {i["name"]: i["passed"] for i in result["invariants"]},
                    }
                )
            else:
                steps += [
                    {"name": n, "status": "skipped", "detail": "previous stage failed"}
                    for n in ("dbt_build", "data_tests", "invariants")
                ]
            prod_after = warehouse_fingerprint()
            result["isolation_checks"].append(
                {
                    "name": "production_warehouse_unchanged",
                    "passed": prod_before == prod_after,
                    "detail": prod_after,
                }
            )
            status = (
                "passed"
                if all(s["status"] == "pass" for s in steps) and prod_before == prod_after
                else "failed"
            )
        except Exception as e:  # recorded; sandbox still cleaned below
            result["error"] = f"{type(e).__name__}: {str(e)[:400]}"
            obs.log("validation.error", validation_run_id=vr_id, error=result["error"])
        finally:
            cleaned = None if keep_sandbox else drop_sandbox(sandbox_db)
    with store.connect() as conn, conn.transaction():
        conn.execute(
            "update validation_run set steps=%s, metrics_before=%s, metrics_after=%s, invariants=%s,"
            " isolation_checks=%s, finished_at=now(), cleaned_up_at=%s, error=%s where id=%s",
            (
                store.j(steps),
                store.j(result["metrics_before"]),
                store.j(result["metrics_after"]),
                store.j(result["invariants"]),
                store.j(result["isolation_checks"]),
                cleaned,
                result.get("error"),
                vr_id,
            ),
        )
        store.transition(conn, "validation", vr_id, status, "worker")
        store.transition(
            conn,
            "proposal",
            proposal_id,
            "validated" if status == "passed" else "validation_failed",
            "worker",
            validation_run_id=vr_id,
        )
    obs.log("validation.finished", validation_run_id=vr_id, status=status)
    return vr_id


def _step(name: str, rc: int) -> dict:
    return {
        "name": name,
        "status": "pass" if rc == 0 else ("error" if rc == 124 else "fail"),
        "detail": {"exit_code": rc},
    }


def _copy_project(dest: Path, origin: Path) -> None:
    shutil.copytree(origin, dest, ignore=shutil.ignore_patterns("target", "logs", "*.msgpack"))


def drop_sandbox(name: str) -> datetime | None:
    if not name.startswith("sandbox_"):
        raise ValueError("refusing to drop non-sandbox database")
    with _admin() as a:
        a.execute(sql.SQL("drop database if exists {} with (force)").format(sql.Identifier(name)))
    return datetime.now(UTC)


def gc_sandboxes() -> list[str]:
    """Drop sandbox databases left behind by crashed runs: validation runs never cleaned, older than the TTL."""
    with store.connect() as conn:
        rows = conn.execute(
            "select id, sandbox_db from validation_run where cleaned_up_at is null and started_at <"
            " now() - make_interval(secs => %s)",
            (SANDBOX_TTL_S,),
        ).fetchall()
    for r in rows:
        at = drop_sandbox(r["sandbox_db"])
        with store.connect() as conn:
            conn.execute("update validation_run set cleaned_up_at=%s where id=%s", (at, r["id"]))
    return [r["sandbox_db"] for r in rows]
