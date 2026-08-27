# Production Go-Live Report — Turnen (SQUORA)

Stand: 2026-08-27, Commit `e7d25358f7415e294f29d28a4575f8abb6277afa` +
Dokumentations-Commits danach (siehe `git log`). Ergänzt
`PRODUCTION_READINESS_ANALYSIS.md` (Findings im Detail) und
`PRIVACY_SECURITY_GAP_ANALYSIS.md` (Historie der ersten sieben
Prüfungsdurchgänge).

**Dieses Dokument behauptet nicht "DSGVO-konform" oder "100% sicher".**
Es unterscheidet explizit zwischen technisch verifizierten Controls und
Punkten, die manuelle/rechtliche Prüfung außerhalb des Repository-Codes
erfordern.

## Status-Legende

`PASS` — technisch verifiziert (Test/Skript/Code-Review in dieser
Session). `FAIL` — technisch verifiziert offen. `MANUAL VERIFICATION
REQUIRED` — kann nicht aus dem Repository abgeleitet werden (Cloudflare-
Dashboard, GitHub-Repository-Einstellungen). `LEGAL/PRIVACY REVIEW
REQUIRED` — rechtliche/organisatorische Entscheidung, nicht technisch
lösbar.

## Control-Tabelle

| Control | Status | Evidence | Risk | Manual Action Required |
|---|---|---|---|---|
| Fail-closed Tenant-Isolation (`children`, `families`, `groups`) | PASS | `tenant-isolation.test.ts` (14 Tests), P1-06 in `PRODUCTION_READINESS_ANALYSIS.md` | — | keine |
| Family-Tenant-Grenze persistent statt dynamisch | PASS | Migration 0039, 4 Tests | — | Migration bereits in Produktion (früherer Durchgang) |
| BOLA/IDOR-Schutz (Attendance, Familien-Verknüpfung, Admin-Routen) | PASS | `authorization.test.ts` (18 Tests) | — | keine |
| Server-Idle-Timeout (5min) inkl. Background-Polling-Ausnahme | PASS | `session-management.test.ts` | — | keine |
| Client-Idle-Lock (4:00 Warnung, 5:00 Sperre) | PASS | `IdleLockOverlay.tsx`, manuell im Code-Review geprüft (kein automatisierter Browser-Test in dieser Session) | Niedrig — UX-Ebene, Server bleibt Authority | keine |
| Absolute Session-Timeout (8h) | PASS | `session-management.test.ts` | — | keine |
| Session Revocation (Logout, Passwortänderung, MFA, Admin-Reset) | PASS | mehrere Testdateien, inkl. neuem Admin-Reset-Test (P1-02) | — | keine |
| MFA Setup/Rotation-Invariante | PASS | `mfa.test.ts`, 7 neue Tests, P1-01 | — | keine — Migration 0041 auf `turnen-eu` angewendet, Code deployed (27.08.2026) |
| MFA-Pflicht für Platform-Admin | PASS | `mfa.test.ts` | — | keine |
| Privilegierte MFA für `member`/`jugendleiter` optional | **ACCEPTED RISK** | Produktentscheidung, mehrfach dokumentiert | Mittel für diese Rollen — kompensiert durch 15-Zeichen-Passwort-Policy | keine (bewusste Produktentscheidung) |
| Admin-Passwort-Reset widerruft Sitzungen | PASS | `password-change-required.test.ts`, P1-02 | — | keine |
| Passwort-Reset-Token-Verbrauchsreihenfolge | PASS | `password-reset.test.ts`, P1-03 | — | keine |
| Passwort-Reset Rate Limiting | PASS | `password-reset.test.ts`, Migration 0042, P1-04 | — | keine — Migration auf `turnen-eu` angewendet (27.08.2026) |
| Passwort-Mindestlänge 15 Zeichen (neu gesetzte) | PASS | `password-reset.test.ts`, P1-05 | — | keine |
| CSRF-Schutz (Origin/Sec-Fetch-Site) | PASS | `csrf.test.ts` | — | keine |
| Family-Field-Encryption (AES-256-GCM) | PASS | `encryption.test.ts`, P1-07 | — | keine |
| `workers_dev=false`, `preview_urls=false` (beide Worker) | PASS | `production-readiness-check.ts` | — | keine |
| D1 EU-Jurisdiktion (`turnen-eu`) | PASS | `production-readiness-check.ts`, IaC `storage.tf` | — | keine |
| `prevent_destroy` auf D1-Ressource | PASS | `production-readiness-check.ts`, `storage.tf` | — | keine |
| CSP ohne `unsafe-eval`, HSTS | PASS | `production-readiness-check.ts` | — | keine |
| Retention technisch erzwingbar (Kinder + Security-Logs) | PASS | `production-readiness-check.ts`, Cron-Job | — | Frist fachlich final freigeben (s. LEGAL-Zeile unten) |
| Keine Gesundheitsdaten im Schema | PASS | `production-readiness-check.ts`, Migrationen 0033/0034 | — | keine |
| Kein PWA-Caching für `/api/*` | PASS | `production-readiness-check.ts`, `vite.config.ts` | — | keine |
| Keine Secrets im Quellcode/Build | PASS | `production-readiness-check.ts`, Gitleaks (lokal verifiziert, 0 Findings mit `.gitleaks.toml`) | — | keine |
| CI: Backend/Frontend/IaC-Jobs grün | PASS | `.github/workflows/ci.yml`, lokal reproduziert (86/86 Tests, typecheck/lint/build clean) | — | keine |
| CI: Security-Job (SAST/SCA/Secret-Scan/IaC-Scan/SBOM) | PASS | `ci.yml`, lokal reproduziert (npm audit 0 Vulnerabilities beide Projekte, Trivy 0 Misconfigurations, Gitleaks 0 Findings) | — | CodeQL selbst nicht lokal reproduzierbar, läuft nur in CI |
| CI: Actions SHA-gepinnt, minimale Permissions | PASS | `production-readiness-check.ts` | — | keine |
| GitHub Branch Protection (`main`) | PASS | Aktiviert 27.08.2026 (`enforce_admins: true`, 4 required Status-Checks, kein Force-Push/Delete), s. `docs/operations/github-production-settings.md` | — | keine |
| Eigene Origin (`turnen.squora.de`) | **FAIL** (offen) | `docs/operations/origin-migration.md` (Plan, nicht umgesetzt) | Niedrig-Mittel — geteilte Zone mit anderen Projekten | DNS/Route-Änderung, externe Freigabe für die geteilte Zone |
| Backup (D1 Time Travel) | PASS (Mechanismus) | Cloudflare-Feature, automatisch aktiv | — | keine |
| Restore tatsächlich getestet | PASS | Drill 27.08.2026 gegen temporäre Test-DB erfolgreich, s. `docs/operations/disaster-recovery.md` (`turnen-eu` selbst nicht angefasst) | — | keine |
| Terraform Remote State | **FAIL** (offen) | State liegt lokal, kein verschlüsselter Remote-Backend konfiguriert | Niedrig (Einzelperson-Betrieb) bis Mittel (bei mehreren Mitwirkenden) | Remote-State-Backend einrichten, bevor mehr als eine Person deployt |
| Betriebsmonitoring/Alerting | PASS (Basis) | 2 Cloudflare-Alerting-Policies eingerichtet 27.08.2026 (Worker-Errors-Kanal, Kostenanomalie), s. `docs/security/production-security-checklist.md` | Niedrig-Mittel — zugrundeliegende Observability-Alert-Regel für "Worker-Errors" braucht noch einmalige Dashboard-Konfiguration; kein Alerting für App-Level-Signale (Login-Failures, Reset-Anfragen) | **MANUAL VERIFICATION REQUIRED**: Observability-Alert-Regel im Dashboard anlegen |
| DAST | **FAIL** (nicht durchgeführt) | `docs/security/security-test-report.md` | Unbekannt (nicht gemessen) | Vor uneingeschränktem Go-Live gegen Staging/Preview durchführen |
| Externer Penetrationstest | **FAIL** (nicht durchgeführt) | — | Unbekannt (nicht gemessen) | Organisatorisch beauftragen |
| Retention-Frist fachlich/rechtlich freigegeben | LEGAL/PRIVACY REVIEW REQUIRED | 1095 Tage (Kinder) / 90 Tage (Security-Logs) sind Nutzerentscheidungen, keine Rechtsprüfung | — | Rechtsberatung einholen |
| Cloudflare DPA/AVV | LEGAL/PRIVACY REVIEW REQUIRED | nicht in dieser Session prüfbar | — | Vertragsprüfung |
| Datenschutzerklärung aktuell | LEGAL/PRIVACY REVIEW REQUIRED | spiegelt sie den aktuellen technischen Stand (Verschlüsselung, D1 EU, MFA-Modell)? | — | Rechtsberatung |
| Verzeichnis Verarbeitungstätigkeiten | LEGAL/PRIVACY REVIEW REQUIRED | nicht in dieser Session erstellt/geprüft | — | Rechtsberatung |
| DSFA-Schwellenprüfung | LEGAL/PRIVACY REVIEW REQUIRED | Verarbeitung von Minderjährigen-Daten kann eine DSFA erfordern | — | Rechtsberatung |
| Migrationen 0041/0042 in Produktion | PASS | Auf `turnen-eu` angewendet 27.08.2026, verifiziert (`pending_totp_secret`-Spalte, `password_reset_requests`-Tabelle vorhanden) | — | keine |
| Code-Änderungen dieses Durchgangs deployed | PASS | Beide Worker deployed 27.08.2026, Smoke-Test grün (200 auf `/`, 401 auf Login-Fehlversuch, `workers.dev` nicht erreichbar), Admin-MFA-Zustand nach Deploy verifiziert unverändert | — | keine |

