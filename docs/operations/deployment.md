# Deployment — Turnen (SQUORA)

Ergänzt den "Deployment"-Abschnitt in `README.md` um eine geordnete
Checkliste. Deployment ist bewusst **manuell** (kein CI/CD-Auto-Deploy),
um versehentliche Produktiv-Deploys ohne eigenes Deploy-Secret-Handling
zu vermeiden.

## Reihenfolge (wichtig)

```
1. Lokale Prüfungen (Backend + Frontend + IaC) grün
2. D1-Migrationen (falls vorhanden) gegen Production anwenden
3. API-Worker deployen
4. Frontend bauen + Web-Worker deployen
5. Smoke-Test (s. unten)
```

API-Worker **vor** Web-Worker: der Web-Worker spricht den API-Worker per
Service Binding an - ein veralteter Web-Worker gegen einen neuen API-
Worker ist unkritisch (Frontend degradiert höchstens optisch), ein neuer
Web-Worker gegen einen alten API-Worker kann bei API-Vertragsänderungen
brechen.

## 1. Lokale Prüfungen

```sh
cd turnen/worker && npm ci && npm run typecheck && npm run lint && npm test
cd turnen && npm ci && npm run lint && npm run web:typecheck && npm run build
cd cloudflare-turnen-iac && tofu fmt -check -recursive && tofu init -backend=false && tofu validate
npx tsx scripts/production-readiness-check.ts   # aus dem Repo-Root
```

Alle vier müssen grün sein, bevor deployed wird. CI läuft dieselben
Prüfungen bei jedem Push/PR - ein grüner CI-Lauf auf `main` ist ein guter
Indikator, ersetzt aber nicht die lokale Prüfung unmittelbar vor dem
Deploy (Zeitversatz zwischen letztem CI-Lauf und Deploy-Zeitpunkt).

## 2. D1-Migrationen

```sh
cd turnen/worker
npx wrangler d1 migrations list turnen-eu --remote   # zeigt ausstehende Migrationen
```

**Vor** jeder Production-Migration: lokal migrieren + testen (passiert
automatisch bei `npm test`, das eine frische In-Memory-D1 pro Testlauf
migriert), Migration auf Additivität prüfen (`ALTER TABLE ... ADD COLUMN`
statt `DROP`/`NOT NULL`-Änderungen an bestehenden Spalten - letztere
brauchen eine gesonderte Analyse, s. `migration-safety` unten). Dann:

```sh
npx wrangler d1 migrations apply turnen-eu --remote
```

D1 fragt vor der Ausführung interaktiv nach Bestätigung
("Your database may not be available to serve requests during the
migration, continue?").

## 3. API-Worker

```sh
cd turnen/worker
wrangler secret put JWT_SECRET        # nur bei Ersteinrichtung/Rotation
wrangler secret put ENCRYPTION_KEY    # nur bei Ersteinrichtung/Rotation
wrangler secret put RESEND_API_KEY    # bei Ersteinrichtung/Rotation; aus Resend
wrangler secret put RESEND_WEBHOOK_SECRET # Signing Secret des Resend-Webhooks
npm run deploy
```

## 4. Web-Worker

```sh
cd turnen
npm run build
npm run web:deploy
```

## 5. Smoke-Test

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://squora.de/turnen-light/           # erwartet 200
curl -sD - -o /dev/null -X POST https://squora.de/turnen-light/api/login \
  -H "Content-Type: application/json" -d '{"email":"x","password":"x"}'            # erwartet 401 (nicht 5xx)
curl -s -o /dev/null -w "%{http_code}\n" https://turnen-web.<account>.workers.dev   # erwartet Verbindungsfehler/000 (workers.dev deaktiviert)
```

Danach im Browser einmal manuell einloggen und eine Kernfunktion prüfen
(z.B. Kinderliste laden).

## Migration Safety (Zusammenfassung, s. auch die kritischen Regeln in
`PRODUCTION_READINESS_ANALYSIS.md`)

Vor jeder D1-Migration:
1. Schema-Änderung analysieren (additiv? Datenverlust-Potenzial?)
2. Migration schreiben, gegen lokale/Test-D1 migrieren
3. Test-Suite läuft grün gegen die migrierte Test-D1
4. Backfill-Bedarf prüfen (neue NOT-NULL-Spalte ohne Default?)
5. Mögliche NULL-/Konflikt-Fälle dokumentieren (Beispiel: Migration 0039,
   `families.club_id`-Backfill mit Konflikt-Erkennung über verknüpfte
   Kinder)
6. Rollback/Recovery-Weg beschreiben, **bevor** gegen Production
   ausgeführt wird
7. Niemals automatisiert/unbeaufsichtigt gegen Production ausführen
