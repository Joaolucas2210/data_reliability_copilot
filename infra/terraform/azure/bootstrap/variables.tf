variable "subscription_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f-]{36}$", var.subscription_id))
    error_message = "subscription_id must be a GUID."
  }
}

variable "location" {
  type    = string
  default = "brazilsouth"
}

variable "app" {
  type    = string
  default = "drc"
}

variable "owner" {
  type = string
}

variable "github_repository" {
  type        = string
  description = "owner/repo allowed to federate (GitHub OIDC)."
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use the form owner/repo."
  }
}

variable "github_environments" {
  type        = list(string)
  description = "GitHub environments whose jobs may assume the CI identity (subject environment:<name>)."
  default     = ["dev"]
}
