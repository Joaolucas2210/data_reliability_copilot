"""Retention: prune per-run snapshots, run artifacts, LangGraph checkpoints and span files.

Never removes anything still referenced by a non-terminal incident (its first/last run) — open investigations
must keep their evidence reproducible. Audit events and evidence rows are kept (small, and they are the record).
"""

import shutil
from datetime import UTC, datetime, timedelta

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import sql

from drc import obs, store
from drc.config import settings

SPANS_MAX_BYTES = 50 * 1024 * 1024


def _protected_runs() -> set[str]:
    with store.connect() as conn:
        rows = conn.execute(
            "select first_pipeline_run_id a, last_pipeline_run_id b from incident"
            " where status not in ('resolved','dismissed')"
        ).fetchall()
    return {r["a"] for r in rows} | {r["b"] for r in rows}


def prune(
    keep_snapshots: int = 20, run_days: int = 30, checkpoint_days: int = 30, dry_run: bool = False
) -> dict:
    protected = _protected_runs()
    with store.connect() as conn:
        runs = conn.execute(
            "select id, started_at, snapshot_schema, artifacts_dir from pipeline_run order by started_at desc"
        ).fetchall()
        threads = [
            r["id"]
            for r in conn.execute(
                "select id from investigation where status in ('completed','cancelled','failed')"
                " and coalesce(finished_at, created_at) < now() - make_interval(days => %s)",
                (checkpoint_days,),
            )
        ]
    cutoff = datetime.now(UTC) - timedelta(days=run_days)
    drop_snaps = [r for r in runs[keep_snapshots:] if r["snapshot_schema"] and r["id"] not in protected]
    drop_dirs = [r for r in runs if r["started_at"] < cutoff and r["id"] not in protected]
    report = {
        "snapshots_dropped": [r["snapshot_schema"] for r in drop_snaps],
        "run_dirs_removed": [r["id"] for r in drop_dirs],
        "checkpoint_threads_deleted": threads,
        "protected_runs": sorted(protected),
        "dry_run": dry_run,
    }
    if dry_run:
        return report
    with psycopg.connect(settings.warehouse_rw_dsn) as c:
        for r in drop_snaps:
            if not r["snapshot_schema"].startswith("snap_run_"):
                raise ValueError(f"refusing to drop non-snapshot schema {r['snapshot_schema']}")
            c.execute(
                sql.SQL("drop schema if exists {} cascade").format(sql.Identifier(r["snapshot_schema"]))
            )
    with store.connect() as conn:
        for r in drop_snaps:
            conn.execute("update pipeline_run set snapshot_schema=null where id=%s", (r["id"],))
    for r in drop_dirs:
        shutil.rmtree(r["artifacts_dir"], ignore_errors=True)
    with PostgresSaver.from_conn_string(settings.app_dsn) as saver:
        for t in threads:
            saver.delete_thread(t)
    spans = settings.var_dir / "traces" / "spans.jsonl"
    if spans.exists() and spans.stat().st_size > SPANS_MAX_BYTES:
        spans.rename(spans.with_name(f"spans-{datetime.now(UTC):%Y%m%dT%H%M%S}.jsonl"))
        report["spans_rotated"] = True
    obs.log("retention.pruned", **{k: len(v) if isinstance(v, list) else v for k, v in report.items()})
    return report
