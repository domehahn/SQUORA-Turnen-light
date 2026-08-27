# Production Readiness Analysis — Turnen (SQUORA)

Commit SHA zu Beginn dieses Durchgangs: `6cca828578b7fe0bc2396cfbef19f0c8744ba3cb`
Commit SHA nach Abschluss: `e7d25358f7415e294f29d28a4575f8abb6277afa` (siehe `git log` für den vollständigen Verlauf; dieses Dokument beschreibt beide Zustände: Ausgangslage und Ergebnis).

Dies ist die technische Bestandsaufnahme + Umsetzungsdokumentation eines
groß angelegten Production-Readiness-Härtungsdurchgangs. Ergänzt (nicht
ersetzt) `PRIVACY_SECURITY_GAP_ANALYSIS.md`, das die vorherigen sechs
Prüfungsdurchgänge dokumentiert. Das Endergebnis steht in
`PRODUCTION_GO_LIVE_REPORT.md`.

**Wichtig:** "Technically Production Ready" ≠ "DSGVO-konform" ≠ "100%
sicher". Diese Analyse trennt technische Befunde (hier behoben oder als
offen dokumentiert) von rechtlichen/organisatorischen Gates, die separat
freigegeben werden müssen (Anwaltsprüfung, AVV, Datenschutzerklärung,
Penetrationstest, Cloudflare-Live-Einstellungen, Branch Protection).

## Ausgangszustand (Phase 0)

Vor diesem Durchgang, direkt geprüft:

```
cd turnen/worker && npm ci && npm run typecheck && npm run lint && npm test
→ 64/64 Tests grün, typecheck/lint clean

cd turnen && npm ci && npm run lint && npm run build && npm run web:typecheck
→ clean

cd cloudflare-turnen-iac && tofu fmt -check -recursive && tofu init -backend=false && tofu validate
→ clean

wrangler deploy --dry-run (beide Worker) → clean
```

Ausgangslage war bereits weit fortgeschritten (sechs vorherige externe
Prüfungsdurchgänge, siehe `PRIVACY_SECURITY_GAP_ANALYSIS.md`): Session-
Management mit HttpOnly-Cookies, serverseitigem Idle-/Absolute-Timeout,
Cross-Tenant-Fixes für `children`/`families`, MFA (Opt-in + Pflicht für
Platform-Admin), CSRF-Schutz, PBKDF2-Härtung, Retention-Mechanismus,
`workers_dev` deaktiviert, CI-Pipeline (ohne Security-Jobs).

## Architektur (unverändert in diesem Durchgang)

```
STRATO (DNS-Registrar) → Cloudflare Zone squora.de (gemeinsam genutzt)
        │
        ├── Route squora.de/turnen-light* → turnen-web (Worker, SPA + Assets)
        │         └── Service Binding → turnen-api
        │
        └── turnen-api (Worker, kein öffentliches Routing)
              ├── D1 "turnen-eu" (jurisdiction=eu)
              ├── Resend API (HTTPS; API-Key als Worker-Secret)
              └── täglicher Cron (Reminders, Retention, Security-Log-Cleanup)
```

Multi-Tenant-Modell: ein Verein (`clubs`) ist die Mandantengrenze. Rollen:
`member` (Turnleitung, eigene Gruppe(n)), `jugendleiter` (Jugendleitung,
vereinsweit), `is_admin` (Platform-Admin, vereinsübergreifend, MFA
verpflichtend).

## Datenklassifikation

| Kategorie | Felder | Schutzstufe | Verschlüsselung |
|---|---|---|---|
| Kind (Basis) | Vor-/Nachname, Geburtsdatum, Gruppe | Personenbezogen (Minderjährige) | Nein (Klartext, aber tenant-isoliert) |
| Notfallkontakt | Name, Telefon | Personenbezogen, kontaktbezogen | **Ja**, AES-256-GCM (`crypto.ts`) |
| Familie/Geschwister | Name, Kontaktname/-telefon/-email | Personenbezogen, kontaktbezogen | **Ja** (neu in diesem Durchgang) |
| Anwesenheit | Kind-ID, Datum, anwesend/-Status | Personenbezogen, Verhaltensdaten | Nein |
| Nutzer/Trainer | E-Mail, Name, Passwort-Hash, TOTP-Secret | Personenbezogen + Zugangsdaten | Passwort: PBKDF2; TOTP-Secret: AES-256-GCM |
| Audit-/Security-Log | Actor, Aktion, Ziel-Label | Betriebsdaten | Nein, bewusst ohne PII in Payload |
| **Explizit NICHT vorhanden** | Gesundheitsdaten, Diagnosen, Medikation | Art. 9 DSGVO | entfällt |

