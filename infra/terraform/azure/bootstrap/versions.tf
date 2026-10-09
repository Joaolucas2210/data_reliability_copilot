terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "5.9.0" }
    random  = { source = "hashicorp/random", version = "3.9.1" }
  }
  # Bootstrap uses LOCAL state by design (chicken-and-egg). After apply, keep the state file in a
  # restricted operator location or migrate it into the container it created (cloud-runbook.md §1).
}

provider "azurerm" {
  features {}
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}
