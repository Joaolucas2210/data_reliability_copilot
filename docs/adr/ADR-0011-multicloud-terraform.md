# ADR-0011 — Multicloud via per-cloud Terraform roots, Azure as reference path

- **Status:** Accepted (2026-10-09). Static validation only; no plan/apply executed.
- **Deciders:** project owner (Staff Engineer role)

## Context

Independent deployment to Azure, AWS and GCP is an architectural goal. In this phase we only need one
cloud path for the application, and we must not create billable resources. It is easy to fake portability
with a "generic" module wrapping three providers behind one interface. That hides real differences:
network model, managed Postgres privilege model, scale-to-zero, CI federation subject matching, and
budget filters ([equivalence-matrix.md](../multicloud/equivalence-matrix.md)).

## Alternatives

1. **Single cross-cloud abstraction module** (one interface, three implementations selected by variable).
   Looks portable, but in practice most inputs have no equivalent across clouds (e.g. `sku_name` vs `instance_class`
   vs `tier`), and it forces lowest-common-denominator features.
2. **Per-cloud roots + shared application contract** (chosen): each cloud is written idiomatically. Portability
   lives in the app's runtime contract (image, commands, env vars, Postgres layout) and in an equivalence
   test suite (E1–E10).
3. **Kubernetes everywhere (AKS/EKS/GKE) + Helm**: maximizes runtime sameness, but adds cluster operations,
   fixed control-plane/node cost and a skill set the MVP does not need.
4. **Pulumi / CDKTF**: real programming languages for IaC. That's not a concrete benefit here, and Terraform is
   what the stack specifies.

## Decision

- Terraform, one root per (cloud, component, env): `azure/{bootstrap,envs/dev}`, `aws/{bootstrap,foundation}`,
  `gcp/{bootstrap,foundation}`; reusable module only where there is a second caller (`modules/azure/app_platform`
  is reused by future `envs/stg|prd`).
- Azure is the reference path: Container Apps + Flexible Server + Key Vault + Blob + ACR + Log Analytics/App Insights.
- AWS/GCP get a **real foundation** (state, OIDC federation, registry, secret containers, KMS/budget) and **no
  placeholder app modules**. Missing parts are listed in [parity-gap.md](../multicloud/parity-gap.md).
- Remote state with native locking in each cloud. Bootstrap uses local state.
- CI: GitHub OIDC federation in all three. No long-lived cloud secrets. `plan` only on manual dispatch; no
  automated `apply`.
- Providers pinned exactly in roots (`azurerm 5.9.0`, `aws 6.68.0`, `google 8.6.0`, `random 3.9.1`) with
  committed lock files. The module uses a bounded range (`>= 5.9.0, < 6.0.0`).

## Trade-offs

- More code per cloud than an abstraction would need, but each file reads as plain provider docs.
- Parity work is explicit and visible (a backlog), not hidden in a module that "supports" a cloud nobody tested.
- Container Apps/Cloud Run scale to zero; ECS Fargate + ALB does not idle for free. The cost profile
  will differ by cloud even with identical app behaviour.

## Risks

- **Drift between clouds**: the app may start depending on an Azure-only feature (e.g. Key Vault references).
  Mitigation: the app reads only env vars; E5/E6 tests per cloud.
- **Unvalidated Terraform**: `validate` does not catch API-side errors (quotas, SKU availability in
  `brazilsouth`, name collisions). Mitigation: `plan` + apply in a sandbox subscription before relying on it.
- **Security of the dev path**: public Postgres with an "allow Azure services" rule (AZ-3) and dev header auth
  (AZ-2). Acceptable only for synthetic data, and it blocks any real-data use.
- **Admin password in state** (Azure `random_password`). Mitigation: restricted state access, then move to
  Entra-only admin.
- **azurerm 5.x is a recent major version.** Attribute names were checked by `validate` against the 5.9.0 schema
  but not by an apply.

## Evidence

- `infra/terraform/check.sh` (2026-10-09, Terraform 1.16.5): `fmt -check` clean; `validate` succeeds for all 6 roots.
- Provider versions taken from the Terraform Registry API on 2026-10-09.
- No `plan`: no CI identity or credentials were provisioned for this project, and this phase forbids billable resources.

## Revisit when

- A second cloud gets an application path. Re-check whether a shared module is now justified by **two real callers**.
- E2–E10 fail on a cloud because of a structural difference (e.g. Postgres role model). The app contract may need to change.
- Operational load or the number of services grows enough that Kubernetes (alternative 3) pays for itself.
- Terraform/OpenTofu licensing or provider support changes materially.