Verifiziert (Grep über `worker/src` + `worker/migrations`, s.
`scripts/production-readiness-check.ts`): keine `health_notes`-,
`children.notes`- oder vergleichbaren Freitextfelder im aktiven Schema.

## Trust Boundaries

1. **Browser ↔ turnen-web**: HTTPS, HttpOnly/Secure/SameSite=Strict-Cookie,
   CSP ohne `unsafe-eval`, HSTS.
2. **turnen-web ↔ turnen-api**: Cloudflare Service Binding (kein Netzwerk-
   Hop, kein öffentliches Routing für turnen-api).
3. **turnen-api ↔ D1**: Cloudflare-intern, `turnen-eu`, jurisdiction=eu.
4. **Verein ↔ Verein**: `club_id` als harte Tenant-Grenze auf allen
   mandantenbezogenen Tabellen (s. `docs/security/tenant-model.md`).
5. **Rolle ↔ Rolle** innerhalb eines Vereins: `member` (eigene Gruppe(n)) <
   `jugendleiter` (vereinsweit) < `is_admin` (vereinsübergreifend, MFA-
   Pflicht).

## Befunde dieses Durchgangs

Severity: P0 = unmittelbares Daten-/Tenant-Sicherheitsproblem, P1 = Go-Live
Blocker, P2 = wichtiges Hardening, P3 = Verbesserung.

### P0-01 — Session-Idle-Timeout durch Hintergrund-Polling wirkungslos
**Status: RESOLVED** (bereits im vorherigen Durchgang behoben, hier durch
zusätzlichen Client-Idle-Lock ergänzt)
- Exploit-Szenario (vorher): Person lässt Browser mit offenem Tab
  unbeaufsichtigt. `NotificationBell.tsx` pollt alle 60s `GET
  /api/notifications`. Ohne Ausnahme aktualisiert jeder authentifizierte
  Request `last_activity_at` - der 5-Minuten-Timeout griff nie.
- Remediation: `requireAuth` nimmt `GET /api/notifications` explizit von
  der Aktivitäts-Aktualisierung aus (`isIdleExempt()`,
  `worker/src/index.ts`). **Neu in diesem Durchgang:** zusätzliches
  Client-seitiges Idle-Lock (`IdleLockOverlay.tsx`) - 4:00 Warnung, 5:00
  UI-Sperre + Logout, zählt nur `pointerdown`/`keydown`/`touchstart`, nicht
  Timer/Polling/Fetch. Der Server bleibt die alleinige Security Authority;
  das Overlay ist reines UX-/Privacy-Hardening (verhindert, dass
  personenbezogene Daten auf einem unbeaufsichtigten Bildschirm sichtbar
  bleiben, auch bevor der Server-Timeout greift).
- Test Strategy: `test/session-management.test.ts` (Polling verlängert
  nicht, echte Aktivität verlängert, >5min → 401, absolute 8h unverändert
  durch Aktivität).

### P0-02 — `families`-Tenant-Grenze dynamisch statt persistent
**Status: RESOLVED** (vorheriger Durchgang, Migration 0039)
- War: `families.club_id` existierte nicht, Mandantengrenze wurde über
  `created_by → user.club_id` zur Anfragezeit berechnet - ein
  Vereinswechsel der anlegenden Person hätte die Familie inkl.
  querverfügbarer Notfallkontakte verknüpfter Kinder mitwandern lassen.
- Remediation: `families.club_id` fest bei Anlage gesetzt, Cross-Tenant-
  Verknüpfung von Kind↔Familie serverseitig abgelehnt (403).
- Test Strategy: `test/tenant-isolation.test.ts`, Describe-Block
  "Cross-Tenant-Isolation bei Familien (P0)", 4 Tests inkl. "Creator
  wechselt Verein → Familie bleibt beim ursprünglichen Verein".

### P1-01 — MFA-Setup/-Rotation konnte aktive MFA ohne Bestätigung deaktivieren
**Status: RESOLVED** (dieser Durchgang — schwerwiegendster Neufund)
- Exploit-Szenario: `POST /api/me/mfa/setup` schrieb ein neues Secret
  direkt in die aktive `totp_secret`-Spalte und setzte `totp_enabled`
  sofort auf `0` - **ohne jede Re-Authentifizierung** (kein Passwort, kein
  aktueller Code). Eine einzelne authentifizierte Anfrage (z.B. über eine
  gekaperte Sitzung) genügte, um die MFA eines Platform-Admin-Accounts
  (gerade erst im vorherigen Durchgang verpflichtend gemacht) faktisch zu
  deaktivieren, ohne dass die betroffene Person das bemerkt hätte.
