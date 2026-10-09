# Multicloud equivalence matrix

Status: **design + partial implementation**. Only Azure has an application path in Terraform; AWS and GCP
have a foundation only (state, CI federation, registry, secret containers, KMS/budget). Nothing here has been
applied or planned against a real account (see [parity-gap.md](parity-gap.md)). "Equivalent" below means
*fills the same role in our architecture*, not *behaves identically*.

The services were chosen from each provider's official documentation (links at the end). Prices are omitted
on purpose: they vary by region and change often. Estimate them with the official calculators for a concrete
region before any apply.

## Capability matrix

| Capability | Azure (reference) | AWS | GCP | Differences that matter to us |
|---|---|---|---|---|
| **Containers (api, worker)** | Container Apps (consumption profile), revisions, `min_replicas=0` | ECS on Fargate (service + task definition) behind an ALB; *alternative:* App Runner | Cloud Run services (api) + Cloud Run service with `min-instances=1` or a worker pool (worker) | Scale-to-zero: native in Container Apps and Cloud Run. Fargate services do not scale to zero by themselves: set `desired_count=0` to stop. Container Apps and Cloud Run include ingress/TLS; ECS needs an ALB, which bills per hour even when idle. |
| **One-off jobs (migrations, sandbox validation)** | Container Apps Jobs (manual trigger) | ECS `RunTask` (Fargate) | Cloud Run Jobs | All support run-to-completion with a timeout. Retry semantics differ: we set retries to 0 and let the app retry. |
| **PostgreSQL** | Azure Database for PostgreSQL – Flexible Server (v17) | RDS for PostgreSQL (alternative: Aurora PostgreSQL) | Cloud SQL for PostgreSQL | Separate databases (`warehouse`, `app`, `sandbox_*`) and roles (`init.sql` model) work the same on all three. Differences: the admin role is not a true superuser on any of them (`azure_pg_admin`, `rds_superuser`, `cloudsqlsuperuser`), so `CREATE ROLE … CREATEDB` and `REVOKE CONNECT … FROM PUBLIC` must be re-tested on each. Extension allow-lists differ. Burstable SKUs: B1ms (Azure), db.t4g.micro (AWS), shared-core db-f1-micro/db-g1-small (GCP, no SLA). |
| **Backups / PITR** | Automatic, 7–35 days retention, PITR; geo-redundant optional at creation only | Automated backups 0–35 days, PITR; snapshots | Automated backups + PITR (WAL-based), retention configurable | Azure fixes geo-redundancy at server creation (changing it means rebuilding the server). We keep it OFF in dev and record that as a known RPO trade-off. |
| **Object storage (run artifacts, lineage, eval)** | Storage Account (Blob), versioning, lifecycle policy | S3 + versioning + lifecycle | Cloud Storage + versioning + lifecycle | Equivalent for our use (write-once artifacts). Azure: we disable shared keys (Entra ID only). |
| **Container registry** | ACR Basic | ECR (immutable tags, scan on push) | Artifact Registry (Docker, immutable tags) | ACR Basic has no tag immutability per repo by default. We rely on CI using git-SHA tags and forbidding `latest` (Terraform variable validation). |
| **Workload identity (app → cloud)** | User-assigned managed identity on the Container App | ECS task role (IAM) | Service account attached to Cloud Run | All three issue short-lived tokens with no static keys. **DB auth differs:** Entra ID for Flexible Server, IAM DB auth for RDS, IAM DB auth for Cloud SQL. This phase uses password roles from the secret store on all three: DB auth is not equivalent yet. |
| **CI federation (GitHub OIDC)** | Federated identity credential on a user-assigned identity (subject `repo:<r>:environment:dev` / `pull_request`) | IAM OIDC provider + role with `sub` condition | Workload Identity Federation pool/provider, `attribute_condition` on repository | Subject matching differs: Azure needs exact subjects (one credential per subject), AWS allows `StringLike` wildcards, and GCP uses CEL attribute conditions. Tests must assert that a different repo or branch is **rejected**. |
| **Secrets** | Key Vault (RBAC), referenced by Container Apps through the managed identity | Secrets Manager (+ KMS CMK), injected via ECS `secrets` | Secret Manager, injected via Cloud Run secret env/volumes | In all three, Terraform creates only the containers. Values are set out-of-band, so they never reach state. Rotation and versioning semantics differ, and an app restart is needed to pick up a new value everywhere. |
| **Encryption keys** | Platform-managed keys (default) | KMS CMK (implemented: secrets, ECR) | Google-managed (default); CMEK optional | AWS has a CMK in the foundation. Azure and GCP use provider-managed keys for now (gap). |
| **Network** | Public endpoints + Postgres firewall (dev). Target: VNet-integrated environment + private access | Target: VPC, private subnets, NAT or VPC endpoints, security groups | Target: VPC + Serverless VPC Access / Direct VPC egress + Cloud SQL private IP | **Largest real difference** in both cost and operations: AWS NAT gateways bill hourly, and GCP private Cloud SQL needs service networking peering. Not implemented anywhere yet: the dev Azure path uses firewall rules, which is acceptable only for synthetic data. |
| **Observability** | Log Analytics + Application Insights (OTel via connection string) | CloudWatch Logs + X-Ray / ADOT collector | Cloud Logging + Cloud Trace (OTLP) | The app emits OTLP, and only the exporter endpoint changes per cloud. Ingestion limits: Log Analytics `daily_quota_gb=1` (implemented). The other clouds need log retention and exclusion settings (gap). |
| **Budget / cost guardrails** | Consumption budget on the RG (actual 50 %, forecast 90 %) | AWS Budgets filtered by cost-allocation tag `app` | Billing budget filtered by project + label | AWS tag filters only work after the tag is **activated** as a cost-allocation tag (manual step). Budgets alert only; none of them stops spending. |
| **Remote state + locking** | Blob container, native lease locking, versioning, delete lock | S3 + native lockfile (`use_lockfile`, TF ≥ 1.10), versioning | GCS, native locking, versioning | All three are native, with no extra lock table. |
| **Tags / labels** | Tags `app, env, owner, cost_center, managed_by` | `default_tags` with the same keys | Labels with the same keys (lowercase only) | GCP labels restrict characters, which the owner variable validation enforces. |

