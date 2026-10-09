"""Authorized, bounded evidence tools for the investigation agent (ADR-0005).

Guarantees:
- No arbitrary SQL/shell. Datasets, keys, relationships and models come from allow-lists; SQL is built only
  from them.
- Warehouse access via `copilot_reader` (read-only transactions, statement_timeout=5s at role level).
- Every tool is scoped to the incident's pipeline run (passed by the runtime, never chosen by the LLM) and reads
  that run's frozen snapshot (schema `snap_<run_id>`), so evidence describes the incident's data even after
  later runs. Runs without a snapshot (pre-phase-2) fall back to live tables and say so in the evidence.
- Output = list[Evidence] with a stable content-addressed id, source, run, timestamps, version, locator, access.
- Row/line caps on every tool. Sample rows are redacted (PII columns dropped, ids kept).
- Tool content is UNTRUSTED data (logs may contain injected instructions).
"""

import difflib
import hashlib
import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from drc import obs, store
from drc.config import settings
from drc.domain import AccessClass, Evidence, EvidenceKind, evidence_id

MAX_LINES = 40
MAX_ROWS = 10
MAX_DIFF_LINES = 60

# allow-lists
DATASETS = {
    "raw.payments": (
        "payment_id",
        ["payment_id", "installment_id", "paid_at", "amount", "channel", "_batch_id", "_loaded_at"],
    ),
    "staging.stg_payments": (
        "payment_id",
        ["payment_id", "installment_id", "paid_at", "amount", "_batch_id"],
    ),
    "marts.fct_payments": ("payment_id", ["payment_id", "contract_id", "paid_date", "amount", "_batch_id"]),
    "marts.rpt_daily_collections": (
        "business_date",
        ["business_date", "payments_count", "collected_amount", "contracts_paid"],
    ),
    "raw.customers": ("customer_id", ["customer_id", "segment", "region"]),  # name (PII) never returned
    "raw.contracts": (
        "contract_id",
        ["contract_id", "customer_id", "principal", "n_installments", "start_date"],
    ),
    "raw.installments": ("installment_id", ["installment_id", "contract_id", "seq", "due_date", "amount"]),
}
RESTRICTED = {"raw.customers", "raw.contracts"}  # customer-linked: restricted access class
INGESTED_TABLES = ("payments", "installments", "contracts", "customers")
RELATIONSHIPS = [  # (child dataset, fk column, parent dataset, pk column)
    ("raw.payments", "installment_id", "raw.installments", "installment_id"),
    ("raw.installments", "contract_id", "raw.contracts", "contract_id"),
    ("raw.contracts", "customer_id", "raw.customers", "customer_id"),
]


@dataclass
class ToolContext:
    investigation_id: str
    pipeline_run_id: str
    run_dir: Path
    snapshot_schema: str | None = None


def _rel(ctx: ToolContext, dataset: str) -> str:
    """SQL relation for an allow-listed dataset in this run's snapshot. Only called with allow-listed names."""
    if not ctx.snapshot_schema:
        return dataset
    schema, table = dataset.split(".")
    return f'"{ctx.snapshot_schema}"."{schema}__{table}"'


def _src(ctx: ToolContext, dataset: str) -> str:
    return f"warehouse:{ctx.snapshot_schema or 'LIVE'}/{dataset}"


def _ev(
    ctx: ToolContext,
    kind: EvidenceKind,
    source: str,
    locator: str,
    content: str,
    version: str | None = None,
    observed_at: datetime | None = None,
    access: AccessClass = "internal",
) -> Evidence:
    if source.startswith("warehouse:LIVE"):
        content = (
            f"WARNING: no snapshot for run {ctx.pipeline_run_id}; this reflects the CURRENT warehouse, which may "
            f"come from a later run.\n{content}"
        )
    content = content[:4000]
    h = hashlib.sha256(content.encode()).hexdigest()[:16]
    return Evidence(
        id=evidence_id(source, locator, h),
        kind=kind,
        source=source,
        pipeline_run_id=ctx.pipeline_run_id,
        collected_at=datetime.now(UTC),
        observed_at=observed_at,
        version=version or ctx.snapshot_schema,
        locator=locator,
        content=content,
        content_hash=h,
        access=access,
    )  # type: ignore[arg-type]


