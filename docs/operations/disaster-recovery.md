# Disaster Recovery — Turnen (SQUORA)

## RPO/RTO

**Nicht formal freigegeben** - folgende Werte sind technische
Näherungswerte basierend auf der eingesetzten Cloudflare-Funktionalität,
keine vertraglich zugesicherten Ziele:

- **RPO (Recovery Point Objective)**: praktisch nahe 0 für die letzten
  30 Tage (Paid-Plan-Zeitraum von D1 Time Travel, sekundengenaue
  Bookmarks) - jeder Zeitpunkt innerhalb dieses Fensters ist
  wiederherstellbar. Kein RPO-Ziel für Vorfälle, die älter als 30 Tage
  zurückliegen, ohne einen zusätzlichen externen Backup-Mechanismus
  (aktuell nicht eingerichtet).
- **RTO (Recovery Time Objective)**: kein formal getesteter Wert
  (s. Restore-Drill unten - **nicht durchgeführt**). D1-Restore selbst ist
  laut Cloudflare-Dokumentation ein Minuten-Vorgang für die Datengröße
  dieses Projekts (aktuell < 1 MB), der Gesamt-Ausfall hängt zusätzlich
  von der Reaktionszeit der verantwortlichen Person ab (aktuell eine
  Einzelperson, kein 24/7-Bereitschaftsdienst).

## Verantwortlichkeiten

Aktuell eine Person (`develop.illuminati@gmail.com`, Platform-Admin,
Cloudflare-Konto-Inhaber*in). Kein formaler Vertretungsplan - als
organisatorische Lücke dokumentiert.

## D1 Time Travel — Restore-Befehl

```sh
cd turnen/worker

# Verfügbare Bookmarks/Zeitpunkte prüfen
npx wrangler d1 time-travel info turnen-eu --remote

# Restore auf einen bestimmten Zeitpunkt (ISO-8601) oder Bookmark
npx wrangler d1 time-travel restore turnen-eu --remote --timestamp="<ISO-8601>"
# oder:
npx wrangler d1 time-travel restore turnen-eu --remote --bookmark="<bookmark>"
```

**Vor** einem Production-Restore: Umfang und Ursache des Datenverlusts
klären, Zielzeitpunkt bewusst wählen (ein Restore überschreibt den
aktuellen Stand - Daten zwischen Restore-Zeitpunkt und jetzt gehen
verloren, falls nicht anderweitig gesichert). **Niemals ungefragt
ausführen** - s. kritische Sicherheitsregeln in
`PRODUCTION_READINESS_ANALYSIS.md`.

## Nach einem Restore

1. **Schema prüfen**: `npx wrangler d1 migrations list turnen-eu --remote`
   - ein Restore auf einen Zeitpunkt vor einer inzwischen angewendeten
   Migration bedeutet, dass das Schema wieder älter ist als der
   deployte Worker-Code erwartet. In diesem Fall: fehlende Migrationen
   erneut anwenden (`npx wrangler d1 migrations apply turnen-eu --remote`),
   **bevor** der Worker wieder Traffic bekommt.
2. **Secret-Recovery**: `JWT_SECRET`/`ENCRYPTION_KEY` sind Worker-Secrets,
   **nicht** Teil der D1-Datenbank - ein D1-Restore betrifft sie nicht.
   Falls sie separat verloren gehen (z.B. Cloudflare-Konto-Problem):
   `ENCRYPTION_KEY`-Verlust macht alle verschlüsselten Felder
   (Notfallkontakte, Familien-Kontaktdaten, TOTP-Secrets) dauerhaft
   unlesbar - es gibt **keinen** Zweit-Schlüssel/Recovery-Mechanismus.
   `JWT_SECRET`-Verlust invalidiert alle aktiven Sitzungen (unkritisch,
   nur erneuter Login nötig).
3. **Restore Validation**: Smoke-Test (s. `deployment.md`), stichprobenartig
   prüfen, dass ein bekanntes Kind/eine bekannte Familie mit korrekt
   entschlüsselten Kontaktdaten angezeigt wird.
4. **Incident Communication**: betroffenen Verein informieren, falls der
   Restore zu sichtbarem Datenverlust führte (z.B. Anwesenheiten der
   letzten Stunden vor dem Vorfall).

## Restore-Drill

**Nicht durchgeführt** in diesem Durchgang (kritische Sicherheitsregel:
"Niemals ungefragt Production wiederherstellen", und ein Drill gegen eine
separate DEV/STAGING-D1 setzt eine solche Umgebung voraus, die aktuell
nicht existiert - dieses Projekt hat nur `turnen-eu` als einzige
D1-Instanz).

Empfohlener Ablauf für einen künftigen Drill (sobald eine Staging-D1
existiert oder eine temporäre D1-Kopie für den Test angelegt wird):

```
1. Synthetische, production-ähnliche D1 aufsetzen
2. Bookmark/Zeitpunkt notieren
3. Testdaten absichtlich verändern (z.B. einen Namen ändern)
4. Time-Travel-Restore auf den notierten Zeitpunkt
5. Schema prüfen (migrations list)
6. Synthetische Daten validieren (Änderung von Schritt 3 rückgängig?)
7. Application Smoke-Test gegen die restaurierte DB
8. Ergebnis dokumentieren (Dauer, Probleme, Lessons Learned)
```

**Ohne durchgeführten Restore-Drill bleibt dieses Production-Gate offen**
(s. `PRODUCTION_GO_LIVE_REPORT.md`).
