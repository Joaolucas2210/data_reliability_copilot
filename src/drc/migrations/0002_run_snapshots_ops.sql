-- Phase 2: per-run warehouse snapshots, model-run checks, cancellation and job heartbeats.
alter table pipeline_run add column snapshot_schema text;
alter table pipeline_run add column project_dir text;

alter table quality_check_result drop constraint quality_check_result_check_type_check;
alter table quality_check_result add constraint quality_check_result_check_type_check
  check (check_type in ('schema_contract','data_test','freshness','invariant','anomaly','model_run'));

alter table investigation add column cancel_requested_at timestamptz;
alter table job add column heartbeat_at timestamptz;
