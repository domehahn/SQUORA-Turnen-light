# Technische und organisatorische Maßnahmen (TOMs) — Turnen (SQUORA)

Orientiert an Art. 32 DSGVO (Sicherheit der Verarbeitung) und Art. 25
(Privacy by Design/by Default). Technischer Ist-Zustand nach diesem
Durchgang - **kein** Ersatz für eine rechtlich geprüfte, vollständige
TOM-Dokumentation (die zusätzlich physische/organisatorische Maßnahmen
außerhalb des Codes umfasst, z.B. Zugriffskonzept fürs Cloudflare-Konto
selbst, Mitarbeiter*innen-Schulung).

## Vertraulichkeit

- Zugangskontrolle: Passwort (PBKDF2, 15+ Zeichen bei Neuvergabe) +
  optionale/verpflichtende (Platform-Admin) MFA (TOTP).
- Zugriffskontrolle: rollenbasiert (`member`/`jugendleiter`/`is_admin`),
  Mandantentrennung (`club_id`), fail-closed bei unbekannter Beziehung.
- Verschlüsselung: Notfallkontakte und Familien-Kontaktdaten AES-256-GCM
  (Application-Level, `worker/src/crypto.ts`), Passwörter PBKDF2-Hash
  (nie im Klartext gespeichert oder geloggt), TOTP-Secrets AES-256-GCM,
  MFA-Backup-Codes PBKDF2-Hash.
- Transportverschlüsselung: TLS (Cloudflare-terminiert, HSTS-Header
  gesetzt, `Strict-Transport-Security: max-age=31536000; includeSubDomains`).
- Trennung der Verarbeitungszwecke: getrennte Tabellen für Betriebsdaten
  (`audit_log`, `sessions`) vs. fachliche Daten (`children`, `families`).

## Integrität

- Parametrisierte SQL-Queries durchgängig (kein String-Concatenation-
  Risiko).
- CSRF-Schutz (Origin-/Sec-Fetch-Site-Prüfung + `SameSite=Strict`).
- Content-Security-Policy ohne `unsafe-eval`.
- Foreign-Key-Constraints für strukturelle Integrität (z.B.
  `children.group_id` kann nie auf eine gelöschte Gruppe zeigen).

## Verfügbarkeit und Belastbarkeit

- Cloudflare D1 Time Travel (automatisches Point-in-Time-Recovery,
  30 Tage bei Paid Plan) - s. `docs/operations/disaster-recovery.md`.
- `prevent_destroy = true` auf der D1-Ressource in Terraform/OpenTofu -
  verhindert ein versehentliches Löschen der Produktionsdatenbank über
  `terraform destroy`.
- Rate Limiting gegen Ressourcen-Erschöpfung durch Login-/Reset-Flooding.

## Verfahren zur regelmäßigen Überprüfung (Art. 32(1)(d))

- Automatisierte Test-Suite (86 Tests, läuft bei jedem Push/PR in CI).
- `scripts/production-readiness-check.ts` (17 statische Checks, CI).
- CodeQL SAST, `npm audit` SCA, Gitleaks Secret-Scan, Trivy IaC-Scan
  (neu in diesem Durchgang, laufen bei jedem Push/PR).
- **Nicht etabliert**: regelmäßiger externer Penetrationstest,
  strukturiertes Betriebsmonitoring/Alerting (s.
  `docs/security/production-security-checklist.md`).

## Privacy by Design / by Default (Art. 25)

- Keine Gesundheitsdaten im Schema (bewusste Entscheidung, technisch
  durchgesetzt/verifiziert).
- Least-Privilege-Redaktion: Notfallkontakte werden standardmäßig nicht
  an jede Person mit Vereinszugriff ausgeliefert.
- Speicherbegrenzung technisch vorbereitet (Retention-Cron), Fristen
  bewusst konfigurierbar statt hartkodiert, nicht ohne fachliche
  Freigabe aktiviert erfunden.
- Kein PWA-Caching für `/api/*`-Antworten (personenbezogene Daten landen
  nicht im Service-Worker-Cache eines gemeinsam genutzten Geräts).
- Datenminimierung bei der Sitzungs-Selbstauskunft (`GET /api/me/sessions`
  liefert User-Agent/IP nur der eigenen Person, nicht anderen).

## Bekannte Lücken (technisch, s. auch `PRODUCTION_GO_LIVE_REPORT.md`)

- Kein etabliertes Löschkonzept für `families` (kein Hard-Delete-Endpunkt).
- Kein Retention-Mechanismus für `audit_log`.
- Geteilte Origin (`squora.de/turnen-light`) statt eigener Subdomain.
