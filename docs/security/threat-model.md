# Threat Model — Turnen (SQUORA)

Leichtgewichtiges STRIDE-orientiertes Modell für die wichtigsten
Angriffsflächen. Ergänzt die konkreten Findings in
`PRODUCTION_READINESS_ANALYSIS.md`.

## Assets

1. Kinderdaten (Name, Geburtsdatum, Gruppe, Anwesenheit) - Minderjährige,
   besonders schutzwürdig auch ohne Art.-9-Bezug.
2. Notfall-/Familien-Kontaktdaten - verschlüsselt (AES-256-GCM).
3. Zugangsdaten (Passwort-Hashes, TOTP-Secrets, Sitzungen).
4. Audit-/Security-Log - Integrität wichtig für Nachvollziehbarkeit.

## Angreifer-Profile

| Profil | Fähigkeiten | Motivation |
|---|---|---|
| Fremder Verein (kompromittierter/böswilliger Trainer-Account) | gültige Session im eigenen Verein | Neugier, Zugriff auf fremde Kinderdaten |
| Anonymer Internet-Angreifer | keine Anmeldedaten | Massenscan, Account-Übernahme, Datendiebstahl |
| Person mit physischem Zugriff auf ein gemeinsam genutztes Gerät | ggf. offene Sitzung | Einsicht in personenbezogene Daten |
| Kompromittierte Session (XSS, Malware, gestohlenes Gerät) | gültiges Session-Cookie | Datenzugriff, Rechteausweitung, MFA-Sabotage |

## Bedrohungen und Gegenmaßnahmen

| Bedrohung (STRIDE) | Konkretes Szenario | Gegenmaßnahme | Status |
|---|---|---|---|
| **S**poofing | Login mit erratenem/geleaktem Passwort | PBKDF2 + Salt, HIBP-Prüfung, Rate Limiting (10/15min pro E-Mail) | ✅ |
| **S**poofing | MFA-Codes erraten | 6-stelliger TOTP, 30s-Fenster, Rate Limiting am Login | ✅ |
| **T**ampering | Manipulierte `familyId`/`childId`/`groupId` in Requests (BOLA/IDOR) | Serverseitige Beziehungs-Prüfung vor jeder Mutation | ✅ |
| **T**ampering | Fail-open bei unbekannter Tenant-Beziehung | Fail-closed + Security-Event-Log (P1-06) | ✅ (dieser Durchgang) |
| **R**epudiation | Admin-Aktion ohne Nachweis | `audit_log` für sicherheitsrelevante Aktionen (s. `production-security-checklist.md`) | ✅ (teilweise, s. Lücken unten) |
| **I**nfo Disclosure | Notfallkontakte an unbeteiligte Trainer*innen | Least-Privilege-Redaktion in `GET /api/children` | ✅ |
| **I**nfo Disclosure | Familien-Kontaktdaten im Klartext in D1 | AES-256-GCM-Verschlüsselung (P1-07) | ✅ (dieser Durchgang) |
| **I**nfo Disclosure | PII in Logs/Fehlermeldungen | `log-redaction.ts`, Security-Events ohne PII-Payload | ✅ (s. Lücken unten) |
| **D**oS | Login-Flooding gegen einen Account | Rate Limiting pro E-Mail (nicht per-IP, s. P2-Empfehlung) | 🟡 teilweise |
| **D**oS | Passwort-Reset-Mail-Flooding | Rate Limiting E-Mail+IP (P1-04) | ✅ (dieser Durchgang) |
| **E**levation of Privilege | Gekaperte Session deaktiviert fremde MFA | Setup/Rotation-Invariante (P1-01) | ✅ (dieser Durchgang) |
| **E**levation of Privilege | Normaler Nutzer setzt `isAdmin=true` | Serverseitige Rollen-Prüfung, kein Self-Escalation-Pfad | ✅ |
| **E**levation of Privilege | Cross-Tenant-Zugriff über gruppenlose/Legacy-Ressourcen | Fail-closed (P1-06), feste `club_id` bei `families` (P0-02) | ✅ |

## Offene/verbleibende Risiken (nicht in diesem Durchgang geschlossen)

- **Kein IP-basiertes Login-Rate-Limiting** (nur pro E-Mail) - ein
  Angreifer könnte theoretisch viele E-Mail-Adressen von einer IP aus
  parallel durchprobieren, ohne je das E-Mail-Limit einer einzelnen
  Adresse zu erreichen. Cloudflare Edge Rate Limiting (Dashboard-Feature)
  wäre die naheliegende Ergänzung, nicht in diesem Durchgang aktiviert
  (Cloudflare-Live-Konfiguration, s. `production-security-checklist.md`).
- **Geteilte Origin** (`squora.de/turnen-light`) - ein XSS in einem
  anderen Projekt auf derselben Zone könnte theoretisch same-origin
  Requests an `/turnen-light/api/*` auslösen (das HttpOnly-Cookie selbst
  bliebe unlesbar). Siehe `operations/origin-migration.md`.
- **Kein strukturiertes Betriebsmonitoring/Alerting** für die in
  `production-security-checklist.md` gelisteten Signale (Login-Failure-
  Spikes, 5xx-Spikes, Cross-Tenant-Denies) - aktuell nur im Audit-Log
  abfragbar, kein aktives Alerting.
- **Physischer Zugriff auf unbeaufsichtigte Geräte**: durch den neuen
  Client-Idle-Lock (5 Minuten) deutlich reduziert, aber ein Zeitfenster
  bleibt (bis zu 5 Minuten Inaktivität + die Zeit bis zum tatsächlichen
  Logout).
