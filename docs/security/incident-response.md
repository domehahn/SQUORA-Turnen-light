# Incident Response — Turnen (SQUORA)

Playbook für Security-Vorfälle. Ergänzt `docs/privacy/privacy-incident-response.md`,
falls dieses Dokument aus einem früheren Durchgang existiert - falls
nicht, ist dieses Dokument hier die primäre Quelle.

## Rollen

Kleines Projekt, eine Person (`develop.illuminati@gmail.com`, Platform-
Admin) verantwortet aktuell Betrieb und Reaktion. Bei Wachstum: klare
Zuweisung von Incident Commander / technischer Umsetzung / Kommunikation
mit dem Verein empfohlen (aktuell **nicht formal getrennt** - dokumentiert
als offene organisatorische Aufgabe).

## Erkennungssignale

| Signal | Wo sichtbar | Bedeutet möglicherweise |
|---|---|---|
| Ungewöhnlich viele `login_attempts` mit `success=0` für eine E-Mail | D1 (`login_attempts`-Tabelle) | Brute-Force-Versuch (wird bereits durch Rate Limiting gebremst) |
| Viele `password_reset_requests` für eine Adresse/IP | D1 (`password_reset_requests`) | Reset-Mail-Flooding (bereits rate-limitiert) |
| `security.unknown_tenant_relation_denied` / `security.dangling_group_reference_denied` im `audit_log` | D1 (`audit_log`) | Manipulationsversuch gegen die Tenant-Grenze |
| `admin.user_password_reset` / `mfa.disabled` / `mfa.rotated` ohne erwarteten Anlass | `audit_log` | Möglicher Kompromittierungsfall oder Recovery-Vorgang |
| Cloudflare Worker 5xx-Spike | Cloudflare Dashboard (Workers Analytics) | Fehlerhafte Deployment/Angriff/D1-Problem |

**Kein aktives Alerting eingerichtet** in diesem Durchgang - diese Signale
sind aktuell nur per manueller D1-Abfrage einsehbar. Siehe
`production-security-checklist.md` für empfohlene Cloudflare-Alerts
(manuelles Gate).

## Sofortmaßnahmen bei Verdacht auf kompromittierten Account

1. Admin-Passwort-Reset für den betroffenen Account (`PUT
   /api/admin/users/:id/password`) - widerruft seit diesem Durchgang
   **alle** Sitzungen der Zielperson automatisch (P1-02).
2. Bei Verdacht auf kompromittierten zweiten Faktor: MFA über
   `/api/me/mfa/disable` (mit korrektem Passwort) zurücksetzen lassen,
   danach Neueinrichtung erzwingen (für `is_admin` ohnehin verpflichtend).
3. `audit_log` für den Zeitraum um den Vorfall filtern (`actor_id` /
   `club_id`), um das Ausmaß zu verstehen.
4. Bei Verdacht auf eine ausgenutzte Schwachstelle (nicht nur ein
   einzelner kompromittierter Account): betroffene Route identifizieren,
   Fix vorbereiten, **vor** dem Deploy lokal testen (s.
   `operations/deployment.md`).

## Datenpanne (Art. 33/34 DSGVO)

Dieses Dokument ersetzt **keine** Rechtsberatung. Bei einem Vorfall, der
personenbezogene Daten (insbesondere von Minderjährigen) betrifft haben
könnte:

1. Umfang technisch eingrenzen (welche Tabellen/Zeilen/Personen betroffen
   sein könnten - `audit_log` und D1-Zeitstempel als Ausgangspunkt).
2. **LEGAL/PRIVACY REVIEW REQUIRED**: Meldepflicht innerhalb 72h ggü.
   Aufsichtsbehörde prüfen (Art. 33), Benachrichtigungspflicht ggü.
   betroffenen Personen bei hohem Risiko (Art. 34) - diese Bewertung kann
   nicht durch dieses Dokument oder automatisiert getroffen werden.
3. Vorfall dokumentieren (Zeitpunkt, Umfang, Ursache, Maßnahmen) für eine
   spätere Meldung/Nachweispflicht.

## Rollback bei fehlerhaftem Deploy

Siehe `operations/rollback.md` für die konkreten Wrangler-Befehle
(`wrangler rollback`, `wrangler versions list`).

## Nach dem Vorfall

- Root Cause dokumentieren (analog zum Muster in
  `PRIVACY_SECURITY_GAP_ANALYSIS.md`/`PRODUCTION_READINESS_ANALYSIS.md` -
  Finding, Exploit-Szenario, Remediation, Test).
- Regressionstest ergänzen, der den konkreten Vorfall abdeckt (Muster wie
  bei den P0/P1-Findings dieses Durchgangs).
