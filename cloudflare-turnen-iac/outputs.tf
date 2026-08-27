output "d1_database_name" {
  value = cloudflare_d1_database.app.name
}

# = "uuid" bei diesem Provider, nicht "id" - für turnen/worker/wrangler.toml
# (d1_databases[].database_id) siehe README.md.
output "d1_database_id" {
  value = cloudflare_d1_database.app.uuid
}

output "d1_jurisdiction" {
  value = cloudflare_d1_database.app.jurisdiction
}
