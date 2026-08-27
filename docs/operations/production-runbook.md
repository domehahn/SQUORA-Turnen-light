# Production Runbook — Turnen (SQUORA)

Kurzreferenz für wiederkehrende Betriebsaufgaben. Details in den
verlinkten Dokumenten.

## Neuen Nutzer/Trainer-Account anlegen

Bevorzugt über die Admin-Nutzerverwaltung im UI (`POST /api/admin/users`,
nur `is_admin`) - setzt automatisch `must_change_password=1`, die Person
muss das initiale Passwort beim ersten Login ersetzen.

Alternativ für den allerersten Bootstrap-Account (bevor ein UI-Zugang
existiert):

```sh
cd turnen/worker
node scripts/create-admin.mjs admin@example.com "Vorname Nachname"
# Passwort wird interaktiv abgefragt, NICHT als Argument
# Skript gibt ein wrangler-d1-execute-Kommando aus - erst lokal, dann
# nach Prüfung --remote ausführen
```

## Passwort eines Accounts zurücksetzen (Admin)

`PUT /api/admin/users/:id/password` (im UI oder direkt) - widerruft
automatisch alle Sitzungen der Zielperson und erzwingt einen erneuten
Passwortwechsel beim nächsten Login.

## MFA für einen Account zurücksetzen (z.B. Gerät verloren)

Kein dedizierter Admin-Endpunkt für "MFA einer fremden Person
deaktivieren" (bewusst - würde der betroffenen Person die Kontrolle über
ihren eigenen zweiten Faktor entziehen). Die Person selbst deaktiviert
MFA über ihr Profil (`POST /api/me/mfa/disable`, verlangt das aktuelle
Passwort) und richtet danach neu ein. Bei komplettem Verlust von Passwort
UND MFA-Gerät: Admin setzt zunächst das Passwort zurück (s.o., löscht
laufende Sitzungen), die Person meldet sich mit dem neuen Passwort an -
MFA bleibt davon unberührt (Passwort-Reset rührt `totp_enabled` nicht an)
und muss weiterhin über den bekannten zweiten Faktor oder einen
Backup-Code eingelöst werden. Ist wirklich kein zweiter Faktor mehr
verfügbar, bleibt aktuell nur ein direkter D1-Eingriff
(`UPDATE users SET totp_enabled=0, totp_secret=NULL,
totp_backup_codes=NULL WHERE id=...`) - **manuell, mit Vorsicht, nach
Identitätsprüfung der Person außerhalb der App**.

## D1 direkt abfragen (Lesezugriff, Debugging)

```sh
cd turnen/worker
npx wrangler d1 execute turnen-eu --remote --command "SELECT ..."
```

**Niemals** `UPDATE`/`DELETE` gegen `--remote` ohne vorherige Analyse und
- bei Datenänderungen mit Personenbezug - ausdrückliche Bestätigung
der verantwortlichen Person.

## Migration anwenden

Siehe `deployment.md`, Abschnitt 2.

## Deploy

Siehe `deployment.md`.

## Rollback

Siehe `rollback.md`.

## Datenpanne / Sicherheitsvorfall

Siehe `../security/incident-response.md`.

## Wiederherstellung nach Datenverlust

Siehe `disaster-recovery.md`.

## Häufige Prüfbefehle

```sh
# Vollständige lokale Prüfung vor jedem Deploy
cd turnen/worker && npm run typecheck && npm run lint && npm test
cd turnen && npm run lint && npm run web:typecheck && npm run build
cd cloudflare-turnen-iac && tofu fmt -check -recursive && tofu validate
npx tsx scripts/production-readiness-check.ts

# Aktuelle Cloudflare-Konfiguration prüfen (D1-Jurisdiktion etc.)
cd turnen/worker && npx tsx ../../scripts/privacy-check.ts

# Deploy-Trockenlauf (kein echter Deploy)
npx wrangler deploy --dry-run
```
