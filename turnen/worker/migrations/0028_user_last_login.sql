-- Letzte Anmeldung pro Nutzer, sichtbar für die Jugendleitung im Verein
ALTER TABLE users ADD COLUMN last_login_at TEXT;
