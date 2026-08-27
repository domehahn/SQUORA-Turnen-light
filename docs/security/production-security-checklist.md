# Production Security Checklist — Turnen (SQUORA)

Konsolidierte Checkliste für den Go-Live. Ergänzt (nicht ersetzt)
`docs/security/cloudflare-production-checklist.md` (Cloudflare-
Infrastruktur-Fokus). Status-Legende wie in
`PRODUCTION_GO_LIVE_REPORT.md`: PASS / FAIL / MANUAL VERIFICATION
REQUIRED / LEGAL-PRIVACY REVIEW REQUIRED.

## Automatisiert geprüft (`scripts/production-readiness-check.ts`, läuft in CI)

- [x] Kein `health_notes`/`children.notes`/medizinisches Feld im aktiven Code
- [x] Kein PWA-Caching (`runtimeCaching`) für `/api/*`
- [x] `workers_dev=false` + `preview_urls=false` (beide Worker)
- [x] D1 `database_name = turnen-eu`
- [x] IaC: `jurisdiction = "eu"`, `prevent_destroy = true`
- [x] `ARCHIVED_CHILD_RETENTION_DAYS` und `SECURITY_LOG_RETENTION_DAYS` gesetzt
- [x] CSP-Header vorhanden, kein `unsafe-eval`
- [x] Session-Cookie `httpOnly: true`
- [x] Kein JWT/Session-Token in `localStorage`
- [x] Keine erkennbaren Secrets im Quellcode/Frontend-Build
- [x] Keine offensichtlichen sensiblen `console.log`-Aufrufe
- [x] CI enthält einen Security-Job, minimale Permissions, SHA-gepinnte Actions

## Manuell zu verifizieren (Cloudflare Dashboard, nicht aus dem Repo ableitbar)

- [ ] **MANUAL VERIFICATION REQUIRED** — TLS-Minimum-Version (mind. TLS 1.2, empfohlen 1.3) für die Zone `squora.de`
- [ ] **MANUAL VERIFICATION REQUIRED** — Cache Rules überschreiben nicht die `Cache-Control: no-store`-Header von `/api/*`
- [ ] **MANUAL VERIFICATION REQUIRED** — WAF/Bot-Management-Regeln (falls lizenziert) aktiv für die Zone
- [ ] **MANUAL VERIFICATION REQUIRED** — Cloudflare Access NICHT versehentlich vor `/turnen-light/*` geschaltet (würde die eigene Auth umgehen/blockieren)
- [ ] **MANUAL VERIFICATION REQUIRED** — Rate Limiting Rules (Edge-Ebene) für `/api/login` und `/api/password-reset/request` als zusätzliche Schicht zum Anwendungs-Rate-Limiting
- [ ] **MANUAL VERIFICATION REQUIRED** — Logpush/Analytics-Ziel (falls konfiguriert) enthält keine PII in URLs/Query-Strings

## Betriebsmonitoring/Alerting (nicht in diesem Durchgang eingerichtet)

- [ ] **MANUAL VERIFICATION REQUIRED** — Alert bei ungewöhnlich vielen Login-Failures (Cloudflare Notifications oder externes Monitoring)
- [ ] **MANUAL VERIFICATION REQUIRED** — Alert bei ungewöhnlich vielen Passwort-Reset-Anfragen
- [ ] **MANUAL VERIFICATION REQUIRED** — Alert bei 5xx-Spike (Workers Analytics)
- [ ] **MANUAL VERIFICATION REQUIRED** — Alert bei D1-Fehlern
- [ ] **MANUAL VERIFICATION REQUIRED** — Alert bei fehlgeschlagenen Migrationen

## Audit-Log-Abdeckung (in `worker/src/index.ts` verifiziert)

Auditiert: `login` (Erfolg/Fehlschlag über `login_attempts`, getrennt vom
`audit_log`), `password_changed`, `password_reset_via_email`,
`admin.user_password_reset`, `mfa.enabled`, `mfa.disabled`, `mfa.rotated`,
`profile.sessions_revoked`, `security.unknown_tenant_relation_denied`,
`security.dangling_group_reference_denied`, `admin.user_created`,
`admin.user_updated`, `admin.privilege_change` (isAdmin-Änderung läuft
über `admin.user_updated`), Kind-/Gruppen-/Familien-Mutationen. Keine
Secrets/Passwörter/Klartext-Kontaktdaten in `target_label`.

## Legal/Organisatorisch (siehe auch `PRODUCTION_GO_LIVE_REPORT.md`)

- [ ] **LEGAL/PRIVACY REVIEW REQUIRED** — Retention-Frist (1095 Tage /
      3 Jahre für archivierte Kinder, 90 Tage für Security-Logs) fachlich/
      rechtlich final freigegeben, nicht nur technisch gesetzt
- [ ] **LEGAL/PRIVACY REVIEW REQUIRED** — Cloudflare DPA/AVV abgeschlossen
- [ ] **LEGAL/PRIVACY REVIEW REQUIRED** — Datenschutzerklärung aktuell
      (spiegelt den technischen Stand: keine Gesundheitsdaten, EU-D1,
      Verschlüsselung von Kontaktdaten, MFA-Modell)
- [ ] **LEGAL/PRIVACY REVIEW REQUIRED** — Verzeichnis von
      Verarbeitungstätigkeiten aktuell
- [ ] **LEGAL/PRIVACY REVIEW REQUIRED** — DSFA-Schwellenprüfung
      (Verarbeitung von Minderjährigen-Daten kann eine DSFA auslösen,
      abhängig vom Umfang - juristisch zu bewerten)

## Nicht behauptet

Dieses Dokument behauptet **nicht** "DSGVO-konform" oder "100% sicher".
Es listet, was technisch verifiziert wurde (automatisiert oder durch
Code-Review in dieser Session) und was manuell/rechtlich noch offen ist.
