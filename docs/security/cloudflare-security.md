# Cloudflare Security Configuration — Turnen (SQUORA)

Stand: 2026-08-26. Ergänzt `docs/privacy/cloudflare-data-flow.md` um die
sicherheitsspezifische Sicht (statt Datenschutz). Siehe dort für die
vollständige Architektur und Service-für-Service-Dokumentation.

## Secrets

Geprüft: kein API-Key, DB-Passwort, JWT-Secret oder Cloud-Credential ist im
Repository eingecheckt.

| Secret | Wo verwaltet | Status |
|---|---|---|
| `JWT_SECRET` | `wrangler secret put JWT_SECRET` (laut Kommentar in `worker/wrangler.toml`) | ✅ Korrekt — nicht im Repo, `.dev.vars` (lokaler Platzhalter) ist git-ignored, nur `.dev.vars.example` mit Dummy-Wert ist eingecheckt |
| `RESEND_API_KEY` | `wrangler secret put RESEND_API_KEY` | ✅ Korrekt — nicht im Repo; authentifiziert ausschließlich den ausgehenden E-Mail-Versand über Resend |
| Cloudflare API Token (für `wrangler`-CLI/CI) | Nicht im Repo sichtbar — vermutlich lokale Wrangler-Anmeldung/Umgebungsvariable des Bedieners | `VERIFY`: sicherstellen, dass CI (falls eingerichtet) einen dedizierten, minimal berechtigten Token statt eines persönlichen Kontos nutzt |
| D1-Datenbank-ID, Vereinsnummer o.ä. | `wrangler.toml` (Klartext) | Unkritisch — Datenbank-IDs sind keine Secrets im eigentlichen Sinn, aber kein Zugriffsschutz ohne zusätzlichen Auth-Layer nötig, da D1 nur über den Worker mit eigener Authentifizierung erreichbar ist |

**Frontend-Umgebungsvariablen** (`turnen/.env.production`: `VITE_APP_BASE_PATH`,
`VITE_API_URL`) sind grundsätzlich als öffentlich zu behandeln — sie werden
in den Client-Bundle kompiliert und sind für jeden Website-Besucher
einsehbar. Beide enthalten aktuell nur Pfad-Konfiguration, keine Secrets —
das muss bei jeder künftigen Ergänzung einer `VITE_*`-Variable geprüft
werden (Grundsatz: **niemals** ein Secret mit `VITE_`-Präfix versehen).

## Authentifizierung & Autorisierung am Edge

- Es wird **kein** Cloudflare Access verwendet — jegliche Authentifizierung
  läuft ausschließlich über die App-eigene JWT-Prüfung
  (`worker/src/index.ts: requireAuth`). Cloudflare selbst kennt keine
  Nutzeridentität.
- Es wird **kein** Turnstile verwendet — der Login-Endpunkt
  (`POST /api/login`) hat keinen Bot-/Automatisierungsschutz auf
  Cloudflare-Ebene. Kombiniert mit dem Fehlen von Rate Limiting
  (`PRIVACY_SECURITY_GAP_ANALYSIS.md`, SEC-01) ist Credential Stuffing
  aktuell ungebremst möglich.

## Caching-Sicherheit

- Globale Middleware in `worker/src/index.ts` setzt für **jede**
  `/api/*`-Antwort `Cache-Control: no-store` sowie
  `X-Content-Type-Options: nosniff`.
- `cloudflare/web-router.ts` ergänzt zusätzlich `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` und
  `Cross-Origin-Resource-Policy` auf **jede** Antwort (API und statische
  Assets).
- `index.html` wird explizit mit `Cache-Control: no-cache` ausgeliefert
  (SPA-Fallback in `web-router.ts`), damit nach einem Deploy keine veralteten
  Asset-Referenzen hängen bleiben — historisch bereits als Bug behoben
  (Service-Worker-Cache-Poisoning, siehe Git-Historie).
- Was aus dem Code **nicht** verifizierbar ist: ob eine
  dashboard-konfigurierte Cache Rule diese Header überschreibt (`Cache
  Everything` ignoriert Origin-Header). → `VERIFY IN CLOUDFLARE DASHBOARD`.

## Fehlende Sicherheits-Header (Auffälligkeit)

`web-router.ts` setzt keine `Content-Security-Policy` und kein
`Strict-Transport-Security`-Header explizit. Cloudflare setzt HSTS teils
automatisch je nach Zonen-Einstellung (`VERIFY IN CLOUDFLARE DASHBOARD`),
eine CSP ist aktuell nirgends gesetzt. Empfehlung (nicht in dieser Analyse
umgesetzt, siehe Gap-Analyse): CSP ergänzen, die zumindest
`default-src 'self'` durchsetzt, um XSS-Auswirkungen (insbesondere
JWT-Diebstahl aus `localStorage`, siehe SEC-04) zu begrenzen.

## Netzwerkpfad-Sicherheit

- Client → Cloudflare-Edge: TLS (Cloudflare-Standard-Zertifikat für
  `squora.de`), Mindestversion nicht aus dem Repo einstellbar/verifizierbar
  → `VERIFY IN CLOUDFLARE DASHBOARD` (Minimum TLS 1.2, bevorzugt 1.3 gemäß
  Vorgabe).
- `turnen-web` → `turnen-api`: Service Binding, verlässt Cloudflares
  Infrastruktur nicht, kein separates TLS-Handshake nötig (worker-internes
  RPC).
- `turnen-api` → D1: Cloudflare-interne Verbindung, außerhalb der
  Repo-Kontrolle.
- `turnen-api` → Cloudflare Email Service → externer Mail-Provider:
  SMTP/TLS gemäß Cloudflare-Standard bis zum Zielserver; danach keine
  Kontrolle mehr durch die App (siehe `cloudflare-data-flow.md`, Finding
  PRIV-01 zum Inhalt dieser E-Mails).

## Produktionssicherheits-Ablaufkontrolle

Siehe `docs/security/cloudflare-production-checklist.md` und
`scripts/privacy-check.ts` für die automatisierbaren Teile dieser Prüfung.

## Nicht bewertbar ohne Dashboard-Zugriff

Diese Punkte sind für eine vollständige Sicherheitsbewertung relevant, aber
nicht aus dem Repository-Code ableitbar:

- WAF-Regeln (Web Application Firewall) für die Zone `squora.de`
- Bot-Management-Einstellungen
- DDoS-Schutzstufe
- Zonen-weite TLS-Mindestversion
- Cloudflare-Kontoebene: Wer hat Zugriff auf das Cloudflare-Konto (Cloudflare
  Account Members, API-Token-Berechtigungen)?
- Cloudflare-Audit-Log des Kontos selbst (wer hat wann Secrets/Deploys
  geändert)

Diese Punkte sollten Teil einer Cloudflare-Dashboard-Review sein, die dieses
Repository allein nicht leisten kann.
