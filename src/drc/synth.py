"""Deterministic synthetic finance data (customers, contracts, installments, payments).

Business columns depend only on `seed`; `_loaded_at` is the real load time (needed for freshness checks).
"""

import json
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg
from faker import Faker

AS_OF = date(2026, 9, 30)  # fixed business "today" so business data is seed-deterministic

DDL = """
drop schema if exists raw cascade; drop schema if exists ops cascade;
create schema raw; create schema ops;
create table raw.customers (customer_id text, name text, segment text, region text, created_at date,
  _batch_id text, _loaded_at timestamptz);
create table raw.contracts (contract_id text, customer_id text, principal numeric, rate_monthly numeric,
  n_installments int, start_date date, status text, _batch_id text, _loaded_at timestamptz);
create table raw.installments (installment_id text, contract_id text, seq int, due_date date, amount numeric,
  _batch_id text, _loaded_at timestamptz);
create table raw.payments (payment_id text, installment_id text, paid_at timestamp, amount numeric, channel text,
  _batch_id text, _loaded_at timestamptz);
create table ops.ingestion_batches (batch_id text, table_name text, row_count int, loaded_at timestamptz,
  attempt int, status text);
-- Control totals delivered by the (fictional) core banking system: the business ground truth for reconciliation.
create table ops.control_totals (business_date date primary key, payments_count bigint, collected_amount numeric(16,2));
"""


@dataclass
class Dataset:
    customers: list[tuple]
    contracts: list[tuple]
    installments: list[tuple]
    payments: list[tuple]  # (payment_id, installment_id, paid_at, amount, channel)


def generate(seed: int, n_customers: int = 400, n_contracts: int = 600) -> Dataset:
    fake = Faker("pt_BR")
    fake.seed_instance(seed)
    rnd = random.Random(seed)
    customers = [
        (
            f"C{i:05d}",
            fake.name(),
            rnd.choice(["retail", "sme", "premium"]),
            fake.estado_sigla(),
            AS_OF - timedelta(days=rnd.randint(400, 2000)),
        )
        for i in range(n_customers)
    ]
    contracts: list[tuple] = []
    installments: list[tuple] = []
    payments: list[tuple] = []
    for k in range(n_contracts):
        cid, cust = f"K{k:05d}", rnd.choice(customers)[0]
        principal = Decimal(rnd.randrange(2_000, 80_000, 500))
        rate = Decimal(rnd.choice(["0.0149", "0.0199", "0.0249", "0.0299"]))
        n = rnd.choice([6, 12, 18, 24])
        start = AS_OF - timedelta(days=rnd.randint(30, 360))
        contracts.append((cid, cust, principal, rate, n, start, "active"))
        pmt = (principal * rate / (1 - (1 + rate) ** -n)).quantize(Decimal("0.01"))
        for s in range(1, n + 1):
            iid, due = f"{cid}-{s:02d}", start + timedelta(days=30 * s)
            installments.append((iid, cid, s, due, pmt))
            paid_at = datetime.combine(
                due + timedelta(days=rnd.randint(-5, 7)), datetime.min.time()
            ) + timedelta(minutes=rnd.randint(480, 1200))
            if paid_at.date() <= AS_OF and rnd.random() < 0.88:
                payments.append(
                    (f"P{len(payments):07d}", iid, paid_at, pmt, rnd.choice(["pix", "boleto", "debit"]))
                )
    return Dataset([c[:5] for c in customers], contracts, installments, payments)


def control_totals(ds: Dataset) -> dict[date, tuple[int, Decimal]]:
    out: dict[date, tuple[int, Decimal]] = {}
    for p in ds.payments:
        n, amt = out.get(p[2].date(), (0, Decimal(0)))
        out[p[2].date()] = (n + 1, amt + p[3])
    return out


class IngestionLog:
    """Structured JSONL log of the (simulated) ingestion job. Treated as UNTRUSTED evidence by the agent."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path, self._f = path, path.open("w", buffering=1)  # line-buffered: injections may rewrite it

    def write(self, level: str, event: str, **kw) -> None:
        self._f.write(
            json.dumps(
                {"ts": datetime.now(UTC).isoformat(), "level": level, "event": event, **kw}, default=str
            )
            + "\n"
        )

    def edit(self, fn: Callable[[dict], dict | None]) -> None:
        """Rewrite past records (fn returns the record, a modified record, or None to drop it), then keep appending."""
        self._f.close()
        recs = [fn(json.loads(line)) for line in self.path.read_text().splitlines()]
        self.path.write_text("".join(json.dumps(r) + "\n" for r in recs if r is not None))
        self._f = self.path.open("a", buffering=1)

    def close(self) -> None:
        self._f.close()


def load(dsn: str, ds: Dataset, log: IngestionLog, run_tag: str) -> None:
    now = datetime.now(UTC)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(DDL)
        for table, rows in [
            ("customers", ds.customers),
            ("contracts", ds.contracts),
            ("installments", ds.installments),
        ]:
            batch = f"{run_tag}-{table}"
            _copy(cur, table, [(*r, batch, now) for r in rows])
            cur.execute(
                "insert into ops.ingestion_batches values (%s,%s,%s,%s,1,'loaded')",
                (batch, table, len(rows), now),
            )
            log.write("INFO", "batch_loaded", batch_id=batch, table=table, rows=len(rows))
        # payments arrive in one batch per business date
        by_day: dict[date, list[tuple]] = {}
        for p in ds.payments:
            by_day.setdefault(p[2].date(), []).append(p)
        for d, rows in sorted(by_day.items()):
            batch = f"{run_tag}-payments-{d.isoformat()}"
            _copy(cur, "payments", [(*r, batch, now) for r in rows])
            cur.execute(
                "insert into ops.ingestion_batches values (%s,'payments',%s,%s,1,'loaded')",
                (batch, len(rows), now),
            )
            log.write("INFO", "batch_loaded", batch_id=batch, table="payments", rows=len(rows))
        cur.executemany(
            "insert into ops.control_totals values (%s,%s,%s)",
            [(d, n, a) for d, (n, a) in sorted(control_totals(ds).items())],
        )
        cur.execute(
            "grant usage on schema raw, ops to copilot_reader;"
            "grant select on all tables in schema raw, ops to copilot_reader"
        )


def _copy(cur: psycopg.Cursor, table: str, rows: list[tuple]) -> None:
    with cur.copy(f"copy raw.{table} from stdin") as cp:
        for r in rows:
            cp.write_row(r)