- Remediation (Migration 0041): `pending_totp_secret` als eigene Spalte.
  `POST /api/me/mfa/setup` verlangt jetzt immer Passwort-Reauth, bei
  bereits aktiver MFA zusätzlich den aktuellen TOTP-/Backup-Code.
  `POST /api/me/mfa/confirm` prüft gegen `pending_totp_secret` und wechselt
  erst bei Erfolg atomar (`totp_secret ← pending`, neue Backup-Codes,
  `pending_totp_secret` geleert). Ein falscher neuer Code lässt den alten
  Faktor unverändert aktiv. Eine erfolgreiche Rotation widerruft andere
  Sitzungen (Security-Recovery-Charakter).
- Test Strategy: `test/mfa.test.ts`, Describe-Block "MFA-Setup/Rotation
  gehärtet (Sicherheitsinvariante)", 7 Tests (Setup ohne/mit falschem
  Passwort abgelehnt, Invariante hält bei Angriffsversuch, Rotation ohne
  Code abgelehnt, falscher aktueller Code abgelehnt + alte MFA bleibt
  aktiv, falscher Bestätigungscode + alte MFA bleibt aktiv, erfolgreiche
  Rotation inkl. Session-Revocation + alte Backup-Codes ungültig).

### P1-02 — Admin-Passwort-Reset widerrief keine Sitzungen der Zielperson
**Status: RESOLVED** (dieser Durchgang)
- Exploit-Szenario: `PUT /api/admin/users/:id/password` änderte das
  Passwort, rief aber **niemals** `revokeAllUserSessions` auf. Ein
  Admin-Reset als Reaktion auf einen vermuteten Kompromittierungsfall
  hätte eine bereits aktive (ggf. gestohlene) Sitzung der Zielperson
  unangetastet gelassen.
- Remediation: `revokeAllUserSessions(db, id)` (ohne Ausnahme - der
  admin-ausführende Akteur ist nicht als Zielperson authentifiziert)
  ergänzt.
- Test Strategy: `test/password-change-required.test.ts`, erweitert um
  Login-vor-Reset + Zugriffsprüfung nach Reset (401).

### P1-03 — Passwort-Reset-Token konnte vor vollständiger Validierung verbraucht werden
**Status: RESOLVED** (dieser Durchgang)
- Szenario: `jti` wurde konsumiert, **bevor** die HIBP-Prüfung lief. Ein
  abgelehntes (z.B. geleaktes) neues Passwort verbrannte damit einen sonst
  gültigen Link - die Person musste einen komplett neuen Reset anfordern.
- Remediation: Reihenfolge korrigiert - Token-Signatur, Ablauf, Nutzer-
  Existenz, Passwort-Syntax, HIBP **zuerst**, `jti`-Konsum unmittelbar vor
  dem eigentlichen Passwort-Update. Der PRIMARY-KEY-basierte atomare Gate
  bleibt unverändert (Race-Condition-sicher).
- Test Strategy: `test/password-reset.test.ts`, "Token-Verbrauchsreihenfolge":
  abgelehntes Passwort verbraucht Token nicht, Token nach Erfolg nicht mehr
  nutzbar, zwei parallele Requests → höchstens einer erfolgreich.

### P1-04 — Kein Rate Limiting für Passwort-Reset-Anfragen
**Status: RESOLVED** (dieser Durchgang)
- Szenario: `POST /api/password-reset/request` war unbegrenzt aufrufbar -
  jemand hätte eine fremde Adresse mit Reset-Mails fluten können.
- Remediation (Migration 0042): kombiniertes Limit E-Mail (5/15min) + IP
  (20/15min), immer generische Antwort (kein Enumeration-Signal über das
  Rate-Limit-Verhalten selbst).
- Test Strategy: `test/password-reset.test.ts`, "Passwort-Reset Rate
  Limiting".

### P1-05 — Passwort-Mindestlänge zu niedrig für ein Opt-in-MFA-Modell
**Status: RESOLVED** (dieser Durchgang)
- Bewertung: da MFA für `member`/`jugendleiter` weiterhin Opt-in ist
  (Produktentscheidung, s. unten), ist die Passwortlänge die wichtigste
  verbleibende Verteidigungslinie für diese Rollen.
