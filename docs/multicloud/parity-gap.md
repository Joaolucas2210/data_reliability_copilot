# Multicloud parity gap

Snapshot date: 2026-10-09. Verified means **static checks only** (`terraform fmt -check` +
`init -backend=false` + `validate`, via `infra/terraform/check.sh`). No `plan` or `apply` has run on any cloud:
no CI identity or credentials have been provisioned for this project, and this phase forbids creating billable
resources. **Multicloud is an architectural goal, not a validated property.**

## What exists per cloud

| Area | Azure | AWS | GCP |
|---|---|---|---|
| Remote state bootstrap | ✅ `azure/bootstrap` (Blob, ZRS, versioning, delete lock, lease locking) | ✅ `aws/bootstrap` (S3, KMS SSE, versioning, TLS-only, public access block, `use_lockfile`) | ✅ `gcp/bootstrap` (GCS, versioning, PAP enforced) |
| CI federation (GitHub OIDC) | ✅ user-assigned identity + federated credentials (`environment:<env>`, `pull_request`) | ✅ OIDC provider + role (`sub` limited to repo env/PR) + scoped policy | ✅ WIF pool/provider (repo condition) + CI service account |
| Registry | ✅ ACR (in the app module) | ✅ ECR (immutable, scan, KMS, lifecycle) | ✅ Artifact Registry (immutable, cleanup) |
| Secret containers | ✅ Key Vault, RBAC. Names are listed, values are set by an operator | ✅ Secrets Manager (KMS) | ✅ Secret Manager (regional replication) |
| Budget | ✅ RG consumption budget | ✅ AWS Budgets (tag filter) | ✅ Billing budget (project + label) |
| Container runtime (api, worker) | ✅ Container Apps + managed identity + KV secret refs | ❌ | ❌ |
| Migration job | ✅ Container Apps Job (manual) | ❌ | ❌ |
| PostgreSQL | ✅ Flexible Server v17, 4 databases, firewall | ❌ | ❌ |
| Artifact storage | ✅ Storage account + containers + lifecycle | ❌ (only the state bucket) | ❌ (only the state bucket) |
| Observability | ✅ Log Analytics (1 GB/day cap) + App Insights | ❌ | ❌ |
| Private networking | ❌ (public + firewall; see AZ-3) | ❌ | ❌ |
| `plan` executed | ❌ blocked: no credentials provisioned | ❌ blocked | ❌ blocked |
| Equivalence tests E2-E10 | ❌ | ❌ | ❌ |

Static check output (2026-10-09, Terraform 1.16.5 in `hashicorp/terraform:1.16.5`):
`fmt -check -recursive`: clean. `validate`: "Success! The configuration is valid." for `azure/bootstrap`,
`azure/envs/dev`, `aws/bootstrap`, `aws/foundation`, `gcp/bootstrap`, `gcp/foundation`.

## Known gaps on the Azure reference path (fix before calling it deployable)

- **AZ-1 App does not have a cloud artifact store.** The app writes artifacts to the local `var/` directory. It
  needs a storage port (Blob) before `worker` can run in Container Apps, because replica filesystems are ephemeral.
- **AZ-2 Auth.** The app's dev header auth (ADR-0013) must not be exposed. Ingress is external in the module, so
  Entra ID authentication (Container Apps built-in auth, or token validation in the app) is required before the
  first deployment.
- **AZ-3 Network.** Postgres is publicly reachable, with an "allow Azure services" rule (any Azure tenant's
  services can reach the listener; password auth still applies). The target is a VNet-integrated Container Apps
  environment, Flexible Server private access (delegated subnet + private DNS zone) and a Key Vault private endpoint.
- **AZ-4 Role bootstrap in Postgres.** `init.sql` (roles, `REVOKE CONNECT`) is not run in the cloud. It needs a
  one-off admin job reading role passwords from Key Vault. `CREATEDB` for `sandbox_rw` must be re-tested
  under `azure_pg_admin` semantics.
- **AZ-5 Sandbox capacity.** Sandbox databases share the production server, so the isolation is at role and
  database level, not at server level. ADR-0007 prefers a separate server. Options: a second B1ms server for
  sandboxes, or accept the shared server and document the risk.
- **AZ-6 Image build/push** job in CI (OIDC → AcrPush) is not written yet.
- **AZ-7 Lock file platforms.** `.terraform.lock.hcl` files contain `h1:` hashes for linux_amd64 only. Run
  `terraform providers lock -platform=darwin_arm64 -platform=windows_amd64` if operators use other platforms.

## Backlog for AWS/GCP parity (ordered)

1. **Storage port in the app** (shared with AZ-1): `local | azure_blob | s3 | gcs` behind one interface.
   It's a prerequisite for any cloud.
2. **Network module per cloud**: AWS VPC (2 AZs, private subnets, VPC endpoints for ECR/S3/Secrets Manager/Logs to
   avoid a NAT gateway where possible), GCP VPC + Direct VPC egress + Private Service Access for Cloud SQL.
   Record the hourly fixed cost of each choice before apply.
3. **PostgreSQL**: RDS for PostgreSQL 17 (`db.t4g.micro`, backups 7 d, deletion protection in prd) and Cloud SQL for
   PostgreSQL 17 (private IP, PITR). Then the role bootstrap job (as AZ-4).
4. **Runtime**: ECS Fargate cluster + task definitions (api, worker) + ALB, and the migration as `RunTask`;
   Cloud Run services (api, worker) + Cloud Run Job (migrate). Use secrets injection from the respective stores.
5. **Observability**: OTLP exporter targets (ADOT collector sidecar on ECS, Cloud Trace / Cloud Logging on GCP),
   log retention (CloudWatch 30 d, Cloud Logging bucket retention), ingestion caps or exclusion filters.
6. **CI**: image push jobs for ECR and Artifact Registry using the federated identities that already exist.
7. **Equivalence suite E2-E10** as a CI workflow (manual dispatch) per cloud, with results appended here.
8. **CMEK parity** (Azure Key Vault keys / GCP KMS) only if a requirement appears. AWS has a CMK already.

## Exit criterion for "multicloud validated"

All of E1-E10 in [equivalence-matrix.md](equivalence-matrix.md) pass for a cloud, recorded with dated CI run links.
Until then, docs and READMEs must say "Azure reference path; AWS/GCP foundation only".
