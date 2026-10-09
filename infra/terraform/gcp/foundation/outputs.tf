output "workload_identity_provider" {
  description = "Set as GitHub variable GCP_WIF_PROVIDER (not a secret)."
  value       = google_iam_workload_identity_pool_provider.github.name
}
output "ci_service_account" { value = google_service_account.ci.email }
output "artifact_registry" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}" }
output "secret_ids" { value = { for k, s in google_secret_manager_secret.app : k => s.id } }
