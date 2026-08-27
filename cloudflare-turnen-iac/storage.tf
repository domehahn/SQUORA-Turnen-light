# Einzige von diesem Terraform-Projekt verwaltete Cloudflare-Ressource.
#
# Alles andere (beide Worker-Skripte, Route squora.de/turnen-light*,
# Assets-Bindung, Service-Binding, Email-Sending-Bindung, Cron-Trigger,
# Secrets) bleibt bewusst bei Wrangler (turnen/wrangler.toml,
# turnen/worker/wrangler.toml) - das ist kein Kompromiss, sondern der
# von Cloudflare selbst empfohlene Weg: der aktuelle Terraform-Provider
# (cloudflare/cloudflare ~> 5) müsste Worker-Code über
# cloudflare_worker_version (Attribut "modules", Base64/Text-Payload des
# kompilierten Bundles) und alle Assets über einen eigenen "assets"-Block
# hochladen - das würde die JS-Bundles/SPA-Assets im Terraform-State
# duplizieren und mit jedem Deploy einen State-Drift-/Merge-Konflikt
// riskieren, während Wrangler genau dafür gebaut ist. Siehe README.md,
# Abschnitt "Warum nur D1 in Terraform?".
resource "cloudflare_d1_database" "app" {
  account_id = var.cloudflare_account_id
  name       = local.d1_name

  # DSGVO-Anforderung (Finding CF-01 der Privacy/Security-Prüfung): eine
  # echte Jurisdiktionsbeschränkung, kein bloßer Location Hint. Wurde am
  # 2026-08-26 manuell per `wrangler d1 create --jurisdiction eu` gesetzt -
  # beim Import MUSS dieser Wert exakt der bestehenden Datenbank
  # entsprechen, sonst zeigt `terraform plan` fälschlich ein Replacement an
  # (jurisdiction kann nachträglich nicht geändert werden, s. Cloudflare-
  # Dokumentation - ein Replacement würde eine NEUE, leere Datenbank
  # anlegen wollen).
  jurisdiction = "eu"

  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}