def _refused(ctx: ToolContext, kind: EvidenceKind, tool: str, what: str, why: str) -> list[Evidence]:
    return [_ev(ctx, kind, f"tool:{tool}", f"refused/{what}", f"refused: {why}")]


def _ro() -> psycopg.Connection[Any]:
    conn = psycopg.connect(settings.warehouse_ro_dsn, row_factory=dict_row)  # type: ignore[arg-type]
    conn.read_only = True
    return conn


def _manifest(run_dir: Path) -> dict:
    return json.loads((run_dir / "dbt_run" / "target" / "manifest.json").read_text())


def _baseline_run(ctx: ToolContext) -> dict | None:
    """Last known-good run before this one: transformations succeeded and no check failed or errored."""
    with store.connect() as conn:
        return conn.execute(
            "select r.id, r.artifacts_dir from pipeline_run r where r.id < %s and r.status='succeeded'"
            " and not exists (select 1 from quality_check_result q where q.pipeline_run_id=r.id"
            " and q.status in ('fail','error')) order by r.id desc limit 1",
            (ctx.pipeline_run_id,),
        ).fetchone()


# ---------------- tools ----------------


def get_check_results(ctx: ToolContext, only_failing: bool = True) -> list[Evidence]:
    """Rule results for this run: model runs, contracts, dbt tests, freshness, invariants, anomalies."""
    with store.connect() as conn:
        rows = conn.execute(
            "select * from quality_check_result where pipeline_run_id=%s"
            + (" and status in ('fail','error','warn')" if only_failing else "")
            + " order by check_type, check_name limit 50",
            (ctx.pipeline_run_id,),
        ).fetchall()
    kind_of: dict[str, EvidenceKind] = {
        "data_test": "dbt_test_result",
        "schema_contract": "dbt_test_result",
        "anomaly": "dbt_test_result",
        "model_run": "run_log",
        "freshness": "freshness",
        "invariant": "invariant",
    }
    return [
        _ev(
            ctx,
            kind_of[r["check_type"]],
            f"check:{r['check_type']}",
            f"quality_check_result/{r['check_name']}",
            f"check {r['check_name']} ({r['check_type']}) on {r['dataset_id']}: status={r['status']}"
            f" failures={r['failures']} observed={r['observed_value']} expected={r['expected']}"
            f" message={(r['message'] or '')[:300]}",
            observed_at=r["evaluated_at"],
        )
        for r in rows
    ] or [
        _ev(ctx, "dbt_test_result", "check:all", "none_failing", "no failing or warning checks in this run")
    ]


def get_failing_rows_sample(ctx: ToolContext, test_name: str) -> list[Evidence]:
    """Run the *compiled* SQL of a failing dbt test (repo code, not LLM text) on the snapshot, with a row cap."""
    with store.connect() as conn:
        ok = conn.execute(
            "select 1 from quality_check_result where pipeline_run_id=%s and check_name=%s and"
            " check_type='data_test' and status='fail'",
            (ctx.pipeline_run_id, test_name),
        ).fetchone()
    if not ok:
        return _refused(
            ctx,
            "dbt_test_result",
            "get_failing_rows_sample",
            test_name,
            f"{test_name} is not a failing data test of this run",
        )
    compiled = next((ctx.run_dir / "dbt_test" / "target" / "compiled").rglob(f"{test_name}.sql"), None)
    if compiled is None:
        return _refused(
            ctx, "dbt_test_result", "get_failing_rows_sample", test_name, "compiled SQL not found"
        )
    sql = compiled.read_text()
    if ctx.snapshot_schema:  # point warehouse relations at the run's snapshot
        sql = re.sub(r'"warehouse"\."(\w+)"\."(\w+)"', rf'"{ctx.snapshot_schema}"."\1__\2"', sql)
    with _ro() as conn:
        rows = conn.execute(f"select * from ({sql}) t limit {MAX_ROWS}").fetchall()
    return [
        _ev(
            ctx,
            "dbt_test_result",
            f"file:{compiled.relative_to(settings.var_dir)}",
            f"rows[0:{len(rows)}]",
            f"failing rows of {test_name} (max {MAX_ROWS}): " + json.dumps(rows, default=str),
            version=hashlib.sha256(sql.encode()).hexdigest()[:12],
        )
    ]


