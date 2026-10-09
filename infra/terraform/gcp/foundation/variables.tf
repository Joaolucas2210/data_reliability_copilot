variable "project_id" { type = string }
variable "project_number" {
  type        = string
  description = "Numeric project number (Workload Identity principal URIs use it)."
}
variable "region" {
  type    = string
  default = "southamerica-east1"
}
variable "app" {
  type    = string
  default = "drc"
}
variable "env" {
  type = string
  validation {
    condition     = contains(["dev", "stg", "prd"], var.env)
    error_message = "env must be dev, stg or prd."
  }
}
variable "owner" { type = string }
variable "cost_center" { type = string }
variable "github_repository" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use owner/repo."
  }
}
variable "billing_account_id" { type = string }
variable "monthly_budget_units" {
  type        = number
  description = "Budget in the billing account currency."
  validation {
    condition     = var.monthly_budget_units > 0 && var.monthly_budget_units <= 1000
    error_message = "Budget must be in (0, 1000]."
  }
}
variable "state_bucket" { type = string }
