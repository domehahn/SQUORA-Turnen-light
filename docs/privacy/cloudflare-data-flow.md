# Cloudflare Data Flow — Turnen (SQUORA)

Stand: 2026-08-26. Basiert auf der tatsächlichen Konfiguration im Repository
(`turnen/wrangler.toml`, `turnen/worker/wrangler.toml`) und einer
Live-Prüfung der produktiven D1-Datenbank (`wrangler d1 info turnen`).
Konfiguration, die nur im Cloudflare-Dashboard sichtbar ist (Cache Rules,
Logpush, Analytics), ist als `VERIFY IN CLOUDFLARE DASHBOARD` markiert —
sie wurde nicht erfunden.

## Architektur

```
STRATO Domain Registrar (nur DNS-Registrierung von squora.de)
        |
        v
Cloudflare DNS (Zone squora.de)
        |
        v
turnen-web (Cloudflare Worker mit Assets-Binding — KEIN Cloudflare Pages)
   Route: squora.de/turnen-light*
        |
        +---- ASSETS-Binding: statische SPA-Dateien (JS/CSS/Icons), keine
        |     personenbezogenen Daten enthalten (Build-Artefakte, siehe
        |     Abschnitt "Cloudflare Pages/Assets" unten)
        |
        +---- API-Binding (Service Binding, worker-zu-worker, kein
              öffentliches HTTP/keine Edge-Cache-Beteiligung)
                    |
                    v
              turnen-api (Cloudflare Worker)
                    |
                    +---- D1 "turnen-eu" — running_in_region: EEUR,
                    |     jurisdiction: eu  (migriert 2026-08-26, siehe CF-01)
                    |
                    +---- Email Sending Binding ("EMAIL") →
                    |     Cloudflare Email Service → SMTP-Zustellung an
                    |     externe Postfächer der Nutzer*innen
                    |
                    +---- Cron Trigger (0 8 * * *) — täglicher Reminder-Job,
                          liest/schreibt dieselbe D1-Datenbank
```

**Nicht verwendet** (verifiziert durch vollständige Prüfung beider
`wrangler.toml`-Dateien): Cloudflare Pages, R2, KV, Durable Objects, Queues,
Cloudflare Access, Turnstile, Workers Analytics Engine, Logpush.

## Service-für-Service-Dokumentation

### Cloudflare DNS
- **Zweck:** Auflösung von `squora.de` auf Cloudflare-Edge.
- **Personenbezogene Daten:** Keine (DNS-Records enthalten keine
  Nutzerdaten).
- **Gesundheitsdaten:** Keine.
- **Speicherort/Verarbeitungsort:** Cloudflare-globales Anycast-Netzwerk.
- **Aufbewahrung:** N/A.
- **Logging:** DNS-Query-Logs bei Cloudflare — Umfang/Aufbewahrung: `VERIFY IN CLOUDFLARE DASHBOARD`.
- **Caching:** N/A (DNS).
- **Verschlüsselung:** DNSSEC-Status nicht aus dem Repo verifizierbar — `VERIFY IN CLOUDFLARE DASHBOARD`.
- **Jurisdiktion konfiguriert:** Nein, nicht anwendbar auf DNS-Records selbst.
- **Externe Übermittlung:** Keine über DNS-Auflösung hinaus.
- **Erforderlich:** Ja (Grundvoraussetzung für Erreichbarkeit).

### STRATO (Domain-Registrar)
- **Zweck:** Ausschließlich Registrierung/Verwaltung der Domain `squora.de` (Whois, Registrar-Kontaktdaten).
- **Personenbezogene Daten:** Registrar-Kontaktdaten des Domaininhabers (nicht der App-Nutzer*innen/Kinder) — je nach Whois-Privacy-Einstellung ggf. öffentlich einsehbar.
- **Gesundheitsdaten:** Keine — **Vorgabe:** STRATO darf keine Kind-/Erziehungsberechtigten-/Notfall-/Gesundheitsdaten der App erhalten. Aus dem Code-Review ergibt sich kein Datenfluss App → STRATO; STRATO ist ausschließlich Registrar, kein Hosting/Processing für App-Daten.
- **Speicherort/Verarbeitungsort:** STRATO (Deutschland) für Registrar-Daten.
- **Aufbewahrung:** Registrar-übliche Fristen — `LEGAL/PRIVACY REVIEW REQUIRED` falls Registrar-Kontaktdaten einer natürlichen Person betreffen.
- **Erforderlich:** Ja, für die Domain selbst — kein Ersatz/keine Rolle im App-Datenfluss.

