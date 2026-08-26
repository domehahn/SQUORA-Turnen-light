resource "cloudflare_worker" "api" {
  account_id = var.cloudflare_account_id
  name       = local.worker_name

  # Do not push Worker logs globally by default for this high-sensitivity app.
  logpush = false

  # Enable only after application-level PII/health-data redaction is verified.
  observability = {
    enabled = false
  }

  # Disable public workers.dev and preview URLs.
  subdomain = {
    enabled          = false
    previews_enabled = false
  }

  tags = [
    "application:${var.project_name}",
    "environment:${var.environment}",
    "data-classification:special-category-health"
  ]
}

resource "cloudflare_workers_custom_domain" "api" {
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = local.api_hostname
  service    = cloudflare_worker.api.name
}
