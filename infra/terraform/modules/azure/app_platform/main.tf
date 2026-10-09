# Reference implementation of the DRC app platform on Azure (ADR-0011).
# Naming: <abbr>-<app>-<env>-<region-short>; globally unique names add a random suffix.
# Secrets: only names/references live here. Values are set out-of-band in Key Vault (cloud-runbook.md).

locals {
  region_short = substr(replace(var.location, "/[^a-z]/", ""), 0, 6)
  base         = "${var.app}-${var.env}-${local.region_short}"
  compact      = "${var.app}${var.env}${random_string.suffix.result}"
  tags = {
    app         = var.app
    env         = var.env
    owner       = var.owner
    cost_center = var.cost_center
    managed_by  = "terraform"
    repo        = "data-reliability-copilot"
  }
  databases = ["warehouse", "app", "marquez", "mlflow"] # sandbox_* DBs are created/dropped per validation run
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.base}"
  location = var.location
  tags     = local.tags
}

# ---------- observability ----------
resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${local.base}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 1 # cost guardrail; ingestion stops for the day when hit
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  name                = "appi-${local.base}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "other"
  tags                = local.tags
}

# ---------- identity ----------
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.base}-app"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

# ---------- registry ----------
resource "azurerm_container_registry" "this" {
  name                = "acr${local.compact}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_role_assignment" "app_acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_role_assignment" "ci_acr_push" {
  count                = var.ci_principal_id == null ? 0 : 1
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = var.ci_principal_id
}

# ---------- secrets ----------
resource "azurerm_key_vault" "this" {
  name                          = "kv-${local.compact}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.this.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = var.env == "prd"
  soft_delete_retention_days    = 7
  public_network_access_enabled = true # ponytail: private endpoint + VNet integration is parity-gap item AZ-3
  tags                          = local.tags
}

resource "azurerm_role_assignment" "app_kv_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Names of secrets the app expects. Values are written by an operator (runbook), never by Terraform,
# so they never land in state.
locals {
  secret_names = ["pg-app-password", "pg-dbt-prod-password", "pg-reader-password", "pg-sandbox-password", "llm-api-key"]
}

# ---------- storage (run artifacts, lineage files, eval artifacts) ----------
resource "azurerm_storage_account" "artifacts" {
  name                            = "st${local.compact}"
  location                        = var.location
  resource_group_name             = azurerm_resource_group.this.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  tags                            = local.tags

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_container" "artifacts" {
  for_each              = toset(["run-artifacts", "eval-artifacts", "lineage"])
  name                  = each.key
  storage_account_id    = azurerm_storage_account.artifacts.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "retention" {
  storage_account_id = azurerm_storage_account.artifacts.id
  rule {
    name    = "expire-run-artifacts"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["run-artifacts/", "lineage/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 90
      }
    }
  }
}

resource "azurerm_role_assignment" "app_blob" {
  scope                = azurerm_storage_account.artifacts.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# ---------- PostgreSQL ----------
# Public access + firewall in this phase (no VNet). Admin password is generated and stored ONLY in state +
# Key Vault is the source of truth for role passwords. Entra auth enabled for operators.
resource "random_password" "pg_admin" {
  length  = 32
  special = false
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-${local.base}-${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.this.name
  version                       = var.postgres_version
  sku_name                      = var.postgres_sku
  storage_mb                    = 32768
  backup_retention_days         = var.postgres_backup_retention_days
  geo_redundant_backup_enabled  = false # documented trade-off: single-region RPO; revisit for prd
  public_network_access_enabled = true
  administrator_login           = var.postgres_admin_login
  administrator_password        = random_password.pg_admin.result
  zone                          = "1"
  tags                          = local.tags

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }

  lifecycle {
    prevent_destroy = false # set true for prd via a separate env root
    ignore_changes  = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "db" {
  for_each  = toset(local.databases)
  name      = each.key
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  # 0.0.0.0 = "allow Azure services". Broad; replaced by VNet integration in parity-gap AZ-3.
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "operators" {
  for_each         = toset(var.allowed_client_ips)
  name             = "op-${replace(each.key, ".", "-")}"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = each.key
  end_ip_address   = each.key
}

# ---------- Container Apps ----------
resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${local.base}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  tags                       = local.tags
}

locals {
  common_env = {
    DRC_PG_HOST                           = azurerm_postgresql_flexible_server.this.fqdn
    DRC_PG_PORT                           = "5432"
    DRC_AUTH_MODE                         = "entra" # not implemented yet: app refuses to start in this mode (ADR-0013)
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.this.connection_string
    OTEL_SERVICE_NAME                     = "drc"
    DRC_API_HOST                          = "0.0.0.0" # container ingress; default 127.0.0.1 is local-only
  }
  kv_secret_env = {
    DRC_APP_PASSWORD      = "pg-app-password"      # gitleaks:allow (Key Vault secret NAME, not a value)
    DRC_DBT_PROD_PASSWORD = "pg-dbt-prod-password" # gitleaks:allow (Key Vault secret NAME, not a value)
    DRC_READER_PASSWORD   = "pg-reader-password"   # gitleaks:allow (Key Vault secret NAME, not a value)
    DRC_SANDBOX_PASSWORD  = "pg-sandbox-password"  # gitleaks:allow (Key Vault secret NAME, not a value)
    ANTHROPIC_API_KEY     = "llm-api-key"
  }
  apps = {
    api    = { command = ["drc", "api"], cpu = 0.5, memory = "1Gi", ingress = true, min = var.api_min_replicas }
    worker = { command = ["drc", "worker"], cpu = 1.0, memory = "2Gi", ingress = false, min = 0 }
  }
}

resource "azurerm_container_app" "app" {
  for_each                     = local.apps
  name                         = "ca-${local.base}-${each.key}"
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  dynamic "secret" {
    for_each = local.kv_secret_env
    content {
      name                = secret.value
      key_vault_secret_id = "${azurerm_key_vault.this.vault_uri}secrets/${secret.value}"
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  template {
    min_replicas = each.value.min
    max_replicas = each.key == "worker" ? 1 : 2 # worker=1: single consumer keeps sandbox concurrency at 1

    container {
      name    = each.key
      image   = "${azurerm_container_registry.this.login_server}/drc:${var.image_tag}"
      command = each.value.command
      cpu     = each.value.cpu
      memory  = each.value.memory

      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.kv_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  dynamic "ingress" {
    for_each = each.value.ingress ? [1] : []
    content {
      external_enabled = true
      target_port      = 8000
      transport        = "auto"
      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }

  depends_on = [azurerm_role_assignment.app_acr_pull, azurerm_role_assignment.app_kv_secrets_user]
}

# Migrations run as a manually-triggered job BEFORE a new app revision is rolled out (cloud-runbook.md).
resource "azurerm_container_app_job" "migrate" {
  name                         = "caj-${local.base}-migrate"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 0
  tags                         = local.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "pg-app-password"
    key_vault_secret_id = "${azurerm_key_vault.this.vault_uri}secrets/pg-app-password"
    identity            = azurerm_user_assigned_identity.app.id
  }

  template {
    container {
      name    = "migrate"
      image   = "${azurerm_container_registry.this.login_server}/drc:${var.image_tag}"
      command = ["drc", "migrate"]
      cpu     = 0.25
      memory  = "0.5Gi"
      env {
        name  = "DRC_PG_HOST"
        value = azurerm_postgresql_flexible_server.this.fqdn
      }
      env {
        name        = "DRC_APP_PASSWORD"
        secret_name = "pg-app-password"
      }
    }
  }

  depends_on = [azurerm_role_assignment.app_kv_secrets_user]
}

# ---------- budget ----------
resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "budget-${local.base}"
  resource_group_id = azurerm_resource_group.this.id
  amount            = var.monthly_budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.budget_contact_emails
  }

  notification {
    enabled        = true
    threshold      = 90
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = var.budget_contact_emails
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
