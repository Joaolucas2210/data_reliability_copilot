# ADR-0013 — Dev-only header roles now; Entra ID app roles before any cloud exposure

- **Status:** Accepted (2026-10-09) for local use. **Blocks** any internet-reachable deployment until Entra ID auth is implemented.
- **Deciders:** project owner (Staff Engineer role)

## Context

The UI must show access-denied states, restricted evidence must be hidden from some users, and only approvers may record review
decisions. A real identity provider is out of scope for the local slice. The Azure path (ADR-0011) assumes Entra ID. Separately,
database access must follow least privilege so that neither the agent nor the sandbox can write production.

## Alternatives

1. **No auth locally.** Simplest, but access-denied and redaction paths would never be exercised.
2. **Local OIDC provider (Keycloak/Dex) in Compose.** Realistic, but another heavy service for a single-user demo.
3. **Dev header roles behind an explicit mode switch, refusing other modes** (chosen).

## Decision

- `DRC_AUTH_MODE=dev`: the caller sends `X-DRC-Role: viewer | investigator | approver` (missing means viewer). `api.need(role)` enforces
  rank: viewers read; investigators start investigations and validations; approvers record review decisions. Errors use the
  contract shape (403 `forbidden`, 409 `conflict` for closed incidents or wrong state).
- **Any other `DRC_AUTH_MODE` makes `drc.api` raise at import, so the API refuses to start.** The Azure Container Apps config sets
  `DRC_AUTH_MODE=entra`. Until Entra ID is implemented, a cloud deployment fails closed instead of running header auth on the internet.
- Evidence with `access=restricted` (customer-linked datasets) has `content=null, redacted=true` for viewers.
- Database roles (`infra/local/init.sql`):
  - `dbt_prod`: owns warehouse schemas.
  - `copilot_reader`: SELECT only, `default_transaction_read_only=on`, `statement_timeout=5s`. Used by agent tools and invariants.
  - `app`: app DB only.
  - `sandbox_rw`: own sandbox DBs plus CONNECT on `postgres` for create/drop, `statement_timeout=60s`, no CONNECT on warehouse/app.
  - `marquez`: own DB.
  - `REVOKE CONNECT … FROM PUBLIC` on all databases.
- Target: Entra ID app roles mapped to the same three roles (token validation in FastAPI), managed identity for app → Key Vault/Postgres,
  and per-role Postgres credentials from Key Vault.

## Trade-offs

- Anyone who can reach the local API can claim any role. That's acceptable on 127.0.0.1 (the default bind) with synthetic data only.
- Role checks live in the API. The worker and CLI trust their caller (an operator with DB credentials).

## Risks

- Accidentally exposing the API with `DRC_AUTH_MODE=dev` (e.g. `DRC_API_HOST=0.0.0.0` on a shared host). Mitigation: documented, and cloud config uses `entra`.
- Local passwords are in `init.sql`/`config.py` as **local-only** placeholders. They must never be reused. Cloud secrets live only in Key Vault.

## Evidence

- `tests/test_integration.py::test_api_authorization`: viewer POST returns 403, restricted evidence content is null, the scenario label is hidden.
- `tests/test_integration.py::test_isolation`: the reader can't write (`ReadOnlySqlTransaction`), and the sandbox role can't connect to warehouse/app.
- The UI role switcher exercises the access-denied state (ADR-0012).

## Revisit when

- Before **any** deployment reachable beyond localhost: implement Entra ID token validation and app roles, and remove dev mode from cloud images.
- More than 3 roles, or per-dataset access rules, are needed. Move to policy-as-data (e.g. role → access class matrix in the DB).
