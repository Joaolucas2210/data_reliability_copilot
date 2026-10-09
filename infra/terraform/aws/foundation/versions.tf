terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.68.0" }
  }
  # terraform init -backend-config="bucket=<state_bucket from bootstrap>"
  backend "s3" {
    key          = "aws/dev/foundation.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.tags }
}
