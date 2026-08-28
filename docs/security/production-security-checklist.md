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
- [x] `ARCHIVED_CHILD_RETENTION_DAYS`, `SECURITY_LOG_RETENTION_DAYS` und `NOTIFICATION_RETENTION_DAYS` gesetzt
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

## Betriebsmonitoring/Alerting

Eingerichtet am 27.08.2026 (Cloudflare Alerting API, Account
`7b4dcfafd89ff61355f5461aa31e779b`), Ziel: `develop.illuminati@gmail.com`.

- [x] **Turnen-api Worker Errors** (`workers_observability_alert`,
      Policy-ID `d8443650c306419da9d6f92231371d5f`) - benachrichtigt bei
      `FIRING_FAILED`-Status eines Workers-Observability-Alerts.
      **Wichtig**: diese Policy ist der Benachrichtigungskanal, nicht die
      Schwellwert-Definition selbst - die zugrundeliegende Observability-
      Alert-Regel (z.B. "Fehlerrate > X% über Y Minuten" für `turnen-api`)
      muss **einmalig im Dashboard** unter Workers & Pages →
      Observability → Alerts angelegt werden (kein REST-Endpunkt dafür in
      der Cloudflare-API gefunden). **MANUAL VERIFICATION REQUIRED**:
      diese zugrundeliegende Alert-Regel existiert und ist an diese
      Notification-Policy gebunden.
- [x] **Kostenanomalie-Indikator** (`billing_budget_alert`,
      Policy-ID `f12816f9ccc5468aa6b07a2952e5035c`, Schwellwert 5 USD) -
      diese App sollte im Free-Tier bleiben; ein Kostenanstieg ist ein
      indirekter Hinweis auf einen Vorfall (Endlosschleife, Missbrauch).
- [ ] **MANUAL VERIFICATION REQUIRED** — kein natives Cloudflare-Alerting
      für D1-Fehler oder fehlgeschlagene Migrationen gefunden (kein
      passender `alert_type` in `/alerting/v3/available_alerts`) - bleibt
      offen, am ehesten über die Observability-Alert-Regel oben indirekt
      miterfasst (D1-Fehler würden i.d.R. als Worker-5xx sichtbar).
- Login-Failures und Passwort-Reset-Anfragen sind **Anwendungsdaten**
  (`login_attempts`, `password_reset_requests` in D1), kein natives
  Cloudflare-Alerting-Ziel - dafür bräuchte es entweder eine periodische
  Worker-Cron-Auswertung mit E-Mail-Versand bei Überschreitung, oder ein
  externes Monitoring-Tool mit D1-Lesezugriff. **Nicht in diesem
  Durchgang umgesetzt** - die zugrundeliegenden Rate-Limits (10
  Login-Fehlversuche/15min, 5 Reset-Anfragen/15min pro E-Mail) verhindern
  bereits Missbrauch technisch, auch ohne aktives Alerting darauf.

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
