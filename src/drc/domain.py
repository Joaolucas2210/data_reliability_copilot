"""Domain model: entities, allowed state transitions and the agent's structured output contract.

IDs: prefixed, time-ordered strings (`inc_…`, `inv_…`) except Evidence, whose id is content-addressed
(`ev_` + sha256 of source|locator|content_hash) so the same fact collected twice dedupes to one row.
Timestamps: timestamptz, UTC. Versioning: mutable rows carry `version` (optimistic locking on status changes).
"""

import hashlib
import secrets
import time
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    # time-ordered: 12 hex of ms timestamp + 8 random hex
    return f"{prefix}_{int(time.time() * 1000):012x}{secrets.token_hex(4)}"


def evidence_id(source: str, locator: str, content_hash: str) -> str:
    return "ev_" + hashlib.sha256(f"{source}|{locator}|{content_hash}".encode()).hexdigest()[:16]


class IncidentStatus(StrEnum):
    open = "open"
    investigating = "investigating"
    awaiting_review = "awaiting_review"
    resolved = "resolved"
    dismissed = "dismissed"


class InvestigationStatus(StrEnum):
    queued = "queued"
    running = "running"
    awaiting_review = "awaiting_review"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ProposalStatus(StrEnum):
    proposed = "proposed"
    validating = "validating"
    validated = "validated"
    validation_failed = "validation_failed"
    approved = "approved"  # approval != applied: production remediation is out of scope in this phase
    rejected = "rejected"


class ValidationStatus(StrEnum):
    queued = "queued"
    running = "running"
    passed = "passed"
    failed = "failed"
    error = "error"


TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "incident": {
        "open": {"investigating", "dismissed", "resolved"},  # resolved: after a decided investigation
        "investigating": {"awaiting_review", "open"},  # back to open on failure/cancel
        "awaiting_review": {"resolved", "dismissed", "investigating", "open"},  # open: decided, not closed
        "resolved": {"open"},  # reopen (human decision, audited)
        "dismissed": {"open"},
    },
    "investigation": {
        "queued": {"running", "cancelled"},
        "running": {"awaiting_review", "failed", "cancelled", "running"},  # running->running = resume
        "awaiting_review": {"completed", "cancelled"},
        "completed": set(),
        "failed": set(),
        "cancelled": set(),
    },
    "proposal": {
        "proposed": {"validating", "rejected"},
        "validating": {"validated", "validation_failed"},
        "validated": {"approved", "rejected", "validating"},
        "validation_failed": {"validating", "rejected"},
        "approved": set(),
        "rejected": set(),
    },
    "validation": {
        "queued": {"running"},
        "running": {"passed", "failed", "error"},
        "passed": set(),
        "failed": set(),
        "error": set(),
    },
}


def check_transition(entity: str, src: str, dst: str) -> None:
    if dst not in TRANSITIONS[entity][src]:
        raise ValueError(f"illegal {entity} transition {src} -> {dst}")


AccessClass = Literal["public", "internal", "restricted"]
EvidenceKind = Literal[
    "dbt_test_result",
    "freshness",
    "invariant",
    "run_log",
    "ingestion_log",
    "schema",
    "model_change",
    "lineage",
    "data_sample",
    "manifest",
    "row_count",
]


class Evidence(BaseModel):
    id: str
    kind: EvidenceKind
    source: str  # e.g. "dbt:run_results", "file:var/logs/ingestion/x.jsonl", "warehouse:raw.payments"
    pipeline_run_id: str | None
    collected_at: datetime
    observed_at: datetime | None = None  # when the underlying fact happened, if known
    version: str | None = None  # artifact hash / manifest checksum / dbt version
    locator: str  # line range, json pointer, query fingerprint …
    content: str  # bounded, redacted excerpt — UNTRUSTED data
    content_hash: str
    access: AccessClass = "internal"


# ---- Structured output contract of an investigation (ADR-0006) ----


class Fact(BaseModel):
    statement: str
    evidence_ids: list[str] = Field(min_length=1)
    quote: str = Field(
        description="verbatim substring of one cited evidence content that supports the statement"
    )


class HypothesisOut(BaseModel):
    id: str
    statement: str
    status: Literal["supported", "refuted", "inconclusive"]
    supporting_evidence_ids: list[str] = []
    contradicting_evidence_ids: list[str] = []
    cause_category: str | None = (
        None  # duplication, schema_drift, delay, record_loss, bad_join, transformation_change …
    )


class RecoveryProposalOut(BaseModel):
    playbook: str  # only allow-listed playbooks in this phase (recovery.PLAYBOOKS)
    rationale: str
    evidence_ids: list[str] = Field(min_length=1)


class Diagnosis(BaseModel):
    outcome: Literal["diagnosed", "abstained", "no_fault_found"]
    summary: str
    observed_facts: list[Fact]
    hypotheses: list[HypothesisOut]
    contradicting_evidence: list[str] = []  # evidence ids
    missing_information: list[str] = []
    estimated_scope: str
    next_step: str
    recovery: RecoveryProposalOut | None = None
    self_reported_confidence: Literal["low", "medium", "high"] | None = Field(
        default=None, description="NOT a calibrated probability; informational only"
    )
