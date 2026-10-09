-- App database schema. Forward-only migrations; each file applied once inside a transaction (store.migrate).
create table pipeline_run (
  id text primary key, pipeline text not null, scenario_id text, status text not null,
  started_at timestamptz not null, finished_at timestamptz, dbt_version text, manifest_hash text,
  artifacts_dir text not null, idempotency_key text unique, created_at timestamptz not null default now()
);
create table dataset (
  id text primary key,  -- OpenLineage namespace + name
  namespace text not null, name text not null, kind text not null default 'table',
  first_seen_at timestamptz not null default now(), unique (namespace, name)
);
create table quality_check_result (
  id text primary key, pipeline_run_id text not null references pipeline_run(id),
  check_type text not null check (check_type in ('schema_contract','data_test','freshness','invariant','anomaly')),
  check_name text not null, dataset_id text, status text not null check (status in ('pass','warn','fail','error','skipped')),
  observed_value text, expected text, failures bigint, message text, evaluated_at timestamptz not null,
  unique (pipeline_run_id, check_name)
);
create table incident (
  id text primary key, fingerprint text not null, title text not null, severity text not null,
  status text not null, dataset_id text, first_pipeline_run_id text not null references pipeline_run(id),
  last_pipeline_run_id text not null references pipeline_run(id), occurrences int not null default 1,
  opened_at timestamptz not null, updated_at timestamptz not null, closed_at timestamptz, version int not null default 1
);
-- at most one non-terminal incident per fingerprint: the dedup rule for repeated detections
create unique index incident_open_fingerprint on incident(fingerprint) where status not in ('resolved','dismissed');
create table incident_check (
  incident_id text references incident(id), check_id text references quality_check_result(id),
  primary key (incident_id, check_id)
);
create table investigation (
  id text primary key, incident_id text not null references incident(id), status text not null,
  mode text not null, llm_provider text not null, llm_model text, prompt_version text not null,
  outcome text, diagnosis jsonb, citation_report jsonb, usage jsonb not null default '{}'::jsonb,
  limits jsonb not null, error text, idempotency_key text unique,
  created_at timestamptz not null, started_at timestamptz, finished_at timestamptz, version int not null default 1
);
create table evidence (
  id text primary key, kind text not null, source text not null, pipeline_run_id text, collected_at timestamptz not null,
  observed_at timestamptz, version text, locator text not null, content text not null, content_hash text not null,
  access text not null check (access in ('public','internal','restricted'))
);
create table investigation_evidence (
  investigation_id text references investigation(id), evidence_id text references evidence(id),
  tool_call_id text, primary key (investigation_id, evidence_id)
);
create table hypothesis (
  id text primary key, investigation_id text not null references investigation(id), statement text not null,
  status text not null, cause_category text, supporting jsonb not null, contradicting jsonb not null
);
create table tool_call (
  id text primary key, investigation_id text not null references investigation(id), tool text not null,
  args jsonb not null, status text not null, rows_returned int, duration_ms int, error text,
  idempotency_key text not null unique, created_at timestamptz not null
);
create table remediation_proposal (
  id text primary key, investigation_id text not null references investigation(id), playbook text not null,
  rationale text not null, evidence_ids jsonb not null, status text not null, created_at timestamptz not null,
  decided_by text, decided_at timestamptz, version int not null default 1
);
create table validation_run (
  id text primary key, proposal_id text not null references remediation_proposal(id), status text not null,
  sandbox_db text not null, steps jsonb not null default '[]'::jsonb, metrics_before jsonb, metrics_after jsonb,
  invariants jsonb, isolation_checks jsonb, started_at timestamptz not null, finished_at timestamptz,
  cleaned_up_at timestamptz, error text
);
create table audit_event (
  id bigserial primary key, at timestamptz not null default now(), actor text not null, action text not null,
  entity_type text not null, entity_id text not null, from_status text, to_status text, detail jsonb not null default '{}'::jsonb,
  trace_id text
);
create index audit_entity on audit_event(entity_type, entity_id, at);
create table job (
  id text primary key, kind text not null, payload jsonb not null, status text not null default 'queued',
  attempts int not null default 0, max_attempts int not null default 2, run_after timestamptz not null default now(),
  locked_by text, locked_at timestamptz, error text, created_at timestamptz not null default now(),
  idempotency_key text unique
);
create table eval_run (
  id text primary key, created_at timestamptz not null, split text not null, system text not null,
  llm_provider text not null, llm_model text, prompt_version text not null, metrics jsonb not null,
  per_scenario jsonb not null, mlflow_run_id text
);
