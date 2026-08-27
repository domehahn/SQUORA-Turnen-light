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
| MFA Setup/Rotation-Invariante | PASS | `mfa.test.ts`, 7 neue Tests, P1-01 | — | Migration 0041 noch nicht in Produktion, s. unten |
| MFA-Pflicht für Platform-Admin | PASS | `mfa.test.ts` | — | keine |
| Privilegierte MFA für `member`/`jugendleiter` optional | **ACCEPTED RISK** | Produktentscheidung, mehrfach dokumentiert | Mittel für diese Rollen — kompensiert durch 15-Zeichen-Passwort-Policy | keine (bewusste Produktentscheidung) |
| Admin-Passwort-Reset widerruft Sitzungen | PASS | `password-change-required.test.ts`, P1-02 | — | keine |
| Passwort-Reset-Token-Verbrauchsreihenfolge | PASS | `password-reset.test.ts`, P1-03 | — | keine |
| Passwort-Reset Rate Limiting | PASS | `password-reset.test.ts`, Migration 0042, P1-04 | — | Migration noch nicht in Produktion |
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
| GitHub Branch Protection (`main`) | **FAIL** | `gh api .../branches/main/protection` → 404 "Branch not protected" (verifiziert 2026-08-27) | Mittel — ungeprüfter Code kann direkt in `main` gelangen | **MANUAL VERIFICATION REQUIRED** + explizite Freigabe, s. `docs/operations/github-production-settings.md` |
| Eigene Origin (`turnen.squora.de`) | **FAIL** (offen) | `docs/operations/origin-migration.md` (Plan, nicht umgesetzt) | Niedrig-Mittel — geteilte Zone mit anderen Projekten | DNS/Route-Änderung, externe Freigabe für die geteilte Zone |
| Backup (D1 Time Travel) | PASS (Mechanismus) | Cloudflare-Feature, automatisch aktiv | — | keine |
| Restore tatsächlich getestet | **FAIL** (offen) | `docs/operations/disaster-recovery.md` — kein Drill durchgeführt | Mittel — RTO unbekannt | **MANUAL VERIFICATION REQUIRED**: Restore-Drill gegen Staging/Testkopie |
| Terraform Remote State | **FAIL** (offen) | State liegt lokal, kein verschlüsselter Remote-Backend konfiguriert | Niedrig (Einzelperson-Betrieb) bis Mittel (bei mehreren Mitwirkenden) | Remote-State-Backend einrichten, bevor mehr als eine Person deployt |
| Betriebsmonitoring/Alerting | **FAIL** (offen) | Kein aktives Alerting eingerichtet, s. `docs/security/production-security-checklist.md` | Mittel — Vorfälle werden ggf. spät bemerkt | Cloudflare Notifications/externes Monitoring einrichten |
| DAST | **FAIL** (nicht durchgeführt) | `docs/security/security-test-report.md` | Unbekannt (nicht gemessen) | Vor Go-Live gegen Staging/Preview durchführen |
| Externer Penetrationstest | **FAIL** (nicht durchgeführt) | — | Unbekannt (nicht gemessen) | Organisatorisch beauftragen |
| Retention-Frist fachlich/rechtlich freigegeben | LEGAL/PRIVACY REVIEW REQUIRED | 1095 Tage (Kinder) / 90 Tage (Security-Logs) sind Nutzerentscheidungen, keine Rechtsprüfung | — | Rechtsberatung einholen |
| Cloudflare DPA/AVV | LEGAL/PRIVACY REVIEW REQUIRED | nicht in dieser Session prüfbar | — | Vertragsprüfung |
| Datenschutzerklärung aktuell | LEGAL/PRIVACY REVIEW REQUIRED | spiegelt sie den aktuellen technischen Stand (Verschlüsselung, D1 EU, MFA-Modell)? | — | Rechtsberatung |
| Verzeichnis Verarbeitungstätigkeiten | LEGAL/PRIVACY REVIEW REQUIRED | nicht in dieser Session erstellt/geprüft | — | Rechtsberatung |
| DSFA-Schwellenprüfung | LEGAL/PRIVACY REVIEW REQUIRED | Verarbeitung von Minderjährigen-Daten kann eine DSFA erfordern | — | Rechtsberatung |
| Migrationen 0041/0042 in Produktion | **NICHT ANGEWENDET** | lokal getestet, exakte Befehle in `PRODUCTION_READINESS_ANALYSIS.md` | Niedrig (additiv, kein Datenverlust-Potenzial) | Nach Review: `npx wrangler d1 migrations apply turnen-eu --remote` |
| Code-Änderungen dieses Durchgangs deployed | **NICHT DEPLOYED** | `wrangler deploy --dry-run` clean für beide Worker | — | Nach Migration: `npm run deploy` (API), dann `npm run build && npm run web:deploy` (Web) |

