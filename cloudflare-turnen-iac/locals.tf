locals {
  # Realer Name der produktiven Datenbank (Migration auf EU-Jurisdiction
  # am 2026-08-26, siehe docs/privacy/cloudflare-data-flow.md im
  # Hauptprojekt) - bewusst NICHT "${project_name}-${environment}-db" wie
  # im ursprünglichen generischen Namensschema, sondern der tatsächliche,
  # bereits produktiv verwendete Name. Beim Import muss dieser Name exakt
  # mit der bestehenden Datenbank übereinstimmen.
  d1_name = "turnen-eu"
}
