# GCP foundation: CI federation (Workload Identity Federation), registry, secret containers, budget.
# Runtime (Cloud Run + Cloud SQL + VPC) is NOT implemented — see docs/multicloud/parity-gap.md.
locals {
  name         = "${var.app}-${var.env}"
  labels       = { app = var.app, env = var.env, owner = var.owner, cost_center = var.cost_center, managed_by = "terraform" }
  secret_names = ["pg-app-password", "pg-dbt-prod-password", "pg-reader-password", "pg-sandbox-password", "llm-api-key"]
  services = ["iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com", "billingbudgets.googleapis.com", "cloudresourcemanager.googleapis.com"]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.key
  disable_on_destroy = false
}

# ---- Workload Identity Federation for GitHub Actions ----
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${local.name}-github"
  display_name              = "GitHub Actions (${var.env})"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Only tokens from this repository are accepted at all.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci" {
  account_id   = "${local.name}-ci"
  display_name = "DRC CI (${var.env})"
}

resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.repository/${var.github_repository}"
}

resource "google_storage_bucket_iam_member" "ci_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.ci.email}"
}

# ---- registry ----
resource "google_artifact_registry_repository" "app" {
  repository_id = local.name
  location      = var.region
  format        = "DOCKER"
  labels        = local.labels
  docker_config {
    immutable_tags = true
  }
  cleanup_policies {
    id     = "keep-last-20"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_artifact_registry_repository_iam_member" "ci_push" {
  repository = google_artifact_registry_repository.app.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.ci.email}"
}

# ---- secret containers (no versions/values here) ----
resource "google_secret_manager_secret" "app" {
  for_each  = toset(local.secret_names)
  secret_id = "${local.name}-${each.key}"
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

# ---- budget ----
resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${local.name}-monthly"

  budget_filter {
    projects = ["projects/${var.project_number}"]
    labels   = { app = var.app }
  }

  amount {
    specified_amount {
      units = tostring(var.monthly_budget_units)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "FORECASTED_SPEND"
  }
  depends_on = [google_project_service.enabled]
}
