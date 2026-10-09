module "app_platform" {
  source = "../../../modules/azure/app_platform"

  env                   = "dev"
  location              = "brazilsouth"
  owner                 = var.owner
  cost_center           = var.cost_center
  monthly_budget_amount = 50
  budget_contact_emails = var.budget_contact_emails
  budget_start_date     = var.budget_start_date
  image_tag             = var.image_tag
  ci_principal_id       = var.ci_principal_id
  allowed_client_ips    = var.allowed_client_ips
  api_min_replicas      = 0 # scale-to-zero in dev
}

output "app_platform" { value = module.app_platform }
