terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "5.9.0" }
    random  = { source = "hashicorp/random", version = "3.9.1" }
  }
  # Partial backend config: values in backend.hcl (generated from bootstrap outputs, not committed).
  # terraform init -backend-config=backend.hcl
  backend "azurerm" {
    container_name   = "tfstate"
    key              = "azure/dev/app.tfstate"
    use_azuread_auth = true
    use_oidc         = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}