def count_duplicates(ctx: ToolContext, dataset: str) -> list[Evidence]:
    """Duplicated keys of an allow-listed dataset, broken down by ingestion batch."""
    if dataset not in DATASETS:
        return _refused(ctx, "row_count", "count_duplicates", dataset, f"{dataset} not allowed")
    key = DATASETS[dataset][0]
    by_batch = "_batch_id" if "_batch_id" in DATASETS[dataset][1] else "null"
    rel = _rel(ctx, dataset)
    with _ro() as conn:
        rows = conn.execute(f"""
            with d as (select {key} from {rel} group by {key} having count(*) > 1)
            select {by_batch} as batch_id, count(*) as rows_with_duplicated_key, count(distinct t.{key}) as keys
            from {rel} t join d using ({key}) group by 1 order by 2 desc limit {MAX_ROWS}""").fetchall()
    total = sum(r["keys"] for r in rows)
    lines = [f"{dataset}.{key}: {total} duplicated key(s)"] + [
        f"batch {r['batch_id']}: {r['rows_with_duplicated_key']} rows share {r['keys']} duplicated keys"
        for r in rows
    ]
    return [_ev(ctx, "row_count", _src(ctx, dataset), f"duplicates/{key}", "\n".join(lines))]


def get_ingestion_batches(
    ctx: ToolContext, table: str = "payments", only_retries: bool = False
) -> list[Evidence]:
    """Ingestion batch metadata (ops.ingestion_batches): attempts, declared row counts, load times."""
    if table not in INGESTED_TABLES:
        return _refused(ctx, "row_count", "get_ingestion_batches", table, f"{table} not allowed")
    rel = _rel(ctx, "ops.ingestion_batches")
    with _ro() as conn:
        rows = conn.execute(
            f"select batch_id, table_name, row_count, attempt, status, loaded_at from {rel} where table_name=%s"
            + (f" and batch_id in (select batch_id from {rel} where attempt > 1)" if only_retries else "")
            + " order by batch_id desc, attempt limit %s",
            (table, MAX_ROWS * 2),
        ).fetchall()
    content = (
        "\n".join(
            f"batch {r['batch_id']} attempt={r['attempt']} rows={r['row_count']} status={r['status']}"
            f" loaded_at={r['loaded_at']:%Y-%m-%dT%H:%MZ}"
            for r in rows
        )
        or f"no batches for {table} (only_retries={only_retries})"
    )
    return [
        _ev(
            ctx,
            "row_count",
            _src(ctx, "ops.ingestion_batches"),
            f"table={table};only_retries={only_retries}",
            content,
        )
    ]


def reconcile_ingestion_batches(ctx: ToolContext, table: str = "payments") -> list[Evidence]:
    """Declared rows per ingestion batch (sum over attempts) vs rows actually landed in raw; mismatches only."""
    if table not in INGESTED_TABLES:
        return _refused(ctx, "row_count", "reconcile_ingestion_batches", table, f"{table} not allowed")
    b, r = _rel(ctx, "ops.ingestion_batches"), _rel(ctx, f"raw.{table}")
    with _ro() as conn:
        rows = conn.execute(
            f"""
            with declared as (select batch_id, sum(row_count) n, max(attempt) attempts from {b}
                              where table_name=%s group by 1),
                 landed as (select _batch_id batch_id, count(*) n from {r} group by 1)
            select coalesce(d.batch_id, l.batch_id) batch_id, d.n declared, l.n landed, d.attempts
            from declared d full join landed l using (batch_id)""",
            (table,),
        ).fetchall()
    bad = [x for x in rows if x["declared"] != x["landed"]]
    head = f"{table}: {len(rows)} batches compared, {len(bad)} with declared != landed rows"
    lines = [
        f"batch {x['batch_id']}: declared={x['declared']} landed={x['landed']} attempts={x['attempts']}"
        for x in sorted(bad, key=lambda x: x["batch_id"] or "", reverse=True)[:MAX_ROWS]
    ]
    return [_ev(ctx, "row_count", _src(ctx, f"raw.{table}"), f"reconcile/{table}", "\n".join([head, *lines]))]


