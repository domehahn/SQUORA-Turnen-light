# Session Management — Turnen (SQUORA)

Orientiert an OWASP Session Management Cheat Sheet.

## Modell

- **HttpOnly-Cookie** (`turnen_session`), `Secure`, `SameSite=Strict`,
  `Path=/`, kein `Domain=`-Attribut (Host-only). Trägt nur `{sub, sid,
  typ: "session"}` als JWT-Payload - Gültigkeit/Widerruf/Timeouts leben
  serverseitig in der `sessions`-Tabelle, nicht im Token selbst.
- Kein `__Host-`-Präfix aktuell (setzt eine eigene Origin voraus - die App
  läuft noch unter einem Pfad einer geteilten Zone, s.
  `operations/origin-migration.md`).
- **Idle-Timeout: 5 Minuten**, **Absolute Timeout: 8 Stunden** - beide
  serverseitig in `requireAuth` geprüft (`worker/src/index.ts`), nicht nur
  clientseitig.

## Request-Reihenfolge in `requireAuth`

1. Cookie vorhanden? Sonst 401.
2. JWT-Signatur gültig? Sonst 401.
3. Sitzung existiert, nicht widerrufen, `user_id` passt zum Token? Sonst
   401 + Cookie löschen.
4. Absolute Timeout überschritten? Sonst 401 + Sitzung widerrufen.
5. Idle-Timeout überschritten (`now - last_activity_at > 5min`)? Sonst 401
   + Sitzung widerrufen.
6. Nutzer existiert noch? Sonst 401.
7. `last_activity_at` aktualisieren - **außer bei passiven Requests** (s.
   unten) und throttled auf max. alle 30s.
8. `must_change_password`-Sperre (Positivliste an Ausnahmen).
9. MFA-Pflicht-Sperre für `is_admin` (Positivliste an Ausnahmen).

Passwort-Wechsel-Sperre kommt bewusst vor der MFA-Sperre: ein von jemand
anderem vergebenes Passwort sollte nicht erst zur MFA-Einrichtung
verwendet werden, bevor es überhaupt ersetzt wurde.

## Aktivität: aktiv vs. passiv

```
ACTIVE USER REQUEST          PASSIVE / BACKGROUND REQUEST
────────────────────         ─────────────────────────────
fast jeder /api/*-Call   →   GET /api/notifications (Polling,
aktualisiert                 60s-Intervall, NotificationBell.tsx)
last_activity_at              → aktualisiert last_activity_at NICHT
```

`IDLE_EXEMPT_GET_PATHS` (`worker/src/index.ts`) ist eine explizite
Positivliste passiver Pfade - aktuell nur `GET /api/notifications`. Neue
Hintergrund-Requests (Health-Checks, Prefetch, automatische
Synchronisation) müssen hier bewusst ergänzt werden, sonst zählen sie
standardmäßig als Aktivität (sicherer Default).

## Client-Idle-Lock (UX-/Privacy-Ebene, nicht Security Authority)

`IdleLockOverlay.tsx` (nur innerhalb `AppLayout`, also nur wenn
authentifiziert):

```
0:00  Nutzer*in aktiv (pointerdown/keydown/touchstart)
4:00  Warnbanner: "Sitzung endet wegen Inaktivität in 60 Sekunden."
5:00  UI-Sperre (Vollbild-Overlay) + signOut() (widerruft die Sitzung
      serverseitig, räumt lokalen Auth-State auf)
```

Zählt **nicht** als Aktivität: Timer, Polling, Fetch-Antworten,
React-Rendering, reine `visibilitychange`-Events. Der Server bleibt die
alleinige Security Authority - dieses Overlay verhindert nur, dass
personenbezogene Daten auf einem unbeaufsichtigten Bildschirm sichtbar
bleiben, auch bevor der Server-Timeout technisch greift.

## Widerruf (Revocation)

| Ereignis | Betroffene Sitzungen | Route |
|---|---|---|
| Logout | aktuelle Sitzung | `POST /api/logout` |
| "Alle anderen Geräte abmelden" | alle außer aktueller | `POST /api/me/sessions/revoke-all` |
| Eigene Passwortänderung | alle außer aktueller | `PUT /api/me/password` |
| Admin-Passwort-Reset | **alle** (auch aktuelle Ziel-Sitzung) | `PUT /api/admin/users/:id/password` (s. P1-02) |
| Passwort-Reset per E-Mail | **alle** (kein "aktuell", unauthentifizierter Endpunkt) | `POST /api/password-reset/confirm` |
| MFA deaktivieren | alle außer aktueller | `POST /api/me/mfa/disable` |
| MFA-Rotation (nicht Initial-Setup) | alle außer aktueller | `POST /api/me/mfa/confirm` |

## Speicherbegrenzung

Täglicher Cron-Job (`worker/src/index.ts`, `scheduled()`) löscht:
abgelaufene/widerrufene Sitzungen sofort, `login_attempts` und
`password_reset_requests` nach `SECURITY_LOG_RETENTION_DAYS` (90 Tage,
Nutzerentscheidung), `used_password_reset_tokens` nach derselben Frist.
Deaktiviert, solange `SECURITY_LOG_RETENTION_DAYS` nicht gesetzt ist
(sicherer Default: kein automatisches Löschen statt versehentlich zu
aggressivem Löschen).
