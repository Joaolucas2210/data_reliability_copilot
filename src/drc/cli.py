"""`drc` command line. Every command is safe to re-run (see docs/architecture/reliability.md)."""

import argparse
import json
import os
import shutil
import sys

from drc import obs


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="drc")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply app DB migrations + LangGraph checkpoint tables")
    sub.add_parser("reset", help="wipe LOCAL app DB, warehouse schemas and var/ run artifacts")
    r = sub.add_parser("pipeline", help="run the pipeline (optionally with a benchmark scenario) and detect")
    r.add_argument("--scenario")
    r.add_argument("--seed", type=int, default=42)
    r.add_argument("--idempotency-key")
    i = sub.add_parser("investigate", help="create + run an investigation until it awaits human review")
    i.add_argument("incident_id")
    i.add_argument("--provider", choices=["fake", "anthropic"])
    rv = sub.add_parser("review", help="human decision on an investigation awaiting review")
    rv.add_argument("investigation_id")
    rv.add_argument("decision", choices=["approve", "reject"])
    rv.add_argument("--reviewer", default="cli-user")
    rv.add_argument("--note", default="")
    rv.add_argument("--close-incident", choices=["resolved", "dismissed"])
    v = sub.add_parser("validate", help="validate a remediation proposal in an isolated sandbox")
    v.add_argument("proposal_id")
    v.add_argument("--keep-sandbox", action="store_true")
    e = sub.add_parser("eval", help="run the benchmark")
    e.add_argument("--split", choices=["dev", "final", "all"], default="dev")
    e.add_argument("--provider", choices=["fake", "anthropic"])
    d = sub.add_parser("demo", help="end-to-end vertical slice on scenario DUP-01")
    d.add_argument("--provider", choices=["fake", "anthropic"])
    sub.add_parser("worker", help="run the job worker")
    sub.add_parser("gc", help="drop leftover sandbox databases")
    pr = sub.add_parser("prune", help="retention: old snapshots, run artifacts, checkpoints, span files")
    pr.add_argument("--keep-snapshots", type=int, default=20)
    pr.add_argument("--run-days", type=int, default=30)
    pr.add_argument("--checkpoint-days", type=int, default=30)
    pr.add_argument("--dry-run", action="store_true")
    cx = sub.add_parser("cancel", help="cancel a queued or running investigation")
    cx.add_argument("investigation_id")
    a = sub.add_parser("api", help="serve the HTTP API")
    a.add_argument("--port", type=int, default=8000)
    args = p.parse_args(argv)
    obs.setup(f"drc-{args.cmd}")

    from drc import agent, evaluate, pipeline, quality, recovery, store, worker

    out: object = None
    if args.cmd == "migrate":
        out = {"applied": store.migrate()}
        agent.setup_checkpointer()
    elif args.cmd == "reset":
        _reset()
        out = "reset done"
    elif args.cmd == "pipeline":
        run_id = pipeline.execute(args.scenario, args.seed, idempotency_key=args.idempotency_key)
        out = {"run_id": run_id, "incident_id": quality.detect(run_id)}
    elif args.cmd == "investigate":
        inv = agent.create(args.incident_id, provider=args.provider)
        st = agent.run(inv)
        out = {
            "investigation_id": inv,
            "outcome": st["diagnosis"]["outcome"],
            "proposal_id": st.get("proposal_id"),
            "citation_report": st["citation_report"],
        }
    elif args.cmd == "review":
        agent.review(args.investigation_id, args.decision, args.reviewer, args.note, args.close_incident)
        out = "recorded"
    elif args.cmd == "validate":
        out = {"validation_run_id": recovery.validate(args.proposal_id, args.keep_sandbox)}
    elif args.cmd == "eval":
        s = evaluate.run(args.split, args.provider)
        out = {"path": s["path"], "detection": s["detection"], "systems": s["systems"], "caveat": s["caveat"]}
    elif args.cmd == "demo":
        out = _demo(args.provider)
    elif args.cmd == "worker":
        worker.loop()
    elif args.cmd == "prune":
        from drc import retention

        out = retention.prune(args.keep_snapshots, args.run_days, args.checkpoint_days, args.dry_run)
    elif args.cmd == "cancel":
        out = {"result": agent.request_cancel(args.investigation_id, actor="cli-user")}
    elif args.cmd == "gc":
        out = {"dropped": recovery.gc_sandboxes()}
    elif args.cmd == "api":
        import uvicorn

        # 127.0.0.1 locally; containers set DRC_API_HOST=0.0.0.0 (ingress terminates in front of the app)
        uvicorn.run("drc.api:app", host=os.environ.get("DRC_API_HOST", "127.0.0.1"), port=args.port)
    if out is not None:
        print(json.dumps(out, indent=2, default=str))
    return 0


def _reset() -> None:
    import psycopg
    import psycopg.sql

    from drc import agent, store
    from drc.config import settings

    with psycopg.connect(settings.app_dsn, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
    with psycopg.connect(settings.warehouse_rw_dsn, autocommit=True) as c:
        c.execute(
            "drop schema if exists staging cascade; drop schema if exists marts cascade;"
            " drop schema if exists elementary cascade"
        )
        for (snap,) in c.execute(
            "select nspname from pg_namespace where nspname like 'snap\\_run\\_%'"
        ).fetchall():
            c.execute(psycopg.sql.SQL("drop schema {} cascade").format(psycopg.sql.Identifier(snap)))
    shutil.rmtree(settings.var_dir / "runs", ignore_errors=True)
    shutil.rmtree(settings.var_dir / "validations", ignore_errors=True)
    store.migrate()
    agent.setup_checkpointer()


def _demo(provider: str | None) -> dict:
    from drc import agent, pipeline, quality, recovery, store

    store.migrate()
    agent.setup_checkpointer()
    run_id = pipeline.execute("DUP-01")
    inc = quality.detect(run_id)
    if not inc:
        return {"run_id": run_id, "incident_id": None, "note": "no incident detected (unexpected for DUP-01)"}
    inv = agent.create(inc, provider=provider)
    st = agent.run(inv)
    vr = recovery.validate(st["proposal_id"]) if st.get("proposal_id") else None
    with store.connect() as c:
        mode = c.execute("select mode, llm_provider from investigation where id=%s", (inv,)).fetchone()
        v = c.execute("select status from validation_run where id=%s", (vr,)).fetchone() if vr else None
    return {
        "run_id": run_id,
        "incident_id": inc,
        "investigation_id": inv,
        "llm_mode": mode,
        "outcome": st["diagnosis"]["outcome"],
        "citation_report": st["citation_report"],
        "proposal_id": st.get("proposal_id"),
        "validation_run_id": vr,
        "validation_status": v and v["status"],
        "ui": f"http://127.0.0.1:5173/#/incidents/{inc}",
        "status": "awaiting human review (see UI or `drc review`)",
    }


if __name__ == "__main__":
    sys.exit(main())
