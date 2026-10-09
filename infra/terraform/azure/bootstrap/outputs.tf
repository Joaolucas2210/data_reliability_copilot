output "state_resource_group" { value = azurerm_resource_group.state.name }
output "state_storage_account" { value = azurerm_storage_account.state.name }
output "state_container" { value = azurerm_storage_container.state.name }
output "ci_client_id" {
  description = "Set as GitHub variable AZURE_CLIENT_ID (not a secret)."
  value       = azurerm_user_assigned_identity.ci.client_id
}
output "ci_principal_id" { value = azurerm_user_assigned_identity.ci.principal_id }