def check_referential_integrity(ctx: ToolContext) -> list[Evidence]:
    """Orphan rows for the allow-listed raw relationships (payments->installments->contracts->customers)."""
    out = []
    with _ro() as conn:
        for child, fk, parent, pk in RELATIONSHIPS:
            row = conn.execute(
                f"select count(*) n, count(distinct c.{fk}) k from {_rel(ctx, child)} c"
                f" left join {_rel(ctx, parent)} p on p.{pk} = c.{fk} where p.{pk} is null"
            ).fetchone()
            out.append(f"{child}.{fk} -> {parent}.{pk}: {row['n']} orphan rows ({row['k']} distinct keys)")
    return [_ev(ctx, "row_count", _src(ctx, "raw.*"), "orphans/raw", "\n".join(out))]


def read_ingestion_log(
    ctx: ToolContext, level: str | None = None, batch_id: str | None = None
) -> list[Evidence]:
    """Ingestion job log lines (JSONL), filtered, capped. UNTRUSTED content."""
    path = ctx.run_dir / "logs" / "ingestion.jsonl"
    if not path.exists():
        return [_ev(ctx, "ingestion_log", "file:ingestion.jsonl", "not_found", "ingestion log not available")]
    hits = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        rec = json.loads(line)
        if (level and rec.get("level") != level) or (batch_id and rec.get("batch_id") != batch_id):
            continue
        hits.append((n, line))
    hits = hits[-MAX_LINES:]
    rel = path.relative_to(settings.var_dir)
    return [
        _ev(ctx, "ingestion_log", f"file:{rel}", f"L{n}", line, version=_file_ver(path)) for n, line in hits
    ] or [
        _ev(
            ctx,
            "ingestion_log",
            f"file:{rel}",
            f"filter:level={level};batch={batch_id}",
            "no matching log lines",
        )
    ]


def read_run_log(ctx: ToolContext, step: str = "dbt_test", contains: str | None = None) -> list[Evidence]:
    """dbt stdout for a step (dbt_run|dbt_test|dbt_freshness): only FAIL/ERROR/WARN lines or lines containing a term."""
    if step not in ("dbt_run", "dbt_test", "dbt_freshness"):
        return _refused(ctx, "run_log", "read_run_log", step, f"unknown step {step}")
    path = ctx.run_dir / step / "stdout.log"
    if not path.exists():
        return [_ev(ctx, "run_log", f"file:{step}/stdout.log", "not_found", f"log for {step} not available")]
    out = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if (contains and contains in line) or (
            not contains and any(k in line for k in ("FAIL", "ERROR", "WARN"))
        ):
            out.append(
                _ev(
                    ctx,
                    "run_log",
                    f"file:{path.relative_to(settings.var_dir)}",
                    f"L{n}",
                    _strip_ansi(line),
                    version=_file_ver(path),
                )
            )
    return out[:MAX_LINES] or [
        _ev(ctx, "run_log", f"file:{step}/stdout.log", f"filter:{contains}", "no matching lines")
    ]


