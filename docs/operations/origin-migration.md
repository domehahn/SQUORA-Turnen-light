# Origin-Migration: `squora.de/turnen-light` → `turnen.squora.de`

**Status: nicht durchgeführt, offenes P1-Finding.** Dieses Dokument
bereitet den Wechsel vor, ändert aber keine live DNS-/Cloudflare-
Konfiguration (kritische Sicherheitsregel: keine unautorisierte
Produktions-Infrastruktur-Änderung).

## Warum

Die App teilt sich aktuell die Browser-Origin `https://squora.de` mit
anderen, unabhängigen Projekten auf derselben Cloudflare-Zone (z.B.
`tournament-manager`). Ein XSS in einem dieser anderen Projekte könnte
theoretisch same-origin Requests an `/turnen-light/api/*` auslösen (das
HttpOnly-Cookie selbst bliebe für JavaScript unlesbar, aber der Browser
würde es bei einem same-origin `fetch()` automatisch mitschicken). Eine
eigene Subdomain (`turnen.squora.de`) eliminiert diese geteilte
Angriffsfläche vollständig.

## Vorbereitungsschritte (Code, bereits möglich ohne Live-Änderung)

Aktuell **nicht** umgesetzt, hier als Plan dokumentiert:

1. **DNS**: `turnen.squora.de` als CNAME/A-Eintrag auf Cloudflare
   anlegen (falls die Zone bereits bei Cloudflare liegt, reicht ein
   DNS-Eintrag - kein Wechsel des Registrars nötig, STRATO bleibt
   Registrar für `squora.de` selbst).
2. **Worker Route**: `turnen/wrangler.toml` -
   `[[routes]]` von `squora.de/turnen-light*` auf
   `turnen.squora.de/*` ändern.
3. **`FRONTEND_URL`**: `turnen/worker/wrangler.toml` -
   `FRONTEND_URL = "https://turnen.squora.de"` (aktuell
   `"https://squora.de/turnen-light"`). Wird für CORS-Origin-Prüfung und
   Passwort-Reset-Links verwendet.
4. **Cookie**: `SESSION_COOKIE_NAME` kann auf `__Host-turnen_session`
   umbenannt werden (`worker/src/index.ts`) - `__Host-`-Cookies verlangen
   `Secure`, kein `Domain=`-Attribut, `Path=/` (alle bereits erfüllt).
   Lokale Entwicklung (`localhost`) unterstützt `__Host-`-Cookies nicht
   zuverlässig in allen Browsern - für `isLocalRequest()` weiterhin den
   bisherigen Namen verwenden (z.B. per Bedingung).
5. **CORS**: `isSameOriginRequest()`/die CORS-`origin`-Funktion in
   `worker/src/index.ts` prüfen bereits gegen `FRONTEND_URL` - keine
   Code-Änderung nötig außer der Konfigurationswert selbst.
6. **CSP**: `frame-ancestors 'none'` und die übrigen Direktiven in
   `cloudflare/web-router.ts` sind bereits Origin-unabhängig formuliert -
   keine Änderung nötig.
7. **Redirect alte URL → neue URL**: eine Cloudflare Redirect Rule
   (Dashboard oder als Worker-Route) für `squora.de/turnen-light/*` →
   `https://turnen.squora.de/$1` (301, dauerhaft) - vermeidet kaputte
   Bookmarks/PWA-Installationen.
8. **PWA**: `manifest.webmanifest` (`start_url`) ist bereits relativ
   (`"."`), funktioniert unter der neuen Origin ohne Änderung. Bereits
   installierte PWA-Icons auf Nutzergeräten zeigen weiterhin auf die alte
   URL, bis die Person die App neu installiert - kein technischer
   Blocker, aber UX-Hinweis wert.

## Smoke-Tests nach der Umstellung

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://turnen.squora.de/                     # 200
curl -s -o /dev/null -w "%{http_code}\n" https://squora.de/turnen-light/               # 301 → neue URL
curl -sD - -o /dev/null -X POST https://turnen.squora.de/api/login \
  -H "Content-Type: application/json" -d '{"email":"x","password":"x"}'                # 401, Set-Cookie mit __Host--Namen falls umgesetzt
```

Danach: Login, MFA-Login, Passwort-Reset-Mail-Link (zeigt der Link auf die
neue Domain?), PWA-Installation manuell prüfen.

## Rollback

Route-Änderung in `wrangler.toml` zurücksetzen + redeploy - kein
Datenverlust-Risiko (betrifft nur Routing, nicht D1). Die Redirect-Rule
(alte → neue URL) sollte bestehen bleiben oder umgekehrt werden, je
nachdem in welche Richtung zurückgerollt wird.

## Bis zur Umsetzung

Dieses Finding bleibt ein **offenes P1 / manuelles Gate** für eine
strenge Production-Bewertung - technisch nicht blockierend für den
Betrieb (die App funktioniert unter der geteilten Origin), aber ein
verbleibendes Defense-in-Depth-Risiko.