## P0/P1-Regel — Anwendung

Alle **technischen** P0/P1-Findings aus diesem Durchgang (s.
`PRODUCTION_READINESS_ANALYSIS.md`) sind **RESOLVED**, durch
automatisierte Tests abgesichert (86/86 grün) und **live deployed**
(27.08.2026, verifiziert per Smoke-Test). Die zuvor offenen
Prozess-Gates (Branch Protection, Restore-Drill, Betriebsmonitoring)
wurden ebenfalls auf explizite Nutzerfreigabe ("GO") umgesetzt und
verifiziert.

## Final Status

```
TECHNICALLY PRODUCTION READY
LEGAL/PRIVACY GATES REMAIN SEPARATE
```

**Begründung**: alle technischen P0/P1-Findings dieses Durchgangs sind
behoben, getestet und live deployed. Die zuvor offenen technischen/
prozessualen Gates sind jetzt ebenfalls geschlossen:

1. ✅ **GitHub Branch Protection** aktiv (`main` verlangt PR + grüne
   Checks, kein Force-Push/Delete, gilt auch für Admins).
2. ✅ **Migrationen 0041/0042 + der gesamte Code dieses Durchgangs sind
   deployed** und per Smoke-Test verifiziert.
3. ✅ **Restore-Drill durchgeführt** und erfolgreich (gegen eine temporäre,
   von Produktion getrennte Test-Datenbank).
