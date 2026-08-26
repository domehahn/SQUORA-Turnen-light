resource "cloudflare_d1_database" "app" {
  account_id   = var.cloudflare_account_id
  name         = local.d1_name
  jurisdiction = "eu"

  # For sensitive child/health data, avoid automatic global read replicas.
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "exports" {
  count = var.enable_export_bucket ? 1 : 0

  account_id    = var.cloudflare_account_id
  name          = local.export_bucket_name
  jurisdiction  = "eu"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_lifecycle" "exports" {
  count = var.enable_export_bucket ? 1 : 0

  account_id    = var.cloudflare_account_id
  bucket_name   = cloudflare_r2_bucket.exports[0].name
  jurisdiction  = "eu"

  rules = [{
    id      = "delete-short-lived-exports"
    enabled = true

    conditions = {
      prefix = ""
    }

    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = var.export_retention_seconds
      }
    }

    abort_multipart_uploads_transition = {
      condition = {
        type    = "Age"
        max_age = 86400
      }
    }
  }]
}
