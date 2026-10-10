# Architecture Decision Records

Each ADR states context, alternatives, decision, trade-offs, risks, evidence and revisit triggers.
"Provisional" means the decision stands but its evidence is incomplete, and the ADR says what would complete it.

| ADR | Title | Status |
|---|---|---|
| [0001](ADR-0001-stack-and-versions.md) | Stack and pinned versions | Accepted |
| [0002](ADR-0002-modular-monolith.md) | Modular monolith with a separate worker process | Accepted |
| [0003](ADR-0003-data-and-transformations.md) | PostgreSQL + dbt Core on deterministic synthetic finance data | Accepted |
| [0004](ADR-0004-quality-detection.md) | Rules detect, the agent investigates; five distinct quality mechanisms | Accepted |
| [0005](ADR-0005-lineage.md) | OpenLineage from dbt, file transport always, Marquez optional | Accepted |
| [0006](ADR-0006-investigation-agent.md) | One LangGraph agent with explicit state, bounded tools, enforced citations | Accepted (model choice provisional) |
| [0007](ADR-0007-isolated-recovery.md) | Recovery validated only in a separate database with a separate role | Accepted |
| [0008](ADR-0008-evaluation.md) | Ground-truth benchmark, deterministic scoring, A/B/C comparison, MLflow | Accepted |
| [0009](ADR-0009-observability.md) | OpenTelemetry spans, structured logs and audit table | Accepted |
| [0010](ADR-0010-orchestration.md) | CLI + Make + Compose; Postgres job queue; no orchestrator yet | Accepted |
| [0011](ADR-0011-multicloud-terraform.md) | Multicloud via per-cloud Terraform roots, Azure as reference | Accepted (static validation only) |
| [0012](ADR-0012-design-system.md) | Small in-repo design system on CSS custom properties | Partially superseded by 0015 |
| [0013](ADR-0013-authn-authz.md) | Dev-only header roles now; Entra ID before any cloud exposure | Accepted (blocks cloud exposure) |
| [0014](ADR-0014-per-run-snapshots.md) | Per-run warehouse snapshots and per-run project copies | Accepted (phase 2) |
| [0015](ADR-0015-mantine-ui-library.md) | Mantine component library, dark mode, validated chart palette | Accepted (UX round 3) |

| [0016](ADR-0016-incident-fingerprint.md) | Cause-discriminating incident signatures | Accepted (phase 3) |
