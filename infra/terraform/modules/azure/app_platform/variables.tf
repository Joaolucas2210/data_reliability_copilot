variable "env" {
  type        = string
  description = "Environment short name."
  validation {
    condition     = contains(["dev", "stg", "prd"], var.env)
    error_message = "env must be dev, stg or prd."
  }
}

variable "location" {
  type    = string
  default = "brazilsouth"
}

variable "app" {
  type    = string
  default = "drc"
  validation {
    condition     = can(regex("^[a-z0-9]{2,6}$", var.app))
    error_message = "app must be 2-6 lowercase alphanumerics (used in globally unique names)."
  }
}

variable "owner" {
  type        = string
  description = "Owner tag (team or person e-mail alias)."
}

variable "cost_center" {
  type = string
}

variable "monthly_budget_amount" {
  type        = number
  description = "Monthly budget in the subscription billing currency."
  validation {
    condition     = var.monthly_budget_amount > 0 && var.monthly_budget_amount <= 1000
    error_message = "Budget must be between 0 and 1000 for this phase."
  }
}

variable "budget_contact_emails" {
  type = list(string)
  validation {
    condition     = length(var.budget_contact_emails) > 0
    error_message = "At least one budget contact e-mail is required."
  }
}

variable "budget_start_date" {
  type        = string
  description = "First day of a month, RFC3339 (e.g. 2026-11-01T00:00:00Z). Must not be in the past at create time."
}

variable "image_tag" {
  type        = string
  description = "Immutable image tag (git SHA) for api and worker images."
  validation {
    condition     = var.image_tag != "latest"
    error_message = "Use an immutable tag, never 'latest'."
  }
}

variable "postgres_sku" {
  type    = string
  default = "B_Standard_B1ms"
}

variable "postgres_version" {
  type    = string
  default = "17"
}

variable "postgres_backup_retention_days" {
  type    = number
  default = 7
  validation {
    condition     = var.postgres_backup_retention_days >= 7 && var.postgres_backup_retention_days <= 35
    error_message = "Azure Flexible Server supports 7-35 days."
  }
}

variable "postgres_admin_login" {
  type    = string
  default = "drcadmin"
}

variable "allowed_client_ips" {
  type        = list(string)
  description = "Operator IPs allowed through the Postgres firewall (public-access mode). Empty = none."
  default     = []
}

variable "ci_principal_id" {
  type        = string
  description = "Object id of the CI identity (federated) that pushes images; gets AcrPush."
  default     = null
}

variable "api_min_replicas" {
  type    = number
  default = 0
}
