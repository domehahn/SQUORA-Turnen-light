# SQUORA Turnen – native App (iOS / Android)

Die native App ist **derselbe React-Build**, per [Capacitor](https://capacitorjs.com)
in eine native Shell verpackt. Die Web-App unter `squora.de/turnen-light`
bleibt unverändert und ist der Referenz-Kanal.

## Unterschiede App ↔ Web

| | Web (Browser) | App (Capacitor) |
|---|---|---|
| Auslieferung | `squora.de/turnen-light` | gebündelte Assets auf dem Gerät |
| Anmeldung | HttpOnly-Cookie `turnen_session` | **Bearer-Token** im Secure-Storage (Keychain/Keystore), Header `Authorization: Bearer …` + `X-Client: turnen-app` |
| Session-Timeout | 5 Min idle / 8 h absolut | 30 Tage idle / 90 Tage absolut (`APP_*` in `worker/src/auth.ts`) |
| API-URL | relativ (`/turnen-light`) | absolut (`.env.mobile` → `VITE_API_URL`) |

Serverseitig ist alles **additiv**: Ein Request ohne `Authorization`/`X-Client`
verhält sich exakt wie bisher. Migration `0055_session_client.sql` fügt nur die
Spalte `sessions.client` hinzu.

## Einmalige Einrichtung (lokal, braucht Xcode / Android Studio)

```bash
cd turnen
npm install
npx cap add ios          # erzeugt ios/  (braucht Xcode + CocoaPods)
npx cap add android      # erzeugt android/ (braucht Android Studio + JDK 17)
```

Die erzeugten Ordner `ios/` und `android/` gehören ins Repo committet
(Capacitor-Empfehlung) – App-Icons, Splashscreens und native Einstellungen
liegen dort.

## Build & Run

```bash
npm run mobile:sync          # vite build --mode mobile  +  cap sync
npm run mobile:ios           # + öffnet Xcode  -> dort auf Gerät/Simulator starten
npm run mobile:android       # + öffnet Android Studio
```

`--mode mobile` lädt `.env.mobile` (Basis-Pfad `/`, absolute API-URL).

## Live-Reload während der Entwicklung

In `capacitor.config.ts` temporär ergänzen und `cap sync` laufen lassen:

```ts
server: { url: "http://<deine-LAN-IP>:5173", cleartext: true }
```

`npm run dev` starten – Änderungen erscheinen sofort in der App. **Vor dem
Release wieder entfernen.**

## Noch offen (bewusst nicht in diesem PR)

- **Push-Benachrichtigungen** (APNs/FCM): `@capacitor/push-notifications`,
  Device-Token-Tabelle + Versand im Worker. Größtes verbleibendes Backend-Stück.
- **QR-Scanner** für den Anwesenheits-Check-in (`@capacitor-mlkit/barcode-scanning`).
- **OTA-Updates** der Web-Assets (z. B. Capgo), damit JS/CSS-Änderungen ohne
  Store-Review ausgerollt werden können.
- **Store-Assets & Einreichung** (App Store Connect / Play Console).
- Optional: Refresh-Token-Flow statt langer Session (aktuell reicht Re-Login
  nach 30 Tagen Inaktivität).

## CORS

`squora.de` liefert die API same-origin fürs Web aus; die App ruft sie
cross-origin. Bearer-Requests umgehen die CSRF-/Same-Origin-Prüfung serverseitig
(kein Browser-Vektor). Falls `Access-Control-Allow-Origin` für die native
Origin nötig wird (`capacitor://localhost`, `https://localhost`), in der
`cors()`-Konfiguration in `worker/src/index.ts` ergänzen.