### Cloudflare Workers (`turnen-web`, `turnen-api`)
- **Zweck:** `turnen-web` liefert die SPA aus und leitet `/api/*` per Service Binding weiter; `turnen-api` enthält die gesamte Geschäftslogik (Hono-App, `worker/src/index.ts`).
- **Personenbezogene Daten:** Alle in `docs/privacy/data-inventory.md` klassifizierten Daten laufen während der Verarbeitung durch `turnen-api` (Request-Body, DB-Queries, Response-Body).
- **Gesundheitsdaten:** Ja — `health_notes`, Notfallkontakte, Geburtsdatum werden bei jedem `GET /api/children`, `POST/PUT /api/children`, E-Mail-Versand etc. durch den Worker-Prozess verarbeitet (Transit, nicht dauerhafte Speicherung im Worker selbst — Worker sind stateless zwischen Requests).
- **Speicherort:** N/A (kein persistenter Storage im Worker selbst).
- **Verarbeitungsort:** Cloudflares globales Edge-Netzwerk — **standardmäßig nicht auf die EU beschränkt.** Siehe Finding CF-02.
- **Aufbewahrung:** N/A (stateless Ausführung pro Request).
- **Logging:** `console.error` in zwei Stellen (`worker/src/index.ts: app.onError`, `worker/src/notifications.ts`) — landet in Cloudflare Observability/Workers Logs. Kein bekannter PII-Inhalt aktuell, aber keine strukturelle Redaction-Garantie (siehe SEC-09 in der Gap-Analyse).
- **Caching:** `/api/*`-Antworten werden explizit mit `Cache-Control: no-store` markiert (`worker/src/index.ts`, globale Middleware). Ob eine dashboard-seitige Cache Rule das überschreiben könnte: `VERIFY IN CLOUDFLARE DASHBOARD`.
- **Verschlüsselung:** TLS zwischen Client und Cloudflare-Edge (Standard-Cloudflare-TLS, Zertifikat für `squora.de`). `turnen-web` → `turnen-api` läuft über Service Binding (worker-internes RPC, kein separates TLS-Handshake nötig, verlässt Cloudflares Infrastruktur nicht).
- **Jurisdiktion konfiguriert:** Nein — kein Regional-Services-Setup in `wrangler.toml` gefunden.
- **Externe Übermittlungen:** An Cloudflare Email Service (siehe unten) und an den anfragenden Client selbst (Response).
- **Erforderlich:** Ja, zentrale Komponente.
- **Finding:** **CF-02 — `CLOUDFLARE_WORKER_GLOBAL_PROCESSING`**, Severity **High** (Gesundheitsdaten Minderjähriger). Siehe Abschnitt "Findings" unten.

### Cloudflare D1 (`turnen-eu`)
- **Zweck:** Primäre und einzige persistente Datenbank der App (alle Tabellen, siehe `docs/privacy/data-inventory.md`).
- **Personenbezogene Daten:** Ja — vollständig (Kinder, Notfallkontakte, Nutzer-Accounts, Audit-Log).
- **Gesundheitsdaten:** **Nein mehr** — `children.health_notes` und das allgemeine Freitextfeld `children.notes` wurden vollständig entfernt (Migrationen `0033`/`0034`).
- **Speicherort/Verarbeitungsort:** Live geprüft am 2026-08-26 via `wrangler d1 info turnen-eu`:
  ```
  running_in_region: EEUR
  jurisdiction: eu
  ```
  **Migriert am 2026-08-26** von der vorherigen Datenbank `turnen` (`jurisdiction: null`, nur Location Hint `WEUR`) auf eine neu angelegte Datenbank mit harter EU-Jurisdiktionsbeschränkung (`wrangler d1 create turnen-eu --jurisdiction eu`). Ablauf: Schema per `wrangler d1 migrations apply turnen-eu --remote` aufgebaut, Daten per `wrangler d1 export turnen --remote --no-schema` exportiert und importiert, Zeilenzahlen aller 21 Tabellen sowie `PRAGMA foreign_key_check` (0 Verletzungen) vor dem Cutover verglichen, `worker/wrangler.toml` auf die neue `database_id` umgestellt, deployt, alte Datenbank `turnen` (inkl. ihrer Time-Travel-Historie) anschließend gelöscht.
