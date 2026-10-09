"""App database access: migrations, audited state transitions, small query helpers."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from importlib import resources
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from drc import obs
from drc.config import settings
from drc.domain import check_transition


@contextmanager
def connect(dsn: str | None = None) -> Iterator[psycopg.Connection[Any]]:  # rows are dicts (dict_row)
    with psycopg.connect(dsn or settings.app_dsn, row_factory=dict_row) as conn:  # type: ignore[arg-type]
        yield conn


def migrate(dsn: str | None = None) -> list[str]:
    """Forward-only SQL migrations, each in its own transaction, recorded in schema_migrations."""
    applied = []
    with connect(dsn) as conn:
        conn.execute(
            "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())"
        )
        conn.execute("select pg_advisory_xact_lock(4242)")  # concurrent `migrate` calls serialize
        done = {r["name"] for r in conn.execute("select name from schema_migrations")}
        files = sorted(
            (f for f in resources.files("drc.migrations").iterdir() if f.name.endswith(".sql")),
            key=lambda f: f.name,
        )
        for f in files:
            if f.name in done:
                continue
            with conn.transaction():
                conn.execute(f.read_text())  # type: ignore[arg-type]
                conn.execute("insert into schema_migrations(name) values (%s)", (f.name,))
            applied.append(f.name)
    return applied


def audit(
    conn: psycopg.Connection[Any],
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    from_status: str | None = None,
    to_status: str | None = None,
    **detail: Any,
) -> None:
    conn.execute(
        "insert into audit_event(actor, action, entity_type, entity_id, from_status, to_status, detail, trace_id)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            actor,
            action,
            entity_type,
            entity_id,
            from_status,
            to_status,
            Jsonb(detail),
            obs.current_trace_id(),
        ),
    )


_TABLE = {
    "incident": "incident",
    "investigation": "investigation",
    "proposal": "remediation_proposal",
    "validation": "validation_run",
}


def transition(
    conn: psycopg.Connection[Any], entity: str, entity_id: str, to: str, actor: str, **detail: Any
) -> None:
    """Validated + audited status change. Rows with `version` use optimistic locking (409 on race)."""
    table = _TABLE[entity]
    row = conn.execute(f"select * from {table} where id=%s for update", (entity_id,)).fetchone()
    if row is None:
        raise LookupError(f"{entity} {entity_id} not found")
    check_transition(entity, row["status"], to)
    if "version" in row:
        conn.execute(f"update {table} set status=%s, version=version+1 where id=%s", (to, entity_id))
    else:
        conn.execute(f"update {table} set status=%s where id=%s", (to, entity_id))
    audit(conn, actor, f"{entity}.status", entity, entity_id, row["status"], to, **detail)


def j(v: Any) -> Jsonb:
    return Jsonb(json.loads(json.dumps(v, default=str)))
