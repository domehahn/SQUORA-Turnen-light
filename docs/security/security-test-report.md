# Security Test Report — Turnen (SQUORA)

Stand: dieser Durchgang, gegen Commit `e7d25358f7415e294f29d28a4575f8abb6277afa`
(genauer: siehe `git log`, dies ist der Commit unmittelbar nach der
Härtung, vor Dokumentation). 86/86 automatisierte Tests grün
(`turnen/worker/test/*.test.ts`, echte Cloudflare-Workers-Runtime via
`@cloudflare/vitest-pool-workers`, isolierte In-Memory-D1 pro Testlauf -
ausschließlich synthetische Testdaten, keine Produktionsdaten).

## Testabdeckung nach Kategorie

| Kategorie | Testdatei(en) | Anzahl |
|---|---|---|
| Tenant-Isolation (`children`, `families`) + Fail-closed | `tenant-isolation.test.ts` | 14 |
| BOLA/IDOR (Kinder, Attendance, Admin) | `authorization.test.ts` | 18 |
| Session-Management (Idle/Absolute-Timeout, Revocation) | `session-management.test.ts` | 9 |
| MFA (Setup, Rotation, Backup-Codes, Durchsetzung) | `mfa.test.ts` | 16 |
| Passwort (Hashing, Reset, Policy, Rate-Limit) | `password-hashing.test.ts`, `password-reset.test.ts` | 14 |
| Erzwungener Passwortwechsel | `password-change-required.test.ts` | 6 |
| CSRF | `csrf.test.ts` | 4 |
| Retention | `retention.test.ts` | 2 |
| Verschlüsselung at rest | `encryption.test.ts` | 3 |

## OWASP API Top 10 — Abdeckung

| Risiko | Abgedeckt durch | Status |
|---|---|---|
| API1 Broken Object Level Authorization (BOLA) | `authorization.test.ts`, `tenant-isolation.test.ts` | ✅ automatisiert |
| API2 Broken Authentication | `mfa.test.ts`, `password-*.test.ts`, `session-management.test.ts` | ✅ automatisiert |
| API3 Broken Object Property Level Authorization | Least-Privilege-Redaktion (Notfallkontakte) - kein dedizierter Test in diesem Durchgang | 🟡 teilweise |
| API4 Unrestricted Resource Consumption | Rate Limiting (Login, Passwort-Reset) | 🟡 teilweise (kein IP-Limit, s. `threat-model.md`) |
| API5 Broken Function Level Authorization | `requireAdmin`, Rollen-Tests in `authorization.test.ts` | ✅ automatisiert |
| API6 Unrestricted Access to Sensitive Business Flows | Rate Limiting Passwort-Reset | ✅ |
| API7 Server Side Request Forgery | Keine ausgehenden Requests basierend auf Nutzereingaben identifiziert | N/A |
| API8 Security Misconfiguration | CSP/HSTS-Header, `workers_dev=false`, `production-readiness-check.ts` | ✅ automatisiert (statisch) |
| API9 Improper Inventory Management | `docs/security/tenant-model.md` | ✅ dokumentiert |
| API10 Unsafe Consumption of APIs | HIBP (Pwned Passwords API) - Fail-open bei Nichterreichbarkeit (bewusst, verhindert Lockout) | ✅ bewertet |

## Manuell/nicht in diesem Durchgang geprüft

- **DAST** (aktiver Scan gegen eine laufende Instanz): nicht durchgeführt.
  Kein Production-Scan (explizit verboten ohne Freigabe), und kein
  lokales `wrangler dev`-Setup mit einem DAST-Tool (OWASP ZAP o.ä.) in
  dieser Session aufgesetzt. **Empfehlung**: vor Go-Live einmalig gegen
  eine Preview-/Staging-Umgebung (nicht Produktion) mit synthetischen
  Daten durchführen.
- **Externer Penetrationstest**: nicht durchgeführt, organisatorisches
  Vorhaben außerhalb des Scopes einer Code-Session. Siehe
  `PRODUCTION_GO_LIVE_REPORT.md` (Manual Gate).
- **XSS**: kein dediziertes automatisiertes XSS-Testing. Mitigierende
  Kontrollen vorhanden (CSP ohne `unsafe-eval`, React JSX-Escaping als
  Standard, HttpOnly-Cookie verhindert Session-Diebstahl selbst bei
  erfolgreichem XSS). Kein Freitextfeld mit HTML-Rendering identifiziert.
- **Injection (SQL)**: durchgängig parametrisierte Queries (`db.prepare(...).bind(...)`)
  im gesamten `worker/src/db.ts` - keine String-Konkatenation von
  Nutzereingaben in SQL gefunden (Stichprobenprüfung, kein dediziertes
  SAST-Tool-Ergebnis in dieser Session, aber CodeQL läuft jetzt in CI, s.
  `production-security-checklist.md`).
- **Session Fixation/Replay**: strukturell durch das Session-Modell
  ausgeschlossen (Session-ID wird serverseitig bei Login neu erzeugt,
  keine Möglichkeit, eine ID von außen vorzugeben).

## Regressionsschutz

Alle in diesem Durchgang behobenen Findings haben einen zugehörigen,
laufenden Test (s. Tabelle oben und `PRODUCTION_READINESS_ANALYSIS.md`
für die Zuordnung Finding → Test). Der `production-readiness-check.ts`
läuft zusätzlich in CI und verhindert insbesondere die Regression von
`workers_dev=true`, fehlendem CSP, oder Actions ohne SHA-Pinning.