4. ✅ **Cloudflare-Alerting eingerichtet** (Basis-Abdeckung: Worker-Error-
   Benachrichtigungskanal, Kostenanomalie-Indikator) - mit einer
   verbleibenden manuellen Nacharbeit (die zugrundeliegende Observability-
   Alert-Regel selbst braucht eine einmalige Dashboard-Konfiguration, kein
   API-Weg dafür gefunden) und ohne natives Alerting für App-Level-Signale
   (Login-Failures/Reset-Anfragen - dafür bräuchte es einen eigenen
   Cron-Auswertungsmechanismus, nicht umgesetzt).

Verbleibend **offen, aber nicht Production-blockierend** für den
aktuellen Betrieb (kleiner Verein, Einzelperson-Administration):

- **Eigene Origin** (`turnen.squora.de`) - Defense-in-Depth, kein aktiver
  Exploit-Pfad bekannt.
- **Terraform Remote State** - relevant erst bei mehr als einer
  administrierenden Person.
- **DAST / externer Penetrationstest** - empfohlen vor einem größeren
  Nutzerkreis/Vereinen-Rollout, nicht für den aktuellen Einzelverein-Betrieb
  zwingend.

Die **rechtlichen/organisatorischen Gates** (DPA, Datenschutzerklärung,
VVT, DSFA, Retention-Freigabe) bleiben unabhängig davon **separat**
freizugeben - "Technically Production Ready" bedeutet zu keinem Zeitpunkt
"DSGVO-konform" oder "100% sicher".

## Nächste Schritte (verbleibend)

1. Observability-Alert-Regel für `turnen-api` im Cloudflare-Dashboard
   anlegen (Workers & Pages → Observability → Alerts), verknüpft mit der
   bereits eingerichteten Notification-Policy.
2. Rechtliche Prüfung anstoßen (DPA, Datenschutzerklärung, VVT, DSFA,
   Retention-Fristen final) - unabhängig vom technischen Stand.
3. Bei wachsendem Nutzerkreis/vor einem größeren Rollout: DAST gegen eine
   Staging-Umgebung, externer Penetrationstest, eigene Origin
   (`docs/operations/origin-migration.md`), Terraform Remote State.
