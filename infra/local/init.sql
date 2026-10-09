-- Local bootstrap. Passwords here are LOCAL-ONLY placeholders; cloud envs read secrets from Key Vault.
-- Isolation model (ADR-0007): the sandbox role can only CONNECT to sandbox_* databases.

CREATE ROLE dbt_prod LOGIN PASSWORD 'dbt-local-only';
CREATE ROLE copilot_reader LOGIN PASSWORD 'reader-local-only';
CREATE ROLE app LOGIN PASSWORD 'app-local-only';
CREATE ROLE sandbox_rw LOGIN PASSWORD 'sandbox-local-only' CREATEDB;  -- CREATEDB only to own sandbox_* dbs
CREATE ROLE marquez LOGIN PASSWORD 'marquez-local-only';

ALTER ROLE copilot_reader SET statement_timeout = '5s';
ALTER ROLE copilot_reader SET default_transaction_read_only = on;
ALTER ROLE sandbox_rw SET statement_timeout = '60s';

CREATE DATABASE warehouse OWNER dbt_prod;
CREATE DATABASE app OWNER app;
CREATE DATABASE marquez OWNER marquez;
CREATE DATABASE mlflow OWNER app;

REVOKE CONNECT ON DATABASE warehouse, app, marquez, mlflow, postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE warehouse TO dbt_prod, copilot_reader;
GRANT CONNECT ON DATABASE app TO app;
GRANT CONNECT ON DATABASE marquez TO marquez;
GRANT CONNECT ON DATABASE mlflow TO app;
GRANT CONNECT ON DATABASE postgres TO sandbox_rw;  -- maintenance db: needed to CREATE/DROP its sandbox_* databases

\connect warehouse
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA raw AUTHORIZATION dbt_prod;
CREATE SCHEMA ops AUTHORIZATION dbt_prod;  -- ingestion batches/control totals
-- reader gets SELECT on every current and future table dbt_prod creates
ALTER DEFAULT PRIVILEGES FOR ROLE dbt_prod GRANT SELECT ON TABLES TO copilot_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE dbt_prod GRANT USAGE ON SCHEMAS TO copilot_reader;
GRANT USAGE ON SCHEMA raw, ops TO copilot_reader;
