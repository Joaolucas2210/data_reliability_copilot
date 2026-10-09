"""Job worker: Postgres-backed queue (SELECT … FOR UPDATE SKIP LOCKED). No broker needed at this scale.

Retries are bounded (job.max_attempts); a job whose lock is older than LOCK_TIMEOUT_S is considered abandoned
(worker crash) and becomes claimable again — handlers must therefore be resumable/idempotent:
- investigate: LangGraph checkpoint resume + idempotent tool calls;
- validate:    a fresh sandbox per attempt; previous attempt's sandbox is dropped by gc.
"""

import os
import socket
import threading
import time

from drc import agent, obs, recovery, store
from drc.domain import new_id

# The lock is a lease renewed by a heartbeat thread every HEARTBEAT_S while the handler runs; a lease not renewed
# for LOCK_TIMEOUT_S means the worker died and the job may be reclaimed (handlers are resumable/idempotent).
HEARTBEAT_S = 20
LOCK_TIMEOUT_S = 120
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"


def enqueue(kind: str, payload: dict, idempotency_key: str | None = None) -> str:
    with store.connect() as conn:
        row = conn.execute(
            "insert into job(id,kind,payload,idempotency_key) values (%s,%s,%s,%s)"
            " on conflict (idempotency_key) do update set idempotency_key=excluded.idempotency_key"
            " returning id",
            (new_id("job"), kind, store.j(payload), idempotency_key),
        ).fetchone()
        return row["id"]  # type: ignore[index]


def claim() -> dict | None:
    with store.connect() as conn, conn.transaction():
        job = conn.execute(
            "select * from job where (status='queued' and run_after <= now()) or (status='running' and locked_at <"
            " now() - make_interval(secs => %s)) order by created_at for update skip locked limit 1",
            (LOCK_TIMEOUT_S,),
        ).fetchone()
        if job:
            conn.execute(
                "update job set status='running', locked_by=%s, locked_at=now(), attempts=attempts+1"
                " where id=%s",
                (WORKER_ID, job["id"]),
            )
            job["attempts"] += 1
        return job


def handle(job: dict) -> None:
    p = job["payload"]
    if job["kind"] == "investigate":
        agent.run(p["investigation_id"])
    elif job["kind"] == "validate":
        recovery.validate(p["proposal_id"])
    else:
        raise ValueError(f"unknown job kind {job['kind']}")


def run_once() -> bool:
    job = claim()
    if not job:
        return False
    stop = threading.Event()
    beat = threading.Thread(target=_heartbeat, args=(job["id"], stop), daemon=True)
    beat.start()
    with obs.tracer.start_as_current_span("job", attributes={"job.id": job["id"], "job.kind": job["kind"]}):
        try:
            handle(job)
            with store.connect() as conn:
                conn.execute("update job set status='done', error=null where id=%s", (job["id"],))
        except Exception as e:
            final = job["attempts"] >= job["max_attempts"]
            with store.connect() as conn, conn.transaction():
                conn.execute(
                    "update job set status=%s, error=%s, run_after=now() + interval '10 seconds' where id=%s",
                    ("failed" if final else "queued", f"{type(e).__name__}: {e}"[:500], job["id"]),
                )
                if final and job["kind"] == "investigate":
                    inv_id = job["payload"]["investigation_id"]
                    inv = conn.execute(
                        "select status, incident_id from investigation where id=%s", (inv_id,)
                    ).fetchone()
                    if inv and inv["status"] == "running":
                        store.transition(
                            conn, "investigation", inv_id, "failed", "worker", error=str(e)[:200]
                        )
                        store.transition(conn, "incident", inv["incident_id"], "open", "worker")
            obs.log("job.failed", job_id=job["id"], attempt=job["attempts"], final=final, error=str(e)[:200])
        finally:
            stop.set()
            beat.join(timeout=5)
    return True


def _heartbeat(job_id: str, stop: threading.Event) -> None:
    """Renew the job lease while the handler runs. Stops renewing if this worker no longer owns the lock."""
    while not stop.wait(HEARTBEAT_S):
        with store.connect() as conn:
            owned = conn.execute(
                "update job set heartbeat_at=now(), locked_at=now() where id=%s and locked_by=%s"
                " and status='running' returning id",
                (job_id, WORKER_ID),
            ).fetchone()
        if not owned:
            obs.log("job.lease_lost", job_id=job_id, worker=WORKER_ID)
            return


def loop(poll_s: float = 2.0, max_idle_polls: int | None = None) -> None:
    obs.setup("drc-worker")
    idle = 0
    recovery.gc_sandboxes()
    while max_idle_polls is None or idle < max_idle_polls:
        if run_once():
            idle = 0
        else:
            idle += 1
            time.sleep(poll_s)
