terraform {
  required_version = ">= 1.10.0" # S3 native locking (use_lockfile) requires >= 1.10
  required_providers {
    aws    = { source = "hashicorp/aws", version = "6.68.0" }
    random = { source = "hashicorp/random", version = "3.9.1" }
  }
  # Local state by design (bootstrap). See cloud-runbook.md §1.
}

provider "aws" {
  region = var.region
  default_tags { tags = local.tags }
}
