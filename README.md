# Turnen – Gruppenverwaltung

Verwaltungs-App für eine Vereins-Turnabteilung (aktuell im Einsatz bei TuS
Büchenbeuren): Altersgruppen anlegen, Kinder verwalten, Anwesenheit pro
Trainingstermin erfassen, Vertretungen organisieren und daraus automatisch
den amtlichen Übungsleiter-Stundennachweis erzeugen.

Aufbau im Stil von [tournament-manager](https://github.com/): React 19 + Vite
+ Tailwind v4 Frontend (SQUORA-Blau-Farbschema), Cloudflare Worker (Hono) +
D1 als Backend mit JWT-Login, als zwei Cloudflare Workers deploybar
(`turnen-web` für Assets/SPA, `turnen-api` für die API). E-Mail-Versand über
Cloudflare Email Sending (`no_reply@squora.de`).

## Features

### Gruppen & Kinder
- Altersgruppen mit Alters-Range, optionalem Kapazitätslimit, Wochentag/Uhrzeit/Ort.
- Kinder mit Name, Geburtsdatum, Notfallkontakt, Gesundheitshinweisen (z. B. Allergien).
- Automatische Berechnung, wann ein Kind altersbedingt in die nächste Gruppe wechseln müsste, inkl. Verschiebe-Workflow.
- **Geschwister-Verknüpfung**: Kinder lassen sich zu einer Familie (gemeinsamer Kontakt) zusammenfassen – vereinsweit, funktioniert also auch gruppen- und übungsleiterübergreifend.
- **Warteliste**: Ist eine Gruppe voll, landet ein Kind auf der Warteliste und rückt automatisch nach, sobald ein Platz frei wird.

### Mehrere Vereine (Multi-Club)
- Gruppen gehören einem Verein; andere Übungsleiter*innen desselben Vereins sehen dessen Gruppen/Kinder lesend mit.
- Rolle **Jugendleiter*in**: kann Mitglieder dem Verein zuordnen, hat das letzte Wort bei Kapazitäts- und Altersgruppen-Konflikten.
- **Genehmigungs-Workflows**: Altersgruppen-Wechsel und Kapazitätsüberschreitungen lösen – je nach Zuständigkeit – entweder eine Selbstbestätigung oder eine Freigabe-Anfrage an die Jugendleitung aus.
- Altbestand ohne Vereinszuordnung lässt sich per „Beanspruchen“ (Claim) einem Verein zuordnen.

### Anwesenheit & Übersicht
- Anwesenheitsliste pro Gruppe und Termin, inkl. Sondertermine (z. B. Turnier) mit abweichender Uhrzeit/Ort/Notiz.
- **„Wer hat geleitet?“**: Jeder Termin bekommt eine Leitung zugeordnet (vereinsweite Auswahl) – Basis für die Stundenerfassung.
- Monatsübersicht pro Gruppe mit Anwesenheitsquote je Kind, Kalenderansicht der Trainingstermine (berücksichtigt rheinland-pfälzische Schulferien).
- **Anwesenheits-Trends**: zeigt, welche Kinder seit Wochen nicht mehr da waren.
- Club-weite **Auslastungsübersicht**: wie voll sind die Gruppen im Verein.

### Vertretungen
- Eine Turnstunde kann von jemand anderem als der Gruppenleitung übernommen werden („Vertretung“); die Stunde zählt automatisch im Stundennachweis der vertretenden Person statt der eigentlichen Leitung.
- Sichtbar in der Übersicht (↺-Markierung an den betroffenen Terminen).
- Benachrichtigung + Eintrag im Verlauf, sobald jemand als Vertretung eingetragen wird.
- **Vertretungsbörse**: offene Vertretungs-Anfragen vereinsweit veröffentlichen, übernehmen oder zurückziehen.

### Stundennachweis
- Bildet das amtliche Landessportbund-Formular „Stundennachweis des Übungsleiters“ 1:1 nach – automatisch befüllt aus den erfassten Anwesenheiten/Leitungen, nach Jahr/Quartal wählbar.
- Rechnet die **Aufbauzeit** korrekt mit ein: die eigentliche Stunde beginnt 30 Minuten vor dem Trainingsbeginn (z. B. Training 16:30–17:30 → angerechnet 16:00–17:30). Gilt einheitlich für Stundennachweis und CSV-Export.
- **Gesamtübersicht**: wie viele Stunden insgesamt schon geleitet wurden – aufgeteilt in eigene Gruppen vs. als Vertretung, mit Jahres-Aufschlüsselung.
- CSV-Export der geleisteten Stunden (eigener Zeitraum oder, als Jugendleitung, vereinsweit) als Basis für Zuschussnachweis/Übungsleiterpauschale.

### Druckansichten
- Anwesenheitsliste zum Ausdrucken mit wählbarem Zeitraum (Standard: aktueller Monat).
- Namensliste (Nachname, Vorname, Geburtsdatum) zum Ausdrucken.
- Alle Druckseiten sind unabhängig vom App-Darkmode immer hell/kontrastreich gestaltet.

### Benachrichtigungen & Nachvollziehbarkeit
- In-App-Postfach plus E-Mail-Benachrichtigung (Cloudflare Email Sending) bei Vertretungen, Genehmigungs-Anfragen, Wartelisten-Nachrückern etc.
- **Verlauf/Audit-Log**: wer hat wann was geändert (Vertretungen, Genehmigungen, Gruppenwechsel …), vereinsweit einsehbar.
- **Suche** über Kinder und Gruppen.

### Sonstiges
- PWA/Offline-fähig (Vite PWA, Caching der wichtigsten GET-Endpunkte).
- SQUORA-Branding: Logo + blaues Farbschema (Remap der Tailwind-Emerald-Palette).

## Projektstruktur

```
turnen/
├── src/                 React-SPA (Vite, Tailwind v4, React Router)
│   ├── pages/
│   │   ├── admin/       Gruppen, Kinder, Anwesenheit, Übersicht, Auslastung,
│   │   │                Kalender, Export, Verlauf, Vertretungen, Verein
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
node scripts/create-admin.mjs admin@example.com "MeinSicheresPasswort" "Vorname Nachname"
```

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
wrangler d1 create turnen          # einmalig, database_id in wrangler.toml eintragen
npm run db:migrate:remote
wrangler secret put JWT_SECRET
npm run deploy

# Web-Worker (Assets + SPA + Proxy zum API-Worker)
cd turnen
npm run build
npm run web:deploy
```

`turnen/worker/wrangler.toml` und `turnen/wrangler.toml` sind so vorbereitet,
dass bei Bedarf ein `[[routes]]`-Eintrag mit einer eigenen Domain ergänzt
werden kann (analog zum Referenzprojekt `tournament-manager`).

Neue D1-Migrationen werden aus `turnen/worker/` heraus ausgeführt:

```sh
cd turnen/worker
wrangler d1 migrations apply turnen --remote
```
