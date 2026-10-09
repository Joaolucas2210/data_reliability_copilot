variable "region" {
  type    = string
  default = "sa-east-1"
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
variable "state_bucket_arn" { type = string }
variable "monthly_budget_usd" {
  type = number
  validation {
    condition     = var.monthly_budget_usd > 0 && var.monthly_budget_usd <= 1000
    error_message = "Budget must be in (0, 1000]."
  }
}
variable "budget_contact_emails" { type = list(string) }
variable "create_github_oidc_provider" {
  type        = bool
  default     = true
  description = "Set false if the account already has the token.actions.githubusercontent.com provider (one per account)."
}