- **Aufbewahrung:** Unbegrenzt (kein Retention-Job implementiert) — siehe `docs/privacy/retention-policy.md`.
- **Logging:** D1-Query-Metriken (Anzahl Lese-/Schreibzugriffe) bei Cloudflare — Inhalt der Queries wird laut Cloudflare-Dokumentation nicht standardmäßig geloggt; **nicht aus dem Repo verifizierbar** → `VERIFY IN CLOUDFLARE DASHBOARD`.
- **Caching:** D1 selbst cached nicht; die App liest bei jedem Request live.
- **Verschlüsselung:** Cloudflare gibt an, D1 „at rest" plattformseitig zu verschlüsseln — das ist eine Infrastruktur-Zusage von Cloudflare, **nicht** im Code verifizierbar. Notfallkontakte sind zusätzlich per Application-Level-Verschlüsselung geschützt (AES-256-GCM, `worker/src/crypto.ts`).
- **Jurisdiktion konfiguriert:** **Ja, `eu`** (seit 2026-08-26).
- **Externe Übermittlungen:** Keine über Cloudflares eigene Infrastruktur hinaus.
- **Erforderlich:** Ja, zentrale Komponente.
- **Finding:** **CF-01 — `D1_DATABASE_WITHOUT_EU_JURISDICTION`** — **Behoben am 2026-08-26**, siehe Migrationsprotokoll oben.

### Cloudflare Email Service (Email Sending Binding `EMAIL`)
- **Zweck:** Versand von In-App-Benachrichtigungs-E-Mails (`worker/src/notifications.ts`) — z.B. Freigabe-Anfragen, Wartelisten-Rückruf.
- **Personenbezogene Daten:** Empfänger-E-Mail-Adresse/-Name, Titel/Body der Benachrichtigung.
- **Gesundheitsdaten:** **Ja, aktuell** — `childContactSummary()` (`worker/src/index.ts:1088`) fügt `health_notes` und Notfallkontakte in den E-Mail-Body ein (zwei Aufrufstellen: Zeile 1712, 2307). Das ist Finding **PRIV-01** (Critical) in der Gap-Analyse und muss vorrangig behoben werden.
- **Speicherort/Verarbeitungsort:** Cloudflare Email Service verarbeitet den Versand; danach liegt die E-Mail beim externen Mail-Provider des Empfängers (z.B. Gmail, iCloud) — außerhalb jeder Kontrolle der App.
- **Aufbewahrung:** Unbegrenzt beim Empfänger-Mailprovider — technisch nicht durch die App beeinflussbar.
- **Logging:** Zustellstatus (best effort, Fehler werden in `console.error` geloggt, siehe `worker/src/notifications.ts`).
- **Caching:** N/A.
- **Verschlüsselung:** Transport (SMTP/TLS) laut Cloudflare-Standard; Inhalt der E-Mail ist beim Empfänger nicht Ende-zu-Ende-verschlüsselt.
- **Jurisdiktion konfiguriert:** Nicht anwendbar/nicht bekannt — `VERIFY IN CLOUDFLARE DASHBOARD` bzw. bei Cloudflare-Support erfragen.
- **Externe Übermittlungen:** Ja, an beliebige externe Mail-Provider der Empfänger — **dies ist der aktuell schwerwiegendste Datenfluss für Gesundheitsdaten** (siehe PRIV-01).
- **Erforderlich:** Ja für Benachrichtigungen, **aber ohne Gesundheitsdaten im Body** (siehe Empfehlung in der Gap-Analyse).