def get_schema(ctx: ToolContext, dataset: str) -> list[Evidence]:
    """Columns as landed in this run's snapshot vs columns declared in the run's dbt manifest (models + sources)."""
    if dataset not in DATASETS:
        return _refused(ctx, "schema", "get_schema", dataset, f"{dataset} not allowed")
    schema, table = dataset.split(".")
    sch, tbl = (ctx.snapshot_schema, f"{schema}__{table}") if ctx.snapshot_schema else (schema, table)
    with _ro() as conn:
        cols = conn.execute(
            "select column_name, data_type from information_schema.columns where table_schema=%s and"
            " table_name=%s order by ordinal_position",
            (sch, tbl),
        ).fetchall()
    live = ", ".join(f"{c['column_name']}:{c['data_type']}" for c in cols) or "relation not present"
    manifest = _manifest(ctx.run_dir)
    node = next(
        (
            n
            for n in [*manifest["nodes"].values(), *manifest.get("sources", {}).values()]
            if n.get("name") == table and n.get("resource_type") in ("model", "source")
        ),
        None,
    )
    declared = ", ".join(f"{k}:{v.get('data_type')}" for k, v in (node or {}).get("columns", {}).items()) or (
        "none declared"
    )
    return [
        _ev(
            ctx,
            "schema",
            _src(ctx, dataset),
            "information_schema.columns",
            f"landed columns of {dataset}: {live}",
        ),
        _ev(
            ctx,
            "schema",
            "dbt:manifest",
            f"{(node or {}).get('resource_type', 'node')}/{table}/columns",
            f"declared columns of {table}: {declared}",
            version=manifest["metadata"].get("dbt_version"),
        ),
    ]


def get_model_changes(ctx: ToolContext) -> list[Evidence]:
    """Models whose code checksum changed vs. the last known-good run (succeeded, no failing checks)."""
    base = _baseline_run(ctx)
    prev_path = Path(base["artifacts_dir"]) / "dbt_run" / "target" / "manifest.json" if base else None
    if not prev_path or not prev_path.exists():
        return [
            _ev(ctx, "model_change", "dbt:manifest", "baseline/none", "no known-good run to compare against")
        ]
    cur_m, prev_m = _manifest(ctx.run_dir), json.loads(prev_path.read_text())

    def sums(m: dict) -> dict[str, str]:
        return {
            n["name"]: n["checksum"]["checksum"]
            for k, n in m["nodes"].items()
            if k.startswith("model.drc_finance.")
        }

    a, b = sums(prev_m), sums(cur_m)
    changed = sorted(k for k in b if a.get(k) != b[k])
    content = (
        f"models changed since last known-good run {base['id']}: {', '.join(changed)}"
        if changed
        else f"no model code changes since last known-good run {base['id']} ({len(b)} models compared by checksum)"
    )
    return [
        _ev(
            ctx,
            "model_change",
            "dbt:manifest",
            f"nodes/*/checksum@{base['id']}",
            content,
            version=f"{prev_m['metadata']['invocation_id'][:8]}..{cur_m['metadata']['invocation_id'][:8]}",
        )
    ]


def get_model_diff(ctx: ToolContext, model: str) -> list[Evidence]:
    """Unified diff of one model's SQL between the last known-good run and this run (from manifest raw_code)."""
    cur_m = _manifest(ctx.run_dir)
    names = {n["name"]: n for k, n in cur_m["nodes"].items() if k.startswith("model.drc_finance.")}
    if model not in names:
        return _refused(ctx, "model_change", "get_model_diff", model, f"{model} is not a project model")
    base = _baseline_run(ctx)
    prev_path = Path(base["artifacts_dir"]) / "dbt_run" / "target" / "manifest.json" if base else None
    if not prev_path or not prev_path.exists():
        return [
            _ev(
                ctx, "model_change", "dbt:manifest", f"diff/{model}/none", "no known-good run to diff against"
            )
        ]
    prev = next(
        (
            n
            for k, n in json.loads(prev_path.read_text())["nodes"].items()
            if k.startswith("model.drc_finance.") and n["name"] == model
        ),
        None,
    )
    old = (prev or {}).get("raw_code", "").splitlines()
    new = names[model]["raw_code"].splitlines()
    diff = list(
        difflib.unified_diff(old, new, f"{model}@{base['id']}", f"{model}@{ctx.pipeline_run_id}", lineterm="")
    )
    content = "\n".join(diff[:MAX_DIFF_LINES]) if diff else f"{model}: no code difference"
    return [_ev(ctx, "model_change", "dbt:manifest", f"diff/{model}@{base['id']}", content)]


