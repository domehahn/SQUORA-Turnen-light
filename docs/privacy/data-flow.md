# Data Flow (Anwendungsebene) — Turnen (SQUORA)

Ergänzt `docs/privacy/cloudflare-data-flow.md` (Infrastruktur-Fokus: wo
Cloudflare Daten physisch verarbeitet) um den Anwendungsfluss.

## Eingabe → Speicherung

```
Browser (Formular)
    │  HTTPS, SameSite=Strict-Cookie, CSRF-Origin-Check
    ▼
turnen-web (Worker, Assets + SPA)
    │  Service Binding (Cloudflare-intern, kein Netzwerk-Hop)
    ▼
turnen-api (Worker)
    │  Validierung (worker/src/validation.ts)
    │  Autorisierung (requireAuth/requireAdmin/isChildWritable/...)
    │  Verschlüsselung sensibler Felder (crypto.ts, AES-256-GCM)
    ▼
D1 "turnen-eu" (jurisdiction=eu)
```

## Ausgabe → Anzeige

```
D1 "turnen-eu"
    │  Query (parametrisiert, worker/src/db.ts)
    ▼
turnen-api
    │  Entschlüsselung (crypto.ts) - nur für Felder, die verschlüsselt
    │  gespeichert wurden (Notfallkontakte, Familien-Kontaktdaten,
    │  TOTP-Secret)
    │  Least-Privilege-Redaktion (Notfallkontakte nur bei Berechtigung)
    ▼
turnen-web
    │  Cache-Control: no-store auf allen /api/*-Antworten
    │  Kein PWA-Runtime-Caching für /api/* (workbox.runtimeCaching: [])
    ▼
Browser (React-State, nicht persistiert außer Theme/Formular-Komfortfelder
in localStorage - keine personenbezogenen Kinder-/Familien-Daten)
```

## E-Mail-Versand

Passwort-Reset-Links und Benachrichtigungen laufen über Cloudflare Email
Sending (`worker/src/notifications.ts`). Der Reset-Token selbst ist ein
signierter JWT, kein Klartext-Passwort. Kein Versand von
Kinder-/Notfallkontaktdaten per E-Mail identifiziert - Benachrichtigungen
enthalten Gruppen-/Kindernamen als Kontext (z.B. "Vertretung für Gruppe X
gesucht"), aber keine Notfallkontakte/Gesundheitsdaten (die es ohnehin
nicht gibt).

## Backup/Recovery

Cloudflare D1 Time Travel (automatisch, 30 Tage bei Paid Plan) - liegt
innerhalb derselben `eu`-Jurisdiktion wie die Live-Datenbank. Siehe
`docs/operations/disaster-recovery.md`.

## Kein Datenexport an Dritte außerhalb von Cloudflare identifiziert

Keine Drittanbieter-SDKs (kein Sentry/Firebase/Analytics/Crashlytics) im
Repository - bestätigt in `PRIVACY_SECURITY_GAP_ANALYSIS.md`, INFO-01,
unverändert in diesem Durchgang (keine neue Abhängigkeit mit
Netzwerkzugriff auf Dritt-Server eingeführt: `@cyclonedx/cyclonedx-npm`
läuft nur in CI zur SBOM-Erzeugung, keine Laufzeit-Abhängigkeit der App
selbst).
