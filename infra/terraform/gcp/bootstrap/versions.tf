terraform {
  required_version = ">= 1.9.0"
  required_providers {
    google = { source = "hashicorp/google", version = "8.6.0" }
  }
  # Local state by design (bootstrap). GCS backend locks natively via object generation preconditions.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
