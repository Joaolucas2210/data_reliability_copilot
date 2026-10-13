# ADR-0016: Cause-discriminating incident signatures

Status: Accepted (phase 3).

Phase 2 observed LOSS-01 and TRF-01 merging on identical failing checks. Deduplication must use
observable signals without letting the agent decide incident identity or leaking scenario labels.

Decision: versioned canonical signature of sorted checks, run-local project model checksums and
snapshot reconciliation dates. Hash the signature; retain original run linkage for idempotent replay.
Unknown signals isolate the run instead of asserting equivalence. No migration of historical incidents.

Alternative: predicted cause categories would make deterministic detection depend on an unverified diagnosis.
Batch IDs contain load timestamps here, so including them would prevent useful recurrence grouping.
All-model checksums are stable on retry; a computed delta against an evolving baseline would not be.

Trade-offs: comment changes may over-split; identical date/code signatures may still merge distinct
upstream causes. Concurrent pipeline execution remains unsupported. Revisit with stable batch identities
or selective lineage when real workloads require stronger grouping.

Evidence: fingerprint unit tests and LOSS-01/TRF-01 same-app-DB integration regression. Results are recorded
in the phase-3 report; recovery roles and citation enforcement are unchanged.