### Cloudflare Pages / Assets
- **Nicht verwendet als eigenständiges Produkt.** Die statischen SPA-Dateien werden über eine Workers-Assets-Bindung (`[assets]` in `wrangler.toml`, `binding = "ASSETS"`) ausgeliefert, nicht über ein separates Cloudflare-Pages-Projekt.
- **Personenbezogene Daten in Build-Artefakten:** Geprüft — der Vite-Build (`turnen/dist/`) enthält ausschließlich kompilierten JS/CSS/HTML-Code und statische Icons/Manifest-Dateien. Es werden **keine** Nutzerdaten zur Build-Zeit eingebettet (keine Fixtures, keine `.env`-Werte mit PII — `.env.production` enthält nur öffentliche Pfad-Konfiguration, siehe `PRIVACY_SECURITY_GAP_ANALYSIS.md` INFO-02). Alle personenbezogenen Daten werden ausschließlich zur Laufzeit per API-Call nachgeladen, nie serverseitig ins HTML/JS eingebettet.
- **Erforderlich:** Ja.

### Cloudflare Cache/CDN
- **Zweck:** Auslieferung statischer Assets (JS/CSS/Icons) mit Standard-Edge-Caching.
- **Personenbezogene Daten im Cache:** Keine, solange Cache Rules sich auf statische Assets beschränken (Standardverhalten). Für `/api/*` gilt `Cache-Control: no-store` aus dem Worker-Code (siehe oben) — **ob eine Zone-weite Cache Rule das überschreibt, ist nicht aus dem Repo verifizierbar.**
- **Finding CF-03:** `VERIFY IN CLOUDFLARE DASHBOARD` — Cache Rules für `squora.de` prüfen, insbesondere dass kein „Cache Everything" auf `/turnen-light/api/*` aktiv ist.

### Nicht konfiguriert (aus dem Repo bestätigt)
| Service | Status | Anmerkung |
|---|---|---|
| Cloudflare R2 | Nicht verwendet | Kein `[[r2_buckets]]`-Eintrag in beiden `wrangler.toml`. Falls künftig für Exporte/Dokumente eingeführt: `jurisdiction = "eu"` von Anfang an, niemals öffentlicher Bucket, nur signierte kurzlebige Download-URLs. |
| Cloudflare KV | Nicht verwendet | Kein `[[kv_namespaces]]`-Eintrag. Falls künftig eingeführt (z.B. für Rate-Limiting-Zähler, siehe SEC-01): nur nicht-personenbezogene Zählwerte (z.B. Hash der IP, keine Klardaten), keine Kind-/Gesundheitsdaten. |
| Cloudflare Durable Objects | Nicht verwendet | Kein `[[durable_objects]]`-Eintrag. |
| Cloudflare Queues | Nicht verwendet | Kein `[[queues]]`-Eintrag. |
| Cloudflare Access | Nicht verwendet | Kein Access-Policy-Verweis im Repo. |
| Turnstile | Nicht verwendet | Kein Turnstile-Sitekey/Secret im Code — Login hat daher auch keinen Bot-Schutz (siehe SEC-01 in der Gap-Analyse). |
| Logpush | Nicht im Repo konfiguriert | `VERIFY IN CLOUDFLARE DASHBOARD` — Logpush wird typischerweise nur im Dashboard/per API konfiguriert, nicht in `wrangler.toml`. |
| Workers Analytics Engine | Nicht verwendet | Kein `[[analytics_engine_datasets]]`-Eintrag. |

## Findings (Zusammenfassung, Details siehe `PRIVACY_SECURITY_GAP_ANALYSIS.md`)

### CF-01: `D1_DATABASE_WITHOUT_EU_JURISDICTION` — BEHOBEN (2026-08-26)

Die vorherige produktive D1-Datenbank `turnen` hatte **keine** EU-Jurisdiktionsbeschränkung
(`jurisdiction: null`), nur den Location Hint `WEUR`.

**Nutzerentscheidung 2026-08-26: sofortige Migration freigegeben** (Datenbank
war zu diesem Zeitpunkt erst 5 Tage alt, 381 kB, kurze Downtime akzeptiert).
Durchgeführter Migrationspfad:

