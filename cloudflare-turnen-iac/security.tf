# Force HTTPS at the Cloudflare zone.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "always_use_https"
  value      = "on"
}

# Reject TLS < 1.2.
resource "cloudflare_zone_setting" "minimum_tls" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls13" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "tls_1_3"
  value      = "on"
}

# Disable 0-RTT because replay of non-idempotent requests is undesirable
# for authenticated health/child-data APIs.
resource "cloudflare_zone_setting" "zero_rtt" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "0rtt"
  value      = "off"
}

# Avoid Cloudflare serving archived/stale copies when the origin/app is unavailable.
resource "cloudflare_zone_setting" "always_online" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "always_online"
  value      = "off"
}
