variable "subscription_id" { type = string }
variable "owner" { type = string }
variable "cost_center" { type = string }
variable "budget_contact_emails" { type = list(string) }
variable "budget_start_date" { type = string }
variable "image_tag" { type = string }
variable "ci_principal_id" {
  type    = string
  default = null
}
variable "allowed_client_ips" {
  type    = list(string)
  default = []
}
