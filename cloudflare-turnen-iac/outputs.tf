output "app_url" {
  value = "https://${local.app_hostname}"
}

output "api_url" {
  value = "https://${local.api_hostname}"
}

output "pages_project_name" {
  value = cloudflare_pages_project.web.name
}

output "worker_name" {
  value = cloudflare_worker.api.name
}

output "d1_database_name" {
  value = cloudflare_d1_database.app.name
}

output "d1_database_id" {
  value = cloudflare_d1_database.app.id
}

output "d1_jurisdiction" {
  value = cloudflare_d1_database.app.jurisdiction
}

output "export_bucket_name" {
  value = var.enable_export_bucket ? cloudflare_r2_bucket.exports[0].name : null
}

output "export_bucket_jurisdiction" {
  value = var.enable_export_bucket ? cloudflare_r2_bucket.exports[0].jurisdiction : null
}