def get_lineage(ctx: ToolContext, dataset: str = "rpt_daily_collections") -> list[Evidence]:
    """Upstream DECLARED dependencies from this run's OpenLineage events (not proof of causation)."""
    path = ctx.run_dir / "openlineage.jsonl"
    if not path.exists():
        return [_ev(ctx, "lineage", "openlineage", "not_found", "no lineage events for this run")]
    edges: dict[str, list[str]] = {}
    for line in path.read_text().splitlines():
        e = json.loads(line)
        if e["eventType"] == "COMPLETE" and e.get("outputs"):
            for o in e["outputs"]:
                edges[o["name"].split(".")[-1]] = [i["name"].split(".", 1)[-1] for i in e.get("inputs", [])]
    seen, order, stack = set(), [], [dataset]
    while stack:
        d = stack.pop()
        for up in edges.get(d, []):
            if up not in seen:
                seen.add(up)
                order.append(f"{up} -> {d}")
                stack.append(up.split(".")[-1])
    content = (
        f"declared upstream of {dataset}: " + "; ".join(order)
        if order
        else f"no upstream edges for {dataset}"
    )
    return [
        _ev(
            ctx,
            "lineage",
            f"file:{path.relative_to(settings.var_dir)}",
            f"upstream/{dataset}",
            content,
            version=_file_ver(path),
        )
    ]


def compare_control_totals(ctx: ToolContext) -> list[Evidence]:
    """Report vs. core-banking control totals, mismatching dates only (most recent first, capped)."""
    rpt, ctl = _rel(ctx, "marts.rpt_daily_collections"), _rel(ctx, "ops.control_totals")
    src = f"warehouse:{ctx.snapshot_schema or 'LIVE'}/rpt_daily_collections~ops.control_totals"
    with _ro() as conn:
        n_bad = conn.execute(f"""
            select count(*) from {rpt} r full join {ctl} c using (business_date)
            where r.collected_amount is distinct from c.collected_amount
               or r.payments_count is distinct from c.payments_count""").fetchone()["count"]
        rows = conn.execute(f"""
            select business_date, r.payments_count as report_count, c.payments_count as control_count,
                   r.collected_amount as report_amount, c.collected_amount as control_amount
            from {rpt} r full join {ctl} c using (business_date)
            where r.collected_amount is distinct from c.collected_amount
               or r.payments_count is distinct from c.payments_count
            order by business_date desc limit {MAX_ROWS}""").fetchall()
    if not rows:
        return [
            _ev(ctx, "invariant", src, "mismatches", "report matches control totals on every business date")
        ]
    summary = _ev(
        ctx,
        "invariant",
        src,
        "mismatches/summary",
        f"{n_bad} business date(s) where report and control totals differ",
    )
    return [summary] + [
        _ev(
            ctx,
            "invariant",
            src,
            f"business_date={r['business_date']}",
            f"{r['business_date']}: report payments_count={r['report_count']} control={r['control_count']};"
            f" report collected_amount={r['report_amount']} control={r['control_amount']}",
        )
        for r in rows
    ]


def sample_rows(ctx: ToolContext, dataset: str, key: str) -> list[Evidence]:
    """Rows for ONE key value of an allow-listed dataset. Only allow-listed (non-PII) columns returned."""
    if dataset not in DATASETS:
        return _refused(ctx, "data_sample", "sample_rows", dataset, f"{dataset} not allowed")
    kcol, cols = DATASETS[dataset]
    with _ro() as conn:
        rows = conn.execute(
            f"select {', '.join(cols)} from {_rel(ctx, dataset)} where {kcol}::text = %s limit {MAX_ROWS}",
            (key,),
        ).fetchall()
    return [
        _ev(
            ctx,
            "data_sample",
            _src(ctx, dataset),
            f"{kcol}={key}",
            f"{len(rows)} row(s) in {dataset} for {kcol}={key}: " + json.dumps(rows, default=str),
            access="restricted" if dataset in RESTRICTED else "internal",
        )
    ]


