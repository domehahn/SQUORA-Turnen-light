# DAST-Ergebnisse (OWASP ZAP Baseline)

Status: durchgeführt gegen **lokale** `wrangler dev`-Instanzen (nie gegen
Produktion), Ergebnisse hier archiviert, damit sie nicht nur in
Terminal-Scrollback existieren. Ersetzt keinen externen menschlichen
Pentest (s. `docs/security/pentest-scope.md`) - insbesondere keine
authentifizierten BOLA/IDOR-Prüfungen, die stattdessen über die
Integrationstests in `worker/test/` abgedeckt sind.

Durchgeführt: zweiter Production-Readiness-Härtungsdurchgang, 2026-08-27.

## Setup

- `turnen/worker`: `npx wrangler dev --port 8788` (lokale D1 mit allen
  Migrationen bis `0045_login_attempts_ip_rate_limit.sql` angewendet über
  `wrangler d1 migrations apply DB --local`).
- `turnen`: `npm run build` (frisches `dist/`), dann
  `npx wrangler dev --port 8787` (Service Binding zu `turnen-api`
  verbunden, `[connected]` bestätigt).
- Scanner: `ghcr.io/zaproxy/zaproxy:stable`, `zap-baseline.py` (passiver
  Spider + passive Scan-Regeln, kein aktiver/destruktiver Scan).
- Zwei Läufe: gegen den Web-Worker (`http://host.docker.internal:8787/turnen-light/`,
  die tatsächlich ausgelieferte SPA inkl. aller Security-Header) und
  gegen den rohen API-Worker (`http://host.docker.internal:8788/`, zur
  Kontrolle - in Produktion ohnehin nicht direkt erreichbar, s. u.).

## Ergebnis: Web-Worker (SPA + Routing)

**0 FAIL, 0 offene WARN (nach einer Korrektur), 63 PASS.**

Ursprünglich 5 WARN, eine davon zu einem echten, sofort behobenen Fix
geführt:

1. **Cross-Origin-Embedder-Policy Header Missing [90004]** - FEHLENDER
   Header, echter Fix: `Cross-Origin-Embedder-Policy: require-corp`
   ergänzt (`turnen/cloudflare/web-router.ts`). Alle geladenen Ressourcen
   sind bereits same-origin (CSP `default-src 'self'`, keine externen
   Fonts/CDNs), Verifikation nach der Änderung: App lädt weiterhin normal
   (`/`, JS-Bundle, Manifest, Icons, `theme-init.js` - alle 200), erneuter
   ZAP-Lauf zeigt die zugehörige Regel [90004] jetzt als PASS.

Verbleibende 4 WARN, alle geprüft und bewusst nicht verändert:

2. **Information Disclosure - Suspicious Comments [10027]** - false
   positive. Fundstelle: `assets/index-*.js` enthält 44x den literalen
   String "password" - erwartet für eine App mit Login-/Passwort-Ändern-
   Formularen (Labels, `autoComplete="new-password"`, Feldnamen). Kein
   Kommentar, kein Secret, keine echte Information Disclosure.
3. **Non-Storable Content [10049]** - kein Sicherheitsproblem, im
   Gegenteil: betrifft `index.html`/`/`/`/turnen-light/`, die bewusst
   `Cache-Control: no-cache` bzw. keine langfristige Cachebarkeit
   bekommen (s. Kommentar in `web-router.ts` zum Deploy-Rollout-Problem).
   ZAP meldet das rein informativ als "könnte performanter cachebar
   sein" - hier bewusst in Kauf genommen.
4. **CSP: style-src unsafe-inline [10055]** - bereits bekannter,
   dokumentierter Kompromiss (s. Kommentar über `CONTENT_SECURITY_POLICY`
   in `web-router.ts`): mehrere Komponenten setzen echte Laufzeitwerte
   per `style={{...}}`, CSS-Injection ist ein deutlich kleineres Risiko
   als Script-Injection. `script-src` hat KEIN `unsafe-inline`.
5. **Modern Web Application [10109]** - rein informativ (ZAP stellt nur
   fest, dass es eine SPA ist), keine Handlungsempfehlung.

## Ergebnis: roher API-Worker (Kontrolle)

**0 FAIL, 1 WARN, 66 PASS.**

- **Storable and Cacheable Content [10049]** x3, alle auf 404-Antworten
  für Pfade außerhalb von `/api/*` (`/`, `/robots.txt`, `/sitemap.xml`).
  Das globale `Cache-Control: no-store` in `worker/src/index.ts` ist
  bewusst auf `/api/*` gescoped. In Produktion ist dieser Pfad ohnehin
  nicht direkt erreichbar: `turnen-api` hat keine eigene `[[routes]]`-
  Definition, `workers_dev = false`, `preview_urls = false` - der Worker
  ist ausschließlich über die Service-Binding-Weiterleitung aus
  `turnen-web` erreichbar, die JEDE Anfrage vorher auf `/api`/`/api/*`
  filtert (s. `cloudflare/web-router.ts`). Kein Code-Fix nötig - reines
  Artefakt des isolierten Test-Setups, keine reale Angriffsfläche.

## Ausdrücklich NICHT abgedeckt durch diesen Scan

- Authentifizierte BOLA/IDOR-Prüfungen (Login-Flow, Cross-Tenant-Zugriff,
  manipulierte IDs) - dafür existieren die gezielten Integrationstests in
  `worker/test/` (aktuell 102 Tests, u.a. `authorization.test.ts`,
  `tenant-isolation.test.ts`, `mfa.test.ts`, `csrf.test.ts`).
- Business-Logic-Missbrauch, Race Conditions, kreative Angriffsketten -
  s. `docs/security/pentest-scope.md` für den externen menschlichen
  Pentest, der das abdecken soll.
- Aktive/destruktive Scan-Modi (SQL-Injection-Fuzzing, Brute-Force) -
  bewusst nur der passive Baseline-Scan, nie gegen Produktion.
