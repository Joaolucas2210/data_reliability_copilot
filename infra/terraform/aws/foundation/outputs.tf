output "ci_role_arn" {
  description = "Set as GitHub variable AWS_CI_ROLE_ARN (not a secret)."
  value       = aws_iam_role.ci.arn
}
output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "secret_arns" { value = { for k, s in aws_secretsmanager_secret.app : k => s.arn } }
output "kms_key_arn" { value = aws_kms_key.app.arn }
