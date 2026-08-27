# Data Inventory — Turnen (SQUORA)

Technische Bestandsaufnahme der verarbeiteten Datenkategorien. Kein
Ersatz für ein rechtlich geprüftes Verzeichnis von
Verarbeitungstätigkeiten (VVT, Art. 30 DSGVO) - **LEGAL/PRIVACY REVIEW
REQUIRED** für die rechtliche Einordnung (Rechtsgrundlage,
Aufbewahrungsfrist-Freigabe, Betroffenenrechte-Prozesse).

## Datenkategorien

| Kategorie | Tabelle(n) | Felder | Betroffene | Verschlüsselung | Löschbar über |
|---|---|---|---|---|---|
| Kind (Basis) | `children` | Vorname, Nachname, Geburtsdatum, Status | Minderjährige | Nein | `DELETE /api/children/:id`, Retention-Job |
| Notfallkontakt | `children` | `emergency_contact_name`, `emergency_contact_phone` | Erziehungsberechtigte/Kontaktpersonen | AES-256-GCM | mit dem Kind |
| Familie/Geschwister | `families` | Name, `contact_name`, `contact_phone`, `contact_email` | Erziehungsberechtigte | AES-256-GCM (seit diesem Durchgang) | `DELETE`-Route existiert nicht - Familie kann umbenannt/Kontakt entfernt werden, kein Hard-Delete-Endpunkt (Lücke, s. unten) |
| Anwesenheit | `attendance_sessions`, `attendance_entries` | Kind-ID, Datum, anwesend | Minderjährige | Nein | mit dem Kind (`redactChildTraces`) |
| Nutzer/Trainer | `users` | E-Mail, Name, Rolle | Erwachsene (Trainer*innen, Admin) | Passwort: PBKDF2-Hash; TOTP-Secret: AES-256-GCM | `DELETE /api/admin/users/:id` |
| Session | `sessions` | User-Agent, IP, Zeitstempel | Erwachsene (Nutzer*innen) | Nein | automatischer Cleanup (90 Tage nach Ablauf/Widerruf) |
| Login-Versuche | `login_attempts` | E-Mail, Erfolg, Zeitstempel | Erwachsene | Nein | automatischer Cleanup (90 Tage) |
| Passwort-Reset-Anfragen | `password_reset_requests` | E-Mail, IP, Zeitstempel | Erwachsene | Nein | automatischer Cleanup (90 Tage) |
| Audit-Log | `audit_log` | Actor, Aktion, Ziel-Label (bewusst ohne PII-Payload) | Erwachsene (Actor) | Nein | kein Cleanup (bewusst - Nachvollziehbarkeit), s. Lücke unten |

## Explizit NICHT verarbeitet

Gesundheitsdaten, Diagnosen, Medikation, sonstige Art.-9-DSGVO-Daten -
verifiziert durch Grep über `worker/src` und `worker/migrations`
(`scripts/production-readiness-check.ts`, Check `no-health-or-notes-
fields`). `children.notes`/`health_notes` wurden in früheren Durchgängen
aus dem Schema entfernt (Migrationen 0033/0034).

## Freitextfelder — Risiko, dass Gesundheitsdaten eingetragen werden

Geprüft: `emergency_contact_name`/`_phone` (Textfeld, aber fachlich klar
als Kontaktdaten benannt/gelabelt im UI), `families.contact_*` (dito).
**Kein** verbleibendes generisches "Notizen"-Freitextfeld im Schema, in
das jemand versehentlich Gesundheitsinformationen eintragen könnte. Damit
entfällt aktuell der Bedarf für einen UI-Warnhinweis ("Keine
Gesundheitsdaten eintragen") - es gibt keine Stelle mehr, an der das
naheliegend wäre.

## Bekannte Lücken (nicht in diesem Durchgang geschlossen)

- **Kein Hard-Delete für `families`**: eine Familie lässt sich umbenennen
  und ihre Kontaktfelder leeren, aber es gibt keinen
  `DELETE /api/families/:id`-Endpunkt. Für ein Löschbegehren (Art. 17
  DSGVO) bezüglich einer Familie ist aktuell nur der Umweg über "alle
  Felder leeren" möglich, nicht ein echter Datensatz-Löschvorgang. Als
  **P2-Finding** dokumentiert.
- **`audit_log` hat keinen Retention-Mechanismus**: wächst unbegrenzt.
  Bewusst so belassen (Nachvollziehbarkeit/Rechenschaftspflicht, Art. 5(2)
  DSGVO steht hier teilweise im Spannungsverhältnis zu Art. 5(1)(e)
  Speicherbegrenzung) - **LEGAL/PRIVACY REVIEW REQUIRED**, welche Frist
  für Audit-Logs angemessen ist, bevor ein Cleanup-Job dafür ergänzt wird.
