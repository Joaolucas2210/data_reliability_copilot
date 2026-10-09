variable "project_id" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Invalid GCP project id."
  }
}
variable "region" {
  type    = string
  default = "southamerica-east1"
}
variable "app" {
  type    = string
  default = "drc"
}
variable "owner" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9_-]{1,63}$", var.owner))
    error_message = "GCP labels: lowercase letters, digits, _ and - only."
  }
}
