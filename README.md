# Turnen – Gruppenverwaltung

Verwaltungs-App für eine Vereins-Turnabteilung (aktuell im Einsatz bei TuS
Büchenbeuren): Altersgruppen anlegen, Kinder verwalten, Anwesenheit pro
Trainingstermin erfassen, Vertretungen organisieren und daraus automatisch
den amtlichen Übungsleiter-Stundennachweis erzeugen.

Aufbau im Stil von [tournament-manager](https://github.com/): React 19 + Vite
+ Tailwind v4 Frontend (SQUORA-Blau-Farbschema, Logo/Tabellenstil auch auf
den Druckseiten), Cloudflare Worker (Hono) + D1 als Backend mit JWT-Login,
als zwei Cloudflare Workers deploybar (`turnen-web` für Assets/SPA,
`turnen-api` für die API). E-Mail-Versand über Cloudflare Email Sending
(`no_reply@squora.de`).

Die App kennt zwei Rollen pro Verein: **Turnleiter*in** (`member`, leitet
eine oder mehrere eigene Gruppen) und **Jugendleiter*in** (`jugendleiter`,
Vereinsverwaltung + Freigabe-Instanz). Eine Jugendleitung kann gleichzeitig
auch eigene Gruppen leiten – überall, wo das relevant ist, greift dann die
großzügigere der beiden Berechtigungen. Details siehe [Berechtigungen](#berechtigungen).

## Features

### Start-Dashboard
- Eigene Kennzahlen (Gruppen, aktive Kinder, offene/anstehende Vertretungen) sowie eine „Wartet auf dich“-Liste aller offenen Anfragen (Verschieben, Kapazität, Platzvorschläge, abweichende Termine, Vereinsbeitritt) mit direkten Links.

### Gruppen & Kinder
- Altersgruppen mit Alters-Range, optionalem Kapazitätslimit, Wochentag/Uhrzeit/Ort.
- **Mehrere gleichberechtigte Leitungen pro Gruppe** (Mit-Trainer*innen): bekommen dieselben Schreibrechte wie die Gruppenleitung, verwaltet von Besitzer:in oder Jugendleitung.
- Kinder mit Name, Geburtsdatum, Notfallkontakt, Gesundheitshinweisen (z. B. Allergien).
- Kinder-Liste nach Gruppe gruppiert (Überschrift pro Gruppe statt Gruppen-Spalte).
- **Austreten lassen statt löschen**: ausgetretene Kinder behalten ihre Anwesenheitshistorie, zählen aber nirgends mehr aktiv mit (Kapazität, Listen) und lassen sich jederzeit reaktivieren (eigene Archiv-Ansicht).
- Automatische Berechnung, wann ein Kind altersbedingt in die nächste Gruppe wechseln müsste, inkl. Verschiebe-Workflow.
- **Geschwister-Verknüpfung**: Kinder direkt über eine Auswahl anderer Kinder als Geschwister verknüpfen (keine separat zu benennende „Familie“ mehr) – vereinsweit, funktioniert also auch gruppen- und übungsleiterübergreifend.
- **Gruppen-Warteliste**: Ist eine Gruppe voll, landet ein Kind auf der Warteliste und rückt automatisch nach, sobald ein Platz frei wird.
- **Vereinsweite Warteliste** (getrennt von der Gruppen-Warteliste): Kinder ohne Gruppe – auch als Direkt-Neuanmeldung ohne Umweg über die Kinder-Seite anlegbar. Turnleiter*innen melden an, die Jugendleitung sieht die konsolidierte Liste, kann eine passende Gruppe vorschlagen (automatische Empfehlung nach Alter + geringster Auslastung) und wird bei jeder Neuanmeldung per E-Mail benachrichtigt; die vorgeschlagene Gruppenleitung muss den Vorschlag aktiv bestätigen oder ablehnen, bevor das Kind wirklich verschoben wird.

### Mehrere Vereine (Multi-Club)
- Gruppen gehören einem Verein; andere Übungsleiter*innen desselben Vereins sehen dessen Gruppen/Kinder lesend mit.
- **Vereinsbeitritt braucht Freigabe**: Tritt jemand einem Verein mit bestehender Jugendleitung bei, entsteht eine Beitrittsanfrage – die Jugendleitung muss sie freigeben oder ablehnen (Vereine ohne Jugendleitung bleiben direkt beitretbar). Verlassen eines Vereins bleibt jederzeit sofort möglich.
- Mitgliederliste samt Befördern/Zurückstufen zur Jugendleitung sieht nur die Jugendleitung selbst.
- **Genehmigungs-Workflows**: Altersgruppen-Wechsel und Kapazitätsüberschreitungen lösen – je nach Zuständigkeit – entweder eine Selbstbestätigung oder eine Freigabe-Anfrage an die Jugendleitung aus.
- Altbestand ohne Vereinszuordnung lässt sich per „Beanspruchen“ (Claim) einem Verein zuordnen.

### Anwesenheit & Übersicht
- Anwesenheitsliste pro Gruppe – auswählbar sind nur Termine am konfigurierten Trainingstag der Gruppe, plus eigene, aktuell übernommene Vertretungstermine.
- **Trainingsausfall verwalten**: ein Termin lässt sich mit Grund komplett absagen (Ferien-Ausnahme, Trainer krank ohne Vertretung) und jederzeit wieder aufheben – sichtbar in der Übersicht (durchgestrichenes Datum, roter Hinweis). Keine Freigabe nötig.
- **Abweichender Termin** (z. B. Turnier, andere Uhrzeit/Ort): Turnleiter*innen können das nur anfragen, die Jugendleitung muss freigeben oder ablehnen; die eigentliche Anwesenheitserfassung wird davon unabhängig sofort gespeichert.
- **„Wer hat geleitet?“**: Jeder Termin bekommt eine Leitung zugeordnet (vereinsweite Auswahl) – Basis für die Stundenerfassung.
- Monatsübersicht pro Gruppe mit Anwesenheitsquote je Kind, Kalenderansicht der Trainingstermine (berücksichtigt rheinland-pfälzische Schulferien).
- **Anwesenheits-Trends**: zeigt, welche Kinder seit Wochen nicht mehr da waren.
- **Auslastungsübersicht**: Turnleiter*innen sehen die Auslastung der eigenen Gruppe(n), die Jugendleitung die aller Gruppen des Vereins.
- **Mitgliederstatistik über Zeit**: Mitgliederzahl je Gruppe/Verein der letzten 12 Quartale, mit Trendbalken und Veränderung zum Vorquartal – basiert auf An-/Abmeldedatum der Kinder (möglich seit „Austreten lassen“ statt Löschen).

### Vertretungen
- Eine Turnstunde kann von jemand anderem als der Gruppenleitung übernommen werden („Vertretung“); die Stunde zählt automatisch im Stundennachweis der vertretenden Person statt der eigentlichen Leitung.
- **Vertretungsbörse**: offene Vertretungs-Anfragen vereinsweit veröffentlichen, übernehmen oder zurückziehen.
- Sobald eine Anfrage übernommen ist, liegen die Schreibrechte für genau diesen Termin exklusiv bei der Vertretung – die ursprüngliche Gruppenleitung kann für diesen Tag keine Anwesenheit mehr erfassen und sich die Stunde nicht mehr selbst anrechnen.
- **Zurückgeben**: sowohl die Vertretung („kann kurzfristig doch nicht“) als auch die ursprüngliche Gruppenleitung („übernimmt kurzfristig wieder selbst“) können eine übernommene Vertretung zurückgeben – die Schreibrechte wandern sofort zurück.
- Sichtbar im Trainingskalender (Abschnitt „Anstehende Vertretungen“, vereinsweit) und in der Übersicht (↺-Markierung an den betroffenen Terminen).
- Benachrichtigung + Eintrag im Verlauf, sobald jemand als Vertretung eingetragen wird.

### Trainingskalender
- Wochenplan aller Gruppen des Vereins, nach Wochentag sortiert; eigene Gruppe(n) sind optisch hervorgehoben.
- Abschnitt „Anstehende Vertretungen“: alle bereits übernommenen Vertretungstermine im Verein ab heute, mit Datum, Gruppe und wer für wen einspringt.

### Stundennachweis
- Bildet das amtliche Landessportbund-Formular „Stundennachweis des Übungsleiters“ 1:1 nach (inkl. SQUORA-Logo/Farbschema) – automatisch befüllt aus den erfassten Anwesenheiten/Leitungen, nach Jahr/Quartal wählbar, Ort/Sportart/Lizenz-Nr. frei editierbar.
- Rechnet die **Aufbauzeit** korrekt mit ein: die eigentliche Stunde beginnt 30 Minuten vor dem Trainingsbeginn (z. B. Training 16:30–17:30 → angerechnet 16:00–17:30). Gilt einheitlich für Stundennachweis und CSV-Export.
- **Gesamtübersicht**: wie viele Stunden insgesamt schon geleitet wurden – aufgeteilt in eigene Gruppen vs. als Vertretung, mit Jahres-Aufschlüsselung.
- CSV-Export der geleisteten Stunden: Turnleiter*innen sehen und exportieren nur die eigenen Gruppen, die Jugendleitung zusätzlich wahlweise alle Gruppen des Vereins.

### Druckansichten
- Anwesenheitsliste zum Ausdrucken mit wählbarem Zeitraum (Standard: aktueller Monat), inkl. Gesamtanzahl der Kinder und einer Quote-Tabelle je Kind (X von Y Terminen, Prozent).
- Namensliste (Nachname, Vorname, Geburtsdatum) zum Ausdrucken – auswählbar für mehrere Gruppen gleichzeitig (Badge-Auswahl), jede Gruppe auf eigener Seite.
- **Notfallliste** (Name, Notfallkontakt, Telefon, Gesundheitshinweise) zum Ausdrucken für den Ernstfall in der Halle – gleiche Mehrfach-Gruppen-Auswahl.
- Alle Druckseiten sind unabhängig vom App-Darkmode immer hell/kontrastreich gestaltet, im SQUORA-Formularstil (Logo, blaue Tabellenköpfe).

### Benachrichtigungen & Nachvollziehbarkeit
- In-App-Postfach plus E-Mail-Benachrichtigung (Cloudflare Email Sending) bei Vertretungen, Genehmigungs-Anfragen, Wartelisten-Vorschlägen, Beitrittsanfragen etc.
- **Verlauf/Audit-Log**: wer hat wann was geändert. Turnleiter*innen sehen nur Einträge zu ihrer eigenen Gruppe, die Jugendleitung den gesamten Verein.
- **Suche** über Kinder und Gruppen.

### Sonstiges
- PWA/Offline-fähig (Vite PWA, Caching der wichtigsten GET-Endpunkte).
- SQUORA-Branding: Logo + blaues Farbschema (Remap der Tailwind-Emerald-Palette), auch auf den Druckseiten.

## Berechtigungen

Kurzübersicht, wer was darf. „Eigene Gruppe“ bedeutet: Gruppen, deren
`owner_id` der jeweiligen Person entspricht (oder herrenlose Alt-Gruppen ohne
Verein). Eine Jugendleitung, die selbst eine Gruppe leitet, hat für diese
zusätzlich alle Turnleiter-Rechte.

| Bereich | Turnleiter*in | Jugendleiter*in |
|---|---|---|
| Eigene Gruppen/Kinder anlegen & bearbeiten | ✅ | ✅ (eigene) |
| Fremde Gruppen/Kinder desselben Vereins | nur lesend | nur lesend (Schreiben bleibt bei der Gruppenleitung) |
| Mit-Trainer*in einer Gruppe hinzufügen/entfernen | nur als Besitzer:in der Gruppe | ✅ (für jede Gruppe des Vereins) |
| Kind austreten lassen/reaktivieren | ✅ (eigene Gruppe) | ✅ (eigene Gruppe) |
| Anwesenheit erfassen | nur eigene Gruppe, nur am Trainingstag (+ eigene Vertretungstermine) | wie Turnleiter*in für eigene Gruppe(n) |
| Trainingstermin absagen/Absage aufheben | ✅ (eigene Gruppe) | ✅ (eigene Gruppe) |
| Abweichenden Termin setzen (Uhrzeit/Ort) | nur anfragen | anfragen **und** freigeben/ablehnen |
| Vertretung anbieten/übernehmen | ✅ (Vertretungsbörse) | ✅ |
| Vertretung zurückgeben | ✅ (als Vertretung oder als ursprüngliche Leitung) | ✅ |
| Auslastung ansehen | nur eigene Gruppe(n) | alle Gruppen des Vereins |
| Mitgliederstatistik ansehen | nur eigene Gruppe(n) | alle Gruppen des Vereins |
| Verlauf/Audit-Log ansehen | nur eigene Gruppe | gesamter Verein |
| Stunden-Export (CSV) | nur eigene Gruppen | eigene Gruppen **oder** vereinsweit |
| Vereinsweite Warteliste: Kind anmelden | ✅ | ✅ |
| Vereinsweite Warteliste: Gesamtliste ansehen, Gruppe vorschlagen | ❌ | ✅ |
| Platzvorschlag für eigene Gruppe bestätigen/ablehnen | ✅ | ✅ |
| Vereinsbeitritt | Anfrage stellen (braucht Freigabe, außer der Verein hat noch keine Jugendleitung) | direkt, plus Freigabe fremder Anfragen |
| Mitgliederliste/-verwaltung, Vereinsnummer | ❌ | ✅ |
| Kapazitäts-/Altersgruppen-Konflikte | Selbstbestätigung oder Freigabe-Anfrage, je nach Zuständigkeit | freigeben/ablehnen (bzw. Selbstbestätigung für eigene Gruppen) |

## Projektstruktur

```
turnen/
├── src/                 React-SPA (Vite, Tailwind v4, React Router)
│   ├── pages/
│   │   ├── admin/       Dashboard, Gruppen, Kinder, Anwesenheit, Übersicht,
│   │   │                Auslastung, Kalender, Export, Verlauf, Vertretungen,
│   │   │                Warteliste, Verein
│   │   ├── AttendancePrint.tsx   Druckansicht Anwesenheitsliste/Namensliste
│   │   └── HoursReport.tsx       Stundennachweis (eigene Route, außerhalb des Layouts)
│   └── components/      Layout, Formulare, SQUORA-Branding
└── worker/               Cloudflare Worker (Hono) + D1
    ├── src/
    │   ├── index.ts      REST-API-Routen
    │   ├── db.ts         D1-Zugriffe
    │   ├── auth.ts        JWT-Auth-Middleware
    │   ├── notifications.ts  In-App- + E-Mail-Benachrichtigungen
    │   └── types.ts
    └── migrations/       D1-Schema, chronologisch (0001 … )
```

## Lokale Entwicklung

Voraussetzung: Node.js, `npm`.

### 1. API-Worker

```sh
cd turnen/worker
npm install
cp .dev.vars.example .dev.vars   # JWT_SECRET lokal setzen
npm run db:migrate:local          # legt das lokale D1-Schema an
npm run dev                       # startet wrangler dev auf Port 8787
```

Ersten Login-Nutzer anlegen:

```sh
node scripts/create-admin.mjs admin@example.com "Vorname Nachname"
```

Das Passwort wird danach interaktiv abgefragt (nicht als Argument), damit es
nicht in der Shell-History landet.

Das Skript gibt ein fertiges `wrangler d1 execute ... --local`-Kommando aus,
das einmalig ausgeführt wird.

### 2. Frontend

In einem zweiten Terminal:

```sh
cd turnen
npm install
npm run dev                       # Vite-Dev-Server auf Port 5173, proxy't /api zu :8787
```

Danach unter `http://localhost:5173` mit dem angelegten Nutzer anmelden.

## Deployment (Cloudflare)

Beide Worker werden unabhängig deployed:

```sh
# API-Worker (besitzt die D1-Datenbank)
cd turnen/worker
wrangler d1 create <name> --jurisdiction eu   # einmalig, database_id in wrangler.toml eintragen -
                                               # jurisdiction=eu ist Pflicht (Finding CF-01), nicht
                                               # nur ein --location-Hint
npm run db:migrate:remote
wrangler secret put JWT_SECRET
npm run deploy

# Web-Worker (Assets + SPA + Proxy zum API-Worker)
cd turnen
npm run build
npm run web:deploy
```

Live erreichbar unter:
- <https://squora.de/turnen-light/> (primär, per `[[routes]]`-Eintrag in
  `turnen/wrangler.toml` an die bestehende, Cloudflare-verwaltete Zone
  `squora.de` gebunden – analog zum Referenzprojekt `tournament-manager`)
- <https://turnen-web.squora.workers.dev> (Standard-`workers.dev`-Subdomain,
  bleibt zusätzlich aktiv)

Der Produktions-Build referenziert seine eigenen Assets dafür unter dem
Präfix `/turnen-light/...` (`VITE_APP_BASE_PATH` in `turnen/.env.production`);
`cloudflare/web-router.ts` schneidet diesen Präfix host-unabhängig wieder ab,
sodass beide URLs mit demselben Build bedient werden. Lokale Entwicklung
bleibt davon unberührt (kein `.env.development`, `vite dev` läuft weiter auf
`/`).

Neue D1-Migrationen werden aus `turnen/worker/` heraus ausgeführt:

```sh
cd turnen/worker
npm run db:migrate:remote
```