## P0/P1-Regel — Anwendung

Alle **technischen** P0/P1-Findings aus diesem Durchgang (s.
`PRODUCTION_READINESS_ANALYSIS.md`) sind **RESOLVED** und durch
automatisierte Tests abgesichert (86/86 grün). Es verbleiben jedoch
mehrere **P1-Findings, die keine Code-Änderung sind**, sondern externe
Einstellungen/Prozesse (Branch Protection, Origin-Migration, Restore-
Drill, Betriebsmonitoring) - diese sind laut der P0/P1-Regel dieses
Durchgangs ebenfalls für den finalen Status maßgeblich.

## Final Status

```
PRODUCTION CANDIDATE
MANUAL GATES REMAIN
```

**Begründung**: alle technischen P0/P1-Findings, die durch Code lösbar
waren, sind behoben und getestet. Der Status ist **nicht**
"TECHNICALLY PRODUCTION READY" (uneingeschränkt), weil folgende Punkte
technisch verifiziert offen sind und vor einem uneingeschränkten
Go-Live geschlossen werden sollten:

1. **GitHub Branch Protection** (`main` ungeschützt) - höchste Priorität
   unter den verbleibenden technischen Gates, da sie alle anderen Controls
   unterlaufen kann (jede Person mit Push-Zugriff kann ungeprüften Code
   einspielen).
2. **Migrationen 0041/0042 + der Code dieses Durchgangs sind noch nicht
   in Produktion** - ohne Deploy sind die hier dokumentierten Fixes
   (MFA-Rotation-Invariante, Admin-Reset-Revocation, Passwort-Policy,
   Fail-closed-Authorization, Family-Encryption) **nicht live wirksam**.
3. **Kein getesteter Restore-Drill** - Backup-Mechanismus existiert
   (D1 Time Travel), ist aber nie tatsächlich durchexerziert worden.
4. **Kein Betriebsmonitoring/Alerting** - Vorfälle würden aktuell nur bei
   manueller D1-Abfrage auffallen.

Diese vier Punkte sind **manuelle/organisatorische Gates**, keine
Code-Bugs - daher "PRODUCTION CANDIDATE", nicht "NO-GO". Sobald sie
geschlossen sind (insbesondere 1 und 2), rechtfertigt der technische
Zustand eine Hochstufung auf "TECHNICALLY PRODUCTION READY".

Die **rechtlichen/organisatorischen Gates** (DPA, Datenschutzerklärung,
VVT, DSFA, Retention-Freigabe) bleiben davon unabhängig **separat**
freizugeben - "Technically Production Ready" bedeutet zu keinem Zeitpunkt
"DSGVO-konform" oder "100% sicher".

## Nächste Schritte (Priorität)

1. Diesen Durchgang reviewen, Migrationen 0041/0042 gegen `turnen-eu`
   anwenden (Befehle in `PRODUCTION_READINESS_ANALYSIS.md`).
2. Beide Worker deployen (`docs/operations/deployment.md`).
3. Branch Protection für `main` aktivieren (nach expliziter Freigabe,
   `docs/operations/github-production-settings.md`).
4. Restore-Drill gegen eine Test-Kopie durchführen
   (`docs/operations/disaster-recovery.md`).
5. Cloudflare-Dashboard-Punkte aus
   `docs/security/production-security-checklist.md` manuell abhaken.
6. Rechtliche Prüfung anstoßen (DPA, Datenschutzerklärung, VVT, DSFA,
   Retention-Fristen final).
7. Vor uneingeschränktem Go-Live: DAST gegen eine Staging-Umgebung,
   nach Möglichkeit externer Penetrationstest.