_TOOL_FNS: list[Callable[..., list[Evidence]]] = [
    get_check_results,
    get_failing_rows_sample,
    count_duplicates,
    get_ingestion_batches,
    reconcile_ingestion_batches,
    check_referential_integrity,
    read_ingestion_log,
    read_run_log,
    get_schema,
    get_model_changes,
    get_model_diff,
    get_lineage,
    compare_control_totals,
    sample_rows,
]
TOOLS: dict[str, Callable[..., list[Evidence]]] = {getattr(f, "__name__"): f for f in _TOOL_FNS}  # noqa: B009

TOOL_SPECS = {name: (f.__doc__ or "").strip().splitlines()[0] for name, f in TOOLS.items()}


def call(ctx: ToolContext, tool: str, args: dict[str, Any]) -> tuple[list[Evidence], dict]:
    """Execute + persist one tool call. Idempotent on (investigation, tool, args): a replayed call (e.g. after a
    checkpoint resume) returns the stored evidence instead of re-running."""
    key = hashlib.sha256(json.dumps([ctx.investigation_id, tool, args], sort_keys=True).encode()).hexdigest()[
        :32
    ]
    with store.connect() as conn:
        prev = conn.execute(
            "select id from tool_call where idempotency_key=%s and status='ok'", (key,)
        ).fetchone()
        if prev:
            rows = conn.execute(
                "select e.* from evidence e join investigation_evidence ie on ie.evidence_id=e.id"
                " where ie.tool_call_id=%s",
                (prev["id"],),
            ).fetchall()
            return [Evidence(**r) for r in rows], {"tool": tool, "replayed": True}
    t0, status, err, evs = time.monotonic(), "ok", None, []
    with obs.tracer.start_as_current_span(f"tool.{tool}", attributes={"tool.args": json.dumps(args)}):
        try:
            if tool not in TOOLS:
                raise ValueError(f"unknown tool {tool}")
            evs = TOOLS[tool](ctx, **args)
        except (psycopg.Error, ValueError, TypeError, OSError, KeyError) as e:  # bounded failure: recorded
            status, err = "error", f"{type(e).__name__}: {str(e).splitlines()[0][:300]}"
    ms = int((time.monotonic() - t0) * 1000)
    tc_id = f"tc_{key[:20]}"
    with store.connect() as conn, conn.transaction():
        conn.execute(
            "insert into tool_call(id,investigation_id,tool,args,status,rows_returned,duration_ms,error,"
            "idempotency_key,created_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,now()) on conflict (idempotency_key)"
            " do update set status=excluded.status, rows_returned=excluded.rows_returned,"
            " duration_ms=excluded.duration_ms, error=excluded.error",
            (tc_id, ctx.investigation_id, tool, store.j(args), status, len(evs), ms, err, key),
        )
        for ev in evs:
            conn.execute(
                "insert into evidence values (%(id)s,%(kind)s,%(source)s,%(pipeline_run_id)s,%(collected_at)s,"
                "%(observed_at)s,%(version)s,%(locator)s,%(content)s,%(content_hash)s,%(access)s)"
                " on conflict (id) do nothing",
                ev.model_dump(),
            )
            conn.execute(
                "insert into investigation_evidence values (%s,%s,%s) on conflict do nothing",
                (ctx.investigation_id, ev.id, tc_id),
            )
    obs.log("tool.call", tool=tool, args=args, status=status, evidence=len(evs), duration_ms=ms, error=err)
    return evs, {"tool": tool, "status": status, "duration_ms": ms, "error": err}


def _file_ver(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def _strip_ansi(s: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", s)


__all__ = ["TOOLS", "TOOL_SPECS", "ToolContext", "call"]
