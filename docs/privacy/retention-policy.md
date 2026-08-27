# Retention Policy — Turnen (SQUORA)

**LEGAL/PRIVACY REVIEW REQUIRED**: die konkreten Fristen unten sind
Nutzerentscheidungen (dokumentiert mit Datum), **keine** rechtlich
geprüften Werte. Dieses Dokument beschreibt den technischen Ist-Zustand,
nicht eine rechtliche Freigabe.

## Aktuell gesetzte Fristen

| Datenkategorie | Frist | Mechanismus | Quelle der Frist |
|---|---|---|---|
| Archivierte (ausgetretene) Kinder | 1095 Tage (3 Jahre) | Täglicher Cron (`deleteStaleArchivedChildren`), `ARCHIVED_CHILD_RETENTION_DAYS` | Nutzerentscheidung 27.08.2026 |
| Sitzungen (`sessions`) | sofort nach Ablauf/Widerruf | Täglicher Cron (`cleanupSecurityLogs`) | technischer Automatismus, keine "Frist" im eigentlichen Sinn |
| Login-Versuche (`login_attempts`) | 90 Tage | dito, `SECURITY_LOG_RETENTION_DAYS` | Nutzerentscheidung 27.08.2026 |
| Passwort-Reset-Anfragen (`password_reset_requests`) | 90 Tage | dito | Nutzerentscheidung 27.08.2026 |
| Verbrauchte Passwort-Reset-Tokens (`used_password_reset_tokens`) | 90 Tage | dito | Nutzerentscheidung 27.08.2026 |
| Aktive Kinder/Familien/Anwesenheit | keine automatische Löschung (aktiv genutzte Daten) | — | — |
| Audit-Log | **keine Frist gesetzt** | kein Cleanup-Job | **offen, LEGAL/PRIVACY REVIEW REQUIRED** |

## Löschmechanik bei archivierten Kindern

`deleteStaleArchivedChildren()` (`worker/src/index.ts`): für jedes Kind,
das seit ≥ `ARCHIVED_CHILD_RETENTION_DAYS` Tagen archiviert ist, wird
zuerst `redactChildTraces()` aufgerufen (entfernt Namens-/Kontext-
Referenzen aus `audit_log`/`notifications`), dann `deleteChild()`
(Hard-Delete der `children`-Zeile inkl. Attendance-Verknüpfungen über
Cascade). Ein Audit-Eintrag `child.retention_deleted` wird **vor** der
Löschung geschrieben (mit `actorId: null`, da kein handelnder Nutzer,
keine erfundene "System"-User-ID wegen FK-Constraint).

## Was passiert NICHT automatisch

- Aktive (nicht archivierte) Kinder werden nie automatisch gelöscht.
- Nutzer-/Trainer-Accounts haben keinen Retention-Mechanismus (Löschung
  nur manuell über `DELETE /api/admin/users/:id`).
- `families` hat keinen Retention-/Löschmechanismus (s. `data-inventory.md`,
  bekannte Lücke: kein Hard-Delete-Endpunkt).
- `audit_log` wächst unbegrenzt (bewusst, s.o. - Spannungsverhältnis
  Nachvollziehbarkeit vs. Speicherbegrenzung, rechtlich zu klären).

## Production-Gate

`ARCHIVED_CHILD_RETENTION_DAYS` und `SECURITY_LOG_RETENTION_DAYS` müssen
in `turnen/worker/wrangler.toml` gesetzt sein (nicht auskommentiert), sonst
läuft **keine** automatische Löschung (sicherer Default: kein
versehentliches Massenlöschen statt einer erfundenen Frist). Automatisiert
geprüft in `scripts/production-readiness-check.ts`
(`retention-variable`/`security-log-retention-variable`).
