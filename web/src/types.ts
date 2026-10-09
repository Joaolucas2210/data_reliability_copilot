// Mirrors docs/architecture/api-contract.md (v0). Keep in sync with src/drc/domain.py.

export type CheckStatus = "pass" | "warn" | "fail" | "error" | "skipped";
export type Status = CheckStatus | "unknown" | "info";

export interface PipelineRun {
  id: string;
  pipeline: string;
  scenario_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  dbt_version: string | null;
  manifest_hash: string | null;
}

export interface PipelineHealth {
  pipeline: string;
  last_run: PipelineRun;
  checks: { pass: number; warn: number; fail: number; error: number };
  freshness: "pass" | "warn" | "fail" | "unknown";
  open_incidents: number;
}

export interface Incident {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  status: string;
  dataset_id: string | null;
  occurrences: number;
  opened_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface QualityCheckResult {
  id: string;
  pipeline_run_id: string;
  check_type: "schema_contract" | "data_test" | "freshness" | "invariant" | "anomaly" | "model_run";
  check_name: string;
  dataset_id: string | null;
  status: CheckStatus;
  observed_value: string | null;
  expected: string | null;
  failures: number | null;
  message: string | null;
  evaluated_at: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  trace_id: string | null;
}

export interface InvestigationSummary {
  id: string;
  status: string;
  outcome: string | null;
  mode: "fake" | "live";
  llm_provider: string;
  llm_model: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface IncidentDetail {
  incident: Incident;
  checks: QualityCheckResult[];
  timeline: AuditEvent[];
  investigations: InvestigationSummary[];
}

export interface Evidence {
  id: string;
  kind: string;
  source: string;
  pipeline_run_id: string | null;
  collected_at: string;
  observed_at: string | null;
  version: string | null;
  locator: string;
  content: string | null;
  content_hash: string;
  access: "public" | "internal" | "restricted";
  redacted?: boolean;
}

export interface Fact {
  statement: string;
  evidence_ids: string[];
  quote: string;
}

export interface Hypothesis {
  id: string;
  statement: string;
  status: "supported" | "refuted" | "inconclusive";
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  cause_category: string | null;
}

export interface Diagnosis {
  outcome: "diagnosed" | "abstained" | "no_fault_found";
  summary: string;
  observed_facts: Fact[];
  hypotheses: Hypothesis[];
  contradicting_evidence: string[];
  missing_information: string[];
  estimated_scope: string;
  next_step: string;
  recovery: { playbook: string; rationale: string; evidence_ids: string[] } | null;
  self_reported_confidence: "low" | "medium" | "high" | null;
}

// Matches src/drc/citations.py verify() report.
export interface CitationReport {
  facts_total: number;
  facts_supported: number;
  unsupported_facts: string[];
  cited_ids: number;
  existing_ids: number;
  missing_ids: string[];
  citation_precision: number | null;
  enforcement: string | null;
}

export interface Usage {
  llm_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_status: "measured" | "estimated" | "unknown";
  tool_calls?: number;
  wall_ms?: number | null;
  llm_latency_ms?: number | null;
  fallbacks?: { from: string; reason: string }[];
  limit_hit?: string | null;
}

export interface Proposal {
  id: string;
  playbook: string;
  rationale: string;
  evidence_ids: string[];
  status: string;
  latest_validation_run_id: string | null;
}

export interface ReviewRecord {
  decision: "approve" | "reject" | null;
  note: string;
  reviewer: string;
  at: string;
}

export interface Investigation {
  id: string;
  incident_id: string;
  status: string;
  review?: ReviewRecord | null;
  last_status_change?: { at: string; actor: string; from_status: string | null; to_status: string } | null;
  cancel_requested_by?: { actor: string; at: string } | null;
  created_at?: string;
  outcome: string | null;
  mode: "fake" | "live";
  llm_provider: string;
  llm_model: string | null;
  prompt_version: string;
  diagnosis: Diagnosis | null;
  citation_report: CitationReport | null;
  evidence: Evidence[];
  tool_calls: { tool: string; args: Record<string, unknown>; status: string; rows_returned: number | null; duration_ms: number | null }[];
  proposals: Proposal[];
  usage: Usage;
  limits: Record<string, unknown>;
}

export interface ValidationStep {
  name: "snapshot" | "compile" | "static_check" | "dbt_build" | "data_tests" | "invariants";
  status: "pass" | "fail" | "skipped" | "error";
  detail: unknown; // string or structured object (e.g. snapshot hashes, static-check findings)
  duration_ms?: number | null;
}

export interface ValidationRun {
  id: string;
  proposal_id: string;
  investigation_id?: string;
  incident_id?: string;
  playbook?: string;
  status: string;
  error?: string | null;
  sandbox_db: string;
  steps: ValidationStep[];
  isolation_checks: { name: string; passed: boolean; detail: unknown }[];
  metrics_before: Record<string, unknown> | null;
  metrics_after: Record<string, unknown> | null;
  invariants: { name: string; before: unknown; after: unknown; passed: boolean }[];
  started_at: string;
  finished_at: string | null;
  cleaned_up_at: string | null;
}

export interface EvalRun {
  id: string;
  created_at: string;
  split: "dev" | "final";
  system: "A_rules" | "B_summary_llm" | "C_agent_tools";
  llm_provider: string;
  llm_model: string | null;
  prompt_version: string;
  metrics: Record<string, number | null>;
  per_scenario: { scenario_id: string; expected: string; got: string; correct: boolean; unsupported_claims?: number }[];
}
