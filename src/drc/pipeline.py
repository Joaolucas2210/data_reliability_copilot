"""Pipeline execution: synthetic load (+ scenario injection) -> dbt run via dbt-ol (lineage) -> dbt test
-> source freshness. Each run gets its own artifacts dir var/runs/<run_id>/ (never overwritten)."""

import hashlib
import os
import shutil
import subprocess  # noqa: S404 — fixed argv lists only, no shell
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import psycopg.sql
import yaml

from drc import obs, scenarios, store, synth
from drc.config import settings
from drc.domain import new_id

DBT_TIMEOUT_S = 300


def dbt_env(target: str = "prod", extra: dict | None = None) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("DRC_")}  # no ambient creds leak in
    env.update(
        {
            "DRC_PG_HOST": settings.pg_host,
            "DRC_PG_PORT": str(settings.pg_port),
            "DRC_DBT_TARGET": target,
            "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
            "DO_NOT_TRACK": "1",
        }
    )
    if target == "prod":
        env["DRC_DBT_PROD_PASSWORD"] = settings.dbt_prod_password
    env.update(extra or {})
    return env


def openlineage_config(run_dir: Path) -> Path:
    transports: list[dict] = [
        {"type": "file", "log_file_path": str(run_dir / "openlineage.jsonl"), "append": True}
    ]
    if settings.marquez_url:
        transports.append({"type": "http", "url": settings.marquez_url, "timeout": 5})
    cfg = {
        "transport": {
            "type": "composite",
            "continue_on_failure": True,
            "continue_on_success": True,
            "transports": transports,
        }
    }
    path = run_dir / "openlineage.yml"
    path.write_text(yaml.safe_dump(cfg))
    return path


def run_dbt(
    args: list[str], run_dir: Path, project_dir: Path, env: dict[str, str], name: str, lineage: bool = False
) -> int:
    """Run one dbt command, keep its log and artifacts under run_dir/<name>/. Returns exit code (124 = timeout)."""
    out_dir = run_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)
    exe = "dbt-ol" if lineage else "dbt"
    argv = [
        shutil.which(exe) or exe,
        *args,
        "--profiles-dir",
        str(settings.dbt_dir),
        "--project-dir",
        str(project_dir),
        "--target-path",
        str(out_dir / "target"),
        "--log-path",
        str(out_dir),
    ]
    if lineage:
        env = {
            **env,
            "OPENLINEAGE_CONFIG": str(openlineage_config(run_dir)),
            "OPENLINEAGE_NAMESPACE": "drc-local",
        }
    with obs.tracer.start_as_current_span(f"dbt.{name}") as span, (out_dir / "stdout.log").open("w") as log:
        try:
            rc = subprocess.run(
                argv,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=DBT_TIMEOUT_S,  # noqa: S603
                check=False,
            ).returncode
        except subprocess.TimeoutExpired:
            rc = 124
        span.set_attribute("dbt.exit_code", rc)
    obs.log("dbt.finished", step=name, exit_code=rc)
    return rc


def file_hash(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16] if path.exists() else None


