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
- **RTO (Recovery Time Objective)**: der eigentliche D1-Restore-Vorgang
  (Time Travel) dauerte im Drill vom 27.08.2026 (s. unten) **unter einer
  Minute** end-to-end (Bookmark ermitteln, Restore, Validierung). Kein
  formales RTO-Ziel für den Gesamtprozess (inkl. Erkennung des Vorfalls,
  Entscheidung, Kommunikation) - der Restore-Schritt selbst ist aber
  nachweislich schnell. Der Gesamt-Ausfall hängt zusätzlich von der
  Reaktionszeit der verantwortlichen Person ab (aktuell eine Einzelperson,
  kein 24/7-Bereitschaftsdienst).

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
2. **Secret-Recovery**: `JWT_SECRET`/`ENCRYPTION_KEY`/`RESEND_API_KEY` sind Worker-Secrets,
   **nicht** Teil der D1-Datenbank - ein D1-Restore betrifft sie nicht.
   Falls sie separat verloren gehen (z.B. Cloudflare-Konto-Problem):
   `ENCRYPTION_KEY`-Verlust macht alle verschlüsselten Felder
   (Notfallkontakte, Familien-Kontaktdaten, TOTP-Secrets) dauerhaft
   unlesbar - es gibt **keinen** Zweit-Schlüssel/Recovery-Mechanismus.
   `JWT_SECRET`-Verlust invalidiert alle aktiven Sitzungen (unkritisch,
   nur erneuter Login nötig). `RESEND_API_KEY` kann in Resend rotiert und
   erneut als Worker-Secret gesetzt werden; bis dahin ist nur der externe
   E-Mail-Versand unterbrochen, das In-App-Postfach bleibt verfügbar.
3. **Restore Validation**: Smoke-Test (s. `deployment.md`), stichprobenartig
   prüfen, dass ein bekanntes Kind/eine bekannte Familie mit korrekt
   entschlüsselten Kontaktdaten angezeigt wird.
4. **Incident Communication**: betroffenen Verein informieren, falls der
   Restore zu sichtbarem Datenverlust führte (z.B. Anwesenheiten der
   letzten Stunden vor dem Vorfall).

## Restore-Drill

**Durchgeführt am 27.08.2026**, auf explizite Nutzerfreigabe ("GO"), gegen
eine eigens dafür angelegte, komplett von Produktion getrennte temporäre
D1-Datenbank (`turnen-restore-drill`, WEUR) - zu keinem Zeitpunkt wurde
`turnen-eu` selbst verändert oder wiederhergestellt.

Tatsächlicher Ablauf (protokolliert):

```
1. wrangler d1 create turnen-restore-drill --location weur
2. Alle 42 Migrationen aus turnen/worker/migrations angewendet
   (npx wrangler d1 migrations apply, über eine temporäre Scratch-
   wrangler.toml, die auf denselben migrations_dir zeigt) → alle ✅
3. Synthetische Testdaten eingefügt (Club/User/Gruppe, KEINE echten
   Personendaten): groups.name = "Original Name Before Drill"
4. Bookmark ermittelt: wrangler d1 time-travel info
   → 00000001-0000005e-000050d4-753221cef44e2d6e3f5390362ad46258
5. Simulierter Vorfall: groups.name testweise auf
   "CORRUPTED BY DRILL - simulated incident" geändert, Korruption per
   SELECT verifiziert
6. wrangler d1 time-travel restore --bookmark=<Bookmark aus Schritt 4>
7. Schema geprüft: wrangler d1 migrations list → "No migrations to
   apply!" (Schema vollständig intakt nach dem Restore)
8. Synthetische Daten validiert: groups.name wieder
   "Original Name Before Drill" - die Korruption aus Schritt 5 war
   vollständig rückgängig gemacht
9. Temporäre Datenbank + Scratch-Config danach vollständig gelöscht
   (wrangler d1 delete turnen-restore-drill)
```

**Ergebnis: erfolgreich.** Der eigentliche Time-Travel-Restore-Schritt
(Bookmark ermitteln bis Validierung) dauerte unter einer Minute. Keine
Auffälligkeiten, kein manueller Nacharbeitsbedarf am Schema. Der
dokumentierte Ablauf in `deployment.md`/diesem Dokument entspricht dem
tatsächlich getesteten Vorgehen.

**Nicht getestet in diesem Drill**: Verhalten bei einem Restore, der
gleichzeitig ausstehende (noch nicht angewendete) Migrationen hinterlässt
(hier war das Schema zum Bookmark-Zeitpunkt bereits vollständig aktuell) -
das in Schritt 7 von `deployment.md`/oben beschriebene Nacharbeiten
("fehlende Migrationen erneut anwenden") bleibt insofern ein
dokumentierter, aber nicht selbst durchexerzierter Vorgang.