## Interfaces kept identical across clouds (the portability contract)

The application depends only on these. Anything cloud-specific stays in Terraform or in the runtime environment.

1. **Container image** `drc:<git-sha>`, commands `drc api | drc worker | drc migrate`.
2. **Env vars**: `DRC_PG_HOST`, `DRC_PG_PORT`, `DRC_*_PASSWORD`, `ANTHROPIC_API_KEY` (optional), `OTEL_*`.
3. **PostgreSQL ≥ 17**, with the database/role layout of `infra/local/init.sql`.
4. **Object store** — *not yet abstracted*. The slice writes artifacts to the local filesystem (`var/`).
   Before any cloud run, this needs a small storage port (local / Blob / S3 / GCS); see parity-gap.

## Equivalence and portability test criteria

A cloud is "at parity" only when **all** of these pass in that cloud, run by CI with recorded output:

| # | Test | Pass criterion |
|---|---|---|
| E1 | `terraform fmt/validate` | Clean for every root (passing today for all 6 roots, see parity-gap) |
| E2 | `terraform plan` on an empty subscription/account/project | No errors; resource count recorded |
| E3 | Migration job | `drc migrate` exits 0; applying it a second time is a no-op |
| E4 | Isolation | `sandbox_rw` cannot `CONNECT` to `warehouse` or `app` (same test as local `tests/test_isolation`) |
| E5 | Vertical slice | `drc demo` scenario DUP-01 yields the same incident fingerprint, the same evidence ids for identical artifacts, and the same before/after metrics as local |
| E6 | Secrets | No secret value in state (`terraform show -json` grep), image or env dump; the app starts with secrets only from the store |
| E7 | CI federation negative test | A token from another repo or branch is rejected |
| E8 | Scale to zero / shutdown | After the runbook shutdown, the billable compute count is 0 (inventory query) |
| E9 | Backup/restore | PITR restore into a new server, then E5 passes against it |
| E10 | Destroy | `terraform destroy` leaves no tagged resources (inventory query returns empty), except the state bucket |

Results get recorded per cloud in `docs/multicloud/parity-gap.md`. None of E2–E10 has been executed yet.

## Sources (official documentation, consulted 2026-10-09)

- Terraform providers: registry.terraform.io — hashicorp/azurerm 5.9.0, hashicorp/aws 6.68.0, hashicorp/google 8.6.0, hashicorp/random 3.9.1 (versions from `registry.terraform.io/v1/providers/<ns>/<name>`).
- Terraform S3 backend `use_lockfile`: developer.hashicorp.com/terraform/language/backend/s3
- Terraform azurerm backend (blob lease locking, `use_azuread_auth`, `use_oidc`): developer.hashicorp.com/terraform/language/backend/azurerm
- Terraform gcs backend: developer.hashicorp.com/terraform/language/backend/gcs
- Azure Container Apps (scale to zero, jobs, Key Vault secret references): learn.microsoft.com/azure/container-apps/
- Azure Database for PostgreSQL Flexible Server (backup retention 7–35 d, geo-redundancy at creation): learn.microsoft.com/azure/postgresql/flexible-server/
- Workload identity federation for GitHub (Azure): learn.microsoft.com/entra/workload-id/workload-identity-federation
- GitHub OIDC with AWS: docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
- GCP Workload Identity Federation with deployment pipelines: cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- AWS Budgets cost-allocation tags: docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html