def execute(
    scenario_id: str | None = None,
    seed: int = 42,
    injection: str = "none",
    idempotency_key: str | None = None,
) -> str:
    """Full pipeline run. Idempotent per idempotency_key: a repeated key returns the existing run id."""
    if scenario_id:
        sc = scenarios.get(scenario_id)
        seed, injection = sc.seed, sc.injection
    with store.connect() as conn:
        if idempotency_key and (
            row := conn.execute(
                "select id from pipeline_run where idempotency_key=%s", (idempotency_key,)
            ).fetchone()
        ):
            return row["id"]
    run_id = new_id("run")
    run_dir = settings.var_dir / "runs" / run_id
    (run_dir / "logs").mkdir(parents=True)
    started = datetime.now(UTC)
    with obs.tracer.start_as_current_span("pipeline.run", attributes={"run_id": run_id}):
        with store.connect() as conn:
            conn.execute(
                "insert into pipeline_run(id, pipeline, scenario_id, status, started_at, artifacts_dir,"
                " idempotency_key) values (%s,'finance_daily',%s,'running',%s,%s,%s)",
                (run_id, scenario_id, started, str(run_dir), idempotency_key),
            )
            store.audit(conn, "system", "pipeline_run.started", "pipeline_run", run_id)

        # Each run executes its own copy of the dbt project: scenario patches never touch the repo, and the
        # exact code that produced a run stays inspectable (and is what recovery validates against).
        project = run_dir / "project"
        shutil.copytree(
            settings.dbt_dir, project, ignore=shutil.ignore_patterns("target", "logs", "*.msgpack")
        )
        log = synth.IngestionLog(run_dir / "logs" / "ingestion.jsonl")
        ds = synth.generate(seed)
        tag = f"L{started:%Y%m%d%H%M}"  # neutral batch tag: must not reveal scenario
        with obs.tracer.start_as_current_span("ingestion.load"):
            synth.load(settings.warehouse_rw_dsn, ds, log, tag)
            with psycopg.connect(settings.warehouse_rw_dsn) as wconn, wconn.cursor() as cur:
                scenarios.apply(injection, scenarios.InjectCtx(cur, log, seed, project))
        log.close()

        env = dbt_env("prod")
        rc_run = run_dbt(["run"], run_dir, project, env, "dbt_run", lineage=True)
        rc_test = run_dbt(["test"], run_dir, project, env, "dbt_test") if rc_run == 0 else None
        rc_fresh = run_dbt(["source", "freshness"], run_dir, project, env, "dbt_freshness")
        snap, unreadable = snapshot_run(run_id)
        # "succeeded" = transformations ran. Test failures are quality signals, not pipeline failures.
        status = "succeeded" if rc_run == 0 else "failed"
        manifest = run_dir / "dbt_run" / "target" / "manifest.json"
        with store.connect() as conn:
            conn.execute(
                "update pipeline_run set status=%s, finished_at=now(), dbt_version=%s, manifest_hash=%s,"
                " snapshot_schema=%s, project_dir=%s where id=%s",
                (status, _dbt_version(), file_hash(manifest), snap, str(project), run_id),
            )
            store.audit(
                conn,
                "system",
                "pipeline_run.finished",
                "pipeline_run",
                run_id,
                "running",
                status,
                rc_run=rc_run,
                rc_test=rc_test,
                rc_freshness=rc_fresh,
                snapshot_unreadable=unreadable,
            )
    obs.log("pipeline.finished", run_id=run_id, status=status)
    return run_id


SNAPSHOT_SCHEMAS = ("raw", "ops", "staging", "marts")


def snapshot_run(run_id: str) -> tuple[str, list[dict]]:
    """Freeze the warehouse state this run produced into schema snap_<run_id> (tables named <schema>__<table>).
    Investigations read this copy, so evidence matches the incident's run even after later runs.
    A relation that cannot be read (e.g. a view whose cast fails on drifted data) is skipped and reported —
    the snapshot must never fail the pipeline."""
    snap, unreadable = f"snap_{run_id}", []
    with (
        psycopg.connect(settings.warehouse_rw_dsn) as c,
        obs.tracer.start_as_current_span("warehouse.snapshot"),
    ):
        c.execute(psycopg.sql.SQL("create schema {}").format(psycopg.sql.Identifier(snap)))
        rels = c.execute(
            "select table_schema, table_name from information_schema.tables where table_schema = any(%s)"
            " order by 1, 2",
            (list(SNAPSHOT_SCHEMAS),),
        ).fetchall()
        for schema, table in rels:
            try:
                with c.transaction():  # savepoint per relation
                    c.execute(
                        psycopg.sql.SQL("create table {} as select * from {}").format(
                            psycopg.sql.Identifier(snap, f"{schema}__{table}"),
                            psycopg.sql.Identifier(schema, table),
                        )
                    )
            except psycopg.Error as e:
                unreadable.append({"relation": f"{schema}.{table}", "error": str(e).splitlines()[0][:200]})
    if unreadable:
        obs.log("warehouse.snapshot_partial", run_id=run_id, unreadable=unreadable)
    return snap, unreadable


def _dbt_version() -> str:
    from dbt.version import __version__

    return __version__