1. Neue D1-Datenbank mit `jurisdiction = "eu"` angelegt:
   `wrangler d1 create turnen-eu --jurisdiction eu` (Region `EEUR`).
2. Schema per `wrangler d1 migrations apply turnen-eu --remote` aufgebaut
   (alle 34 Migrationen, identisch zur Quelldatenbank).
3. Datenexport aus der alten Datenbank (`wrangler d1 export turnen --remote
   --no-schema`), `d1_migrations`-Zeilen aus dem Dump entfernt (die neue DB
   hat ihre eigene Migrationshistorie), Import in `turnen-eu`
   (`wrangler d1 execute turnen-eu --remote --file=...`).
   Import mit `PRAGMA foreign_keys=OFF` (D1 wertete die Fremdschlüssel
   trotz `defer_foreign_keys` beim Bulk-Import sofort statt am
   Transaktionsende aus) — anschließend `PRAGMA foreign_key_check` auf der
   Zieldatenbank ausgeführt: **0 Verletzungen**.
4. **Validierung**: Zeilenzahl je Tabelle (alle 21 Tabellen) zwischen alter
   und neuer Datenbank verglichen — exakte Übereinstimmung (591 Zeilen
   gesamt).
5. `worker/wrangler.toml` (`database_id`) auf `turnen-eu` umgestellt,
   deployt, Smoke-Test (Login-Endpunkt antwortet korrekt).
6. Alte Datenbank `turnen` (inkl. ihrer Time-Travel-Historie, die noch
   Zustände mit den inzwischen entfernten Feldern `health_notes`/`notes`
   enthalten haben könnte) unmittelbar danach gelöscht
   (`wrangler d1 delete turnen`) — damit ist auch der in Abschnitt 15 der
   ursprünglichen Anfrage benannte Time-Travel-Restrisiko-Zeitraum
   geschlossen.

### CF-02: `CLOUDFLARE_WORKER_GLOBAL_PROCESSING` — HIGH PRIVACY FINDING

Beide Worker laufen ohne Cloudflare Regional Services/Data Localization.
Requests mit Gesundheitsdaten (z.B. `POST /api/children` mit
`healthNotes`-Feld) werden am jeweils nächstgelegenen globalen
Cloudflare-Standort verarbeitet, nicht auf die EU beschränkt.

Mögliche Abhilfen (Auswahl **LEGAL/PRIVACY REVIEW REQUIRED**, da Kosten-
und Architekturimplikationen):

- **Cloudflare Regional Services** aktivieren (Business/Enterprise-Plan
  nötig) — verarbeitet Requests nur an EU-Standorten.
- **Vertragliche Absicherung** über Standardvertragsklauseln (SCC) als
  Transfer-Sicherung akzeptieren, falls Regional Services nicht
  wirtschaftlich ist — **das ist eine rechtliche Bewertung, keine
  Code-Entscheidung.**
- Architektonisch: Verarbeitung von Health-Daten am Edge minimieren (z.B.
  `health_notes` nicht im initialen Request-Parsing anfassen, sondern erst
  nach Autorisierungsprüfung laden) — reduziert Exposure, löst das
  grundsätzliche Problem aber nicht vollständig.

## Offene Punkte

- `VERIFY IN CLOUDFLARE DASHBOARD`: Cache Rules für `squora.de`.
- `VERIFY IN CLOUDFLARE DASHBOARD`: Logpush-Konfiguration.
- `VERIFY IN CLOUDFLARE DASHBOARD`: D1-Query-Logging-Umfang.
- `LEGAL/PRIVACY REVIEW REQUIRED`: Freigabe des D1-Jurisdiktions-Migrationsplans (CF-01).
- `LEGAL/PRIVACY REVIEW REQUIRED`: Entscheidung zu Regional Services vs. SCC (CF-02).
- `LEGAL/PRIVACY REVIEW REQUIRED`: AVV mit Cloudflare für alle genutzten Dienste (D1, Workers, Email Sending) prüfen/abschließen.
