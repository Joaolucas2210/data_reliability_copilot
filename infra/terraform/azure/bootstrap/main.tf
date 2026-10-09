# Remote state + CI identity for Azure. State locking: azurerm backend uses native blob leases.
locals {
  tags = { app = var.app, owner = var.owner, managed_by = "terraform", component = "tfstate" }
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_resource_group" "state" {
  name     = "rg-${var.app}-tfstate"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "state" {
  name                            = "st${var.app}tfstate${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.state.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false # Entra ID only (backend: use_azuread_auth = true)
  tags                            = local.tags

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

resource "azurerm_management_lock" "state" {
  name       = "tfstate-cannot-delete"
  scope      = azurerm_storage_account.state.id
  lock_level = "CanNotDelete"
  notes      = "Terraform state for all DRC Azure environments."
}

# ---- CI identity: GitHub Actions federates via OIDC; no client secret exists anywhere ----
resource "azurerm_user_assigned_identity" "ci" {
  name                = "id-${var.app}-ci-github"
  resource_group_name = azurerm_resource_group.state.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_env" {
  for_each                  = toset(var.github_environments)
  name                      = "github-${each.key}"
  user_assigned_identity_id = azurerm_user_assigned_identity.ci.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_repository}:environment:${each.key}"
}

resource "azurerm_federated_identity_credential" "github_pr" {
  # read-only plan on pull requests
  name                      = "github-pull-request"
  user_assigned_identity_id = azurerm_user_assigned_identity.ci.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_repository}:pull_request"
}

resource "azurerm_role_assignment" "ci_state" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.ci.principal_id
}
# Subscription/RG-level roles for the CI identity (Reader for plan, Contributor for apply on env RGs)
# are granted per environment by an operator — deliberately not here (least privilege, cloud-runbook.md §2).