- Remediation: Mindestlänge 8 → 15 Zeichen für **neu gesetzte** Passwörter
  (Registrierung/Änderung/Reset/Admin-Reset), keine Komplexitätsregeln
  (NIST SP 800-63B), Passphrases ausdrücklich zulässig. Bestandsaccounts
  mit kürzerem Passwort bleiben einloggbar (keine rückwirkende Aussperrung).
- Test Strategy: `test/password-reset.test.ts`, "Passwort-Policy
  (Mindestlänge)" - 14 Zeichen abgelehnt, 15 akzeptiert, Passphrase
  akzeptiert, Alt-Bestand mit kurzem Passwort kann sich weiterhin einloggen.

### P1-06 — Fail-open statt Fail-closed bei unbekannten Mandantenbeziehungen
**Status: RESOLVED** (dieser Durchgang)
- Befund: `isChildWritable()` hatte zwei `return true`-Ausnahmen
  ("Kind ohne Vereinszuordnung" und "Kind zeigt auf nicht existierende
  Gruppe"), `canWriteGroup()` eine dritte ("Gruppe ohne Besitzer und ohne
  Verein"). Alle drei galten als "für jede authentifizierte Person
  bearbeitbar".
- Verifikation vor der Änderung (gegen die echte Produktionsdatenbank):
  `SELECT COUNT(*) FROM children WHERE club_id IS NULL` = 0,
  `... WHERE group_id IS NULL AND club_id IS NULL` = 0 (n/a, s.u.),
  `SELECT COUNT(*) FROM groups WHERE owner_id IS NULL AND club_id IS
  NULL` = 0, `SELECT COUNT(*) FROM users WHERE club_id IS NULL` = 0. Alle
  drei Ausnahmen waren tote Kompatibilitäts-Öffnungen ohne echten Nutzen,
  mit echtem Risiko.
  Zusätzlich strukturell relevant: `children.group_id REFERENCES
  groups(id) ON DELETE SET NULL` (Migration 0001) macht "dangling
  group_id" ohnehin unmöglich - die entsprechende Fail-open-Ausnahme war
  also sogar doppelt tot.
- Remediation: alle drei Ausnahmen entfernt (Deny statt Allow), Deny-Fälle
  erzeugen zusätzlich einen Security-Event-Log-Eintrag (`action:
  security.unknown_tenant_relation_denied` /
  `security.dangling_group_reference_denied`), ohne personenbezogenen
  Inhalt im Label.
- Test Strategy: `test/tenant-isolation.test.ts`, "Fail-closed bei
  unbekannten/kaputten Mandantenbeziehungen" - 3 Tests (Kind ohne
  Vereinszuordnung, herrenlose Gruppe, Security-Event-Eintrag ohne PII).

### P1-07 — Familien-Kontaktdaten unverschlüsselt gespeichert
**Status: RESOLVED** (dieser Durchgang)
- Befund: `families.contact_name/contact_phone/contact_email` lagen im
  Klartext, obwohl `children.emergency_contact_*` bereits AES-256-GCM-
  verschlüsselt war (Finding PRIV-02).
- Remediation: dieselbe Verschlüsselung (`worker/src/crypto.ts`, keine
  neue Kryptografie) für Familien-Kontaktfelder. Historischer Klartext-
  Bestand bleibt lesbar (`decryptField` erkennt fehlendes `v1:`-Präfix als
  Legacy-Klartext), keine erzwungene Backfill-Migration nötig.
- Test Strategy: `test/encryption.test.ts` (neu) - prüft explizit den
  Rohwert in D1 (nicht nur die API-Antwort), inkl. Alt-Bestand-Test.

### P1-08 — CI ohne Security-Jobs, Actions auf mutable Tags
**Status: RESOLVED** (dieser Durchgang)
- Remediation: neuer `security`-Job (SAST via CodeQL, Secret-Scan via
  Gitleaks-CLI, SCA via `npm audit --audit-level=high` für beide
  Node-Projekte, IaC-Scan via Trivy config scan, SBOM via CycloneDX als
  90-Tage-Artefakt, automatisierter `production-readiness-check.ts`).
  Alle Actions auf volle Commit-SHAs gepinnt (mit `# vX.Y.Z`-Kommentar für
  Lesbarkeit), `permissions: contents: read` als Workflow-Standard,
  `security-events: write` nur job-lokal für den CodeQL-Upload.
