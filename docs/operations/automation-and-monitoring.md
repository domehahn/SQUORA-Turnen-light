# Automatisierung und App-Level-Monitoring

Stand: 2026-08-28

## Umfang und Abnahmekriterien

Die Betriebsautomatisierung umfasst sechs zusammenhängende Funktionen:

1. **E-Mail-Zustellung und Retry:** Jeder Versand erhält einen datensparsamen Delivery-Datensatz und die Resend-ID. Signierte, idempotent verarbeitete Webhooks aktualisieren `sent`, `delivered`, `delayed`, `failed`, `bounced`, `complained` oder `suppressed`. Normale App-Benachrichtigungen werden verschlüsselt höchstens dreimal versucht; Passwort-Reset und Einmalpasswörter besitzen keine gespeicherte Retry-Nutzlast.
2. **Kalender-Abonnement:** Nutzer*innen können einen 256-Bit-Bearer-Link erzeugen und widerrufen. D1 speichert nur dessen SHA-256-Hash. Der Feed enthält sechs Monate eigene/mitgeleitete Trainings, Absagen/Terminabweichungen und übernommene Vertretungen, aber keine Kinderdaten.
3. **Benachrichtigungseinstellungen:** Sechs fachliche Kategorien steuern nur den zusätzlichen E-Mail-Kanal. In-App-Nachrichten und Security-Mails bleiben immer aktiv. Fehlende Einstellungen bedeuten aus Gründen der Abwärtskompatibilität „E-Mail aktiv“.
4. **Saisonwechsel:** Die Jugendleitung wählt einen Stichtag und erhält reproduzierbare Vorschläge für Kinder außerhalb der Altersgrenze. Die Ausführung verwendet den vorhandenen Move-Endpunkt, sodass Kapazitätsregeln, Freigaben, Benachrichtigungen und Audit-Logs nicht umgangen werden.
5. **Monitoring:** Admins sehen Zustellstatus, Cron-Zustand und pseudonyme App-Fehler der letzten sieben Tage. Empfängeradressen werden nur als SHA-256-Hash erfasst, Inhalte nur für Retry AES-GCM-verschlüsselt. Betriebsdaten werden nach 90 Tagen gelöscht.
6. **Benachrichtigungs-Retention:** Gelesene und ungelesene In-App-Benachrichtigungen werden täglich nach `NOTIFICATION_RETENTION_DAYS` gelöscht; produktiv ist die Frist auf 90 Tage gesetzt. Ein fehlender oder ungültiger Wert deaktiviert ausschließlich dieses Cleanup.

## Resend-Einrichtung

Zusätzlich zum vorhandenen `RESEND_API_KEY` muss `RESEND_WEBHOOK_SECRET` als Worker Secret gesetzt werden. Im Resend-Dashboard wird der HTTPS-Endpunkt

`https://squora.de/turnen-light/api/webhooks/resend`

für mindestens folgende Events registriert: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`.

Der Endpoint prüft den unveränderten Request-Body mit `svix-id`, `svix-timestamp` und `svix-signature`. `svix-id` dient zugleich als Idempotenzschlüssel, weil Resend Webhooks mindestens einmal und nicht zwingend in Reihenfolge ausliefert.

## Datenschutz und Rollback

- Kalenderlinks sind Zugangsdaten. Bei unbeabsichtigter Weitergabe im Profil widerrufen und neu erzeugen.
- Retry-Nutzlasten sind mit dem bestehenden `ENCRYPTION_KEY` verschlüsselt und werden nach 90 Tagen entfernt.
- Migrationen sind vorwärtsgerichtet. Funktionaler Rollback: neue Navigation/Routes zurücknehmen, Cron-Retry deaktivieren und Resend-Webhook deaktivieren. Die Tabellen können zunächst bestehen bleiben, damit kein Diagnoseverlauf verloren geht.
- Vor Produktivsetzung sind Migration, Worker-Secret und Resend-Webhook-Konfiguration gemeinsam auszurollen; sonst ist Versand weiterhin möglich, Zustellstatus bleibt aber bei `sent`.

## Verifikation

- Worker-Typecheck und Frontend-Build
- Worker-/Frontend-Lint
- vollständige Worker-Tests einschließlich Präferenzen, Feed/Widerruf, Saisonvorschlag und idempotenter/out-of-order Webhook-Verarbeitung
- nach Deployment: Resend-Testevent auslösen und im Bereich „Admin – Betrieb“ den Statuswechsel prüfen
