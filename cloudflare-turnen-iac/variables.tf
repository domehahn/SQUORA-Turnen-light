variable "cloudflare_account_id" {
  description = "Cloudflare Account ID."
  type        = string
}

# Nur nötig, falls manage_zone_settings = true (s. security.tf) - die
# Turnen-App selbst braucht keine eigene Zone: sie läuft unter
# squora.de/turnen-light/ auf der bestehenden, von mehreren Projekten
# gemeinsam genutzten Zone squora.de (kein Custom Domain/Subdomain für
# dieses Projekt).
variable "cloudflare_zone_id" {
  description = "Zone ID von squora.de - nur für optionale Zone-weite Security-Settings (siehe manage_zone_settings)."
  type        = string
  default     = null
}

variable "project_name" {
  description = "Kurzer Bezeichner für Ressourcennamen dieses Projekts."
  type        = string
  default     = "turnen"
}

variable "environment" {
  description = "Deployment-Umgebung."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

# Zone-weite Einstellungen (TLS, 0-RTT, Always Online) gelten für die
# GESAMTE Zone squora.de, nicht nur für /turnen-light/ - squora.de hostet
# mehrere Projekte (u.a. das Referenzprojekt tournament-manager) auf
# demselben Zonen-Objekt. Dieses Terraform-Projekt darf solche Einstellungen
# NICHT unilateral verwalten, ohne das mit den anderen Projekten auf
# derselben Zone abzustimmen - deshalb standardmäßig deaktiviert (false).
# Nur aktivieren, wenn ausdrücklich geklärt ist, dass dieses Repository die
# Quelle der Wahrheit für die Zonen-Einstellungen von squora.de sein soll.
variable "manage_zone_settings" {
  description = "Zone-weite Security-Settings für squora.de verwalten (WARNUNG: wirkt auf ALLE Projekte der gemeinsam genutzten Zone, nicht nur turnen-light). Standardmäßig aus."
  type        = bool
  default     = false
}