- Test Strategy: `scripts/production-readiness-check.ts` prüft die
  eigene CI-Konfiguration automatisiert (Security-Job vorhanden, minimale
  Permissions, SHA-Pinning) - schützt gegen künftige Regression.

## Bewusst NICHT umgesetzt in diesem Durchgang (mit Begründung)

- **Eigene Origin (`turnen.squora.de`)**: echte DNS-/Zonen-Änderung, nicht
  code-seitig lösbar ohne Zugriff auf die geteilte Zone und Abstimmung mit
  anderen Projekten darauf. Vorbereitet in
  `docs/operations/origin-migration.md`, bleibt **offenes P1 / manuelles
  Gate**.
- **Branch Protection aktivieren**: dieser Durchgang **prüft und
  dokumentiert** den Status (s. `docs/operations/github-production-
  settings.md`), ändert ihn aber nicht ohne explizite Freigabe - frühere
  Nutzerentscheidung war ausdrücklich dagegen ("main bleibt offen"), und
  die aktuelle Anweisung selbst verbietet unautorisierte Remote-Settings-
  Änderungen. **Bleibt offenes, notwendiges P1-Gate für Production.**
- **DAST**: keine lokal laufende Umgebung mit den in der Anfrage
  vorausgesetzten Tools (OWASP ZAP o.ä.) in dieser Session verfügbar; ein
  vollständiger DAST-Lauf erfordert einen laufenden `wrangler dev`/
  Preview-Deploy und ein dediziertes Tool-Setup außerhalb des Scopes
  dieses Durchgangs. Als offenes Finding dokumentiert (s.
  `docs/security/security-test-report.md`), **kein Production-Scan
  durchgeführt** (explizit verboten ohne Freigabe).
- **Externer Penetrationstest, Restore-Drill (tatsächlich ausgeführt),
  Remote-State-Backend für Terraform**: organisatorische/infrastrukturelle
  Vorhaben, die über Repository-Code hinausgehen - als **MANUAL GATES**
  in `PRODUCTION_GO_LIVE_REPORT.md` dokumentiert, nicht ausgeführt.
- **Produktions-Migrationen 0041/0042 nicht angewendet**: lokal migriert
  und getestet (alle Tests grün), aber gemäß den kritischen Sicherheits-
  regeln dieses Durchgangs ("KEINE Production-Migration ohne vorherige
  Analyse ausführen", "NICHT automatisch remote ausführen") **nicht** auf
  `turnen-eu` angewendet. Exakte Befehle:
  ```bash
  cd turnen/worker
  npx wrangler d1 migrations list turnen-eu --remote   # zeigt 0041, 0042 als ausstehend
  npx wrangler d1 migrations apply turnen-eu --remote  # nach Review ausführen
  ```
  Risikoanalyse: beide Migrationen sind additive `ALTER TABLE ... ADD
  COLUMN`/`CREATE TABLE` ohne Datenverlust-Potenzial, kein Backfill nötig
  (neue Spalten/Tabellen starten leer/NULL). Rollback: `ALTER TABLE users
  DROP COLUMN pending_totp_secret` bzw. `DROP TABLE
  password_reset_requests` (SQLite/D1 unterstützt `DROP COLUMN` seit
  neueren Versionen; im Zweifel Spalte einfach ungenutzt lassen statt
  droppen).
- **Kein Deploy von turnen-web/turnen-api mit den neuen Code-Änderungen**:
  ebenfalls gemäß der Anweisung "KEIN Production Deploy" nicht ausgeführt.
  `wrangler deploy --dry-run` für beide Worker ist clean (s.o.).

## Cross-Referenz zu bereits vorher behobenen Findings

Siehe `PRIVACY_SECURITY_GAP_ANALYSIS.md` für die vollständige Historie
(sechs Durchgänge): P0 Cross-Tenant-Isolation bei `children`, Attendance-
BOLA, Session-Management-Umbau (HttpOnly-Cookies, Idle-/Absolute-Timeout),
PBKDF2-Härtung (mit dem workerd-Laufzeitlimit-Fix), CSRF-Schutz,
`workers_dev`-Deaktivierung, Least-Privilege bei Notfallkontakten in der
Kinderliste, Retention-Aktivierung, MFA-Einführung und -Pflicht für
Platform-Admin, erzwungener Passwortwechsel bei admin-vergebenen initialen
Passwörtern.
