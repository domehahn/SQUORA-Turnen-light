# Turnen – Gruppenverwaltung

Kleine Verwaltungs-App für eine Turnabteilung: Altersgruppen anlegen, Kinder
mit Name und Geburtsdatum verwalten und pro Termin eine Anwesenheitsliste
führen. Anhand des Geburtsdatums wird automatisch berechnet, in welchem
Monat/Jahr ein Kind altersbedingt in die nächsthöhere Gruppe wechseln würde.

Aufbau im Stil von [tournament-manager](https://github.com/): React 19 + Vite
+ Tailwind v4 Frontend, Cloudflare Worker (Hono) + D1 als Backend mit
JWT-Login, jeweils als zwei Cloudflare Workers deploybar (`turnen-web` für
Assets/SPA, `turnen-api` für die API).

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
