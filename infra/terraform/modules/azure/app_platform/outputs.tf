output "resource_group_name" { value = azurerm_resource_group.this.name }
output "acr_login_server" { value = azurerm_container_registry.this.login_server }
output "key_vault_name" { value = azurerm_key_vault.this.name }
output "key_vault_secret_names" {
  description = "Secrets an operator must set before the first revision starts."
  value       = local.secret_names
}
output "postgres_fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
output "api_fqdn" {
  value = try(azurerm_container_app.app["api"].ingress[0].fqdn, null)
}
output "app_identity_client_id" { value = azurerm_user_assigned_identity.app.client_id }
output "migrate_job_name" { value = azurerm_container_app_job.migrate.name }
output "storage_account_name" { value = azurerm_storage_account.artifacts.name }
output "tags" { value = local.tags }
