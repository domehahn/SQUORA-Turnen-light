# WARNUNG: squora.de ist eine gemeinsam genutzte Zone (u.a. mit dem
# Referenzprojekt tournament-manager) - diese Einstellungen wirken auf die
# GESAMTE Zone, nicht nur auf /turnen-light/. Deshalb per
# var.manage_zone_settings standardmäßig deaktiviert (count = 0). Nur
# aktivieren, wenn geklärt ist, dass dieses Repository die Quelle der
# Wahrheit für squora.de-Zoneneinstellungen sein soll - sonst können
# zwei verschiedene IaC-Projekte gegeneinander "kämpfen" (jeder apply
# überschreibt die Änderungen des anderen Projekts).

resource "cloudflare_zone_setting" "always_use_https" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "minimum_tls" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls13" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  setting_id = "tls_1_3"
  value      = "on"
}

# 0-RTT deaktiviert: Replay von nicht-idempotenten Requests ist für
# authentifizierte Kinder-/Anwesenheitsdaten-APIs unerwünscht.
resource "cloudflare_zone_setting" "zero_rtt" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  setting_id = "0rtt"
  value      = "off"
}

resource "cloudflare_zone_setting" "always_online" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  setting_id = "always_online"
  value      = "off"
}
