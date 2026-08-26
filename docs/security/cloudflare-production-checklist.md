# Cloudflare Production Deployment Checklist — Turnen (SQUORA)

Diese Checkliste soll vor jedem produktiven Deploy geprüft werden. Punkte
mit ✅ sind automatisiert prüfbar über `scripts/privacy-check.ts` (siehe
dort für den aktuellen Umsetzungsstand — das Skript prüft aktuell einen
Teil der Punkte statisch/per Wrangler-CLI, nicht alle sind heute technisch
automatisierbar).

| # | Prüfpunkt | Automatisiert? | Aktueller Stand (2026-08-26) |
|---|---|---|---|
| 1 | Produktive D1-Datenbank hat `jurisdiction = "eu"` | ✅ (`scripts/privacy-check.ts`, ruft `wrangler d1 info`) | ❌ **FAIL** — `jurisdiction: null`, siehe CF-01 in `docs/privacy/cloudflare-data-flow.md`. Deploy sollte laut Vorgabe blockiert werden, bis dies behoben oder bewusst als Risiko akzeptiert und dokumentiert ist. |
| 2 | Alle R2-Buckets mit personenbezogenen/Gesundheitsdaten haben `jurisdiction = "eu"` | ✅ (Skript listet R2-Buckets) | N/A — keine R2-Buckets im Projekt (siehe `cloudflare-data-flow.md`) |
| 3 | Kein R2-Bucket mit sensiblen Daten ist öffentlich erreichbar | ✅ | N/A — keine R2-Buckets |
| 4 | Keine Secrets im Frontend-Build (`VITE_*`-Variablen, kompiliertes Bundle) | ✅ (Skript durchsucht `dist/` nach bekannten Secret-Mustern) | ✅ Aktuell keine Secrets in `.env.production` gefunden |
| 5 | Health-Endpunkte (`/api/children`, o.ä.) sind nicht cacheable | ✅ (Skript prüft `Cache-Control`-Header im Worker-Code statisch) | ✅ Globales `Cache-Control: no-store` für `/api/*` in `worker/src/index.ts` bestätigt. **Nicht geprüft:** dashboard-seitige Cache Rules (siehe CF-03, `VERIFY IN CLOUDFLARE DASHBOARD`) |
| 6 | Keine personenbezogenen Daten in statischen Build-Artefakten | ✅ (Skript durchsucht `dist/` nach Namen-/E-Mail-Mustern aus Testdaten, sofern vorhanden) | ✅ Manuell geprüft — keine Fixtures/PII im Build |
| 7 | Debug-Logging ist in Produktion deaktiviert | Teilweise ✅ | ⚠️ Kein explizites Debug-Flag im Code gefunden (kein `DEBUG`-Var, kein `console.log` außer den beiden dokumentierten `console.error`-Aufrufen) — grundsätzlich unauffällig, aber auch kein strukturiertes Logging-Level-System vorhanden, das sich "deaktivieren" ließe |
| 8 | Keine Synthetic-/Development-Auth-Bypässe in Produktion aktiv | Teilweise ✅ (Skript prüft auf bekannte Bypass-Muster im Code) | ✅ Kein Auth-Bypass-Code gefunden (`requireAuth` ist unconditional, kein `if (env === "dev") skip` o.ä.) |
| 9 | Keine Secrets/Klartext-Passwörter in `wrangler.toml` | ✅ | ✅ `JWT_SECRET` korrekt als `wrangler secret` referenziert, nicht in `[vars]` |
| 10 | KV-Namespaces enthalten keine Kind-/Gesundheits-/Consent-Daten | ✅ | N/A — keine KV-Namespaces im Projekt |
| 11 | Durable Objects (falls vorhanden) nutzen EU-Jurisdiktion, IDs enthalten keine PII | ✅ | N/A — keine Durable Objects im Projekt |
| 12 | Rate Limiting für `/api/login` aktiv | ❌ Nicht automatisiert prüfbar (Cloudflare Rate Limiting Rules sind Dashboard-Konfiguration) | ❌ **FAIL** — weder im Code noch als bekannte Dashboard-Regel vorhanden (siehe SEC-01) |
| 13 | MFA für `is_admin`/`jugendleiter` erzwungen | ❌ Nicht automatisiert prüfbar (Feature existiert noch nicht) | ❌ **FAIL** — keine MFA implementiert (siehe SEC-02) |

## Wie das Skript einbinden

`scripts/privacy-check.ts` ist als eigenständiges Node/TSX-Skript
geschrieben (nutzt die vorhandene `wrangler`-CLI-Installation im
`worker/`-Verzeichnis). Es ist **nicht** automatisch in den bestehenden
Deploy-Workflow (`npm run web:deploy` / `wrangler deploy`) eingehängt, da im
Repo aktuell kein CI/CD-Pipeline-Skript existiert, das das übernehmen
könnte — das müsste ergänzt werden (siehe `PRIVACY_SECURITY_GAP_ANALYSIS.md`,
SEC-08 zu fehlender CI generell).

Manuelle Ausführung vor einem Produktions-Deploy:

```bash
cd turnen/worker
npx tsx ../../scripts/privacy-check.ts
```

Das Skript beendet sich mit Exit-Code `1`, wenn ein als blockierend
markierter Punkt fehlschlägt (aktuell: Punkt 1, D1-Jurisdiktion) — geeignet,
um es später in ein CI-Gate einzuhängen.

## Punkte, die dieses Repository/Skript strukturell nicht prüfen kann

- Cloudflare-Dashboard-Konfiguration (Cache Rules, WAF, Bot Management,
  Access-Policies, Logpush) — erfordert Cloudflare-API-Zugriff mit
  entsprechenden Scopes, aktuell nicht Teil des Skripts.
- Vertragliche/organisatorische Punkte (AVV, Rechtsgrundlage, Consent-Text)
  — grundsätzlich nicht automatisierbar, siehe `LEGAL/PRIVACY REVIEW
  REQUIRED`-Markierungen in den übrigen Dokumenten.
