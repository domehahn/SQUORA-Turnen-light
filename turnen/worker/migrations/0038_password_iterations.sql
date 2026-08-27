-- Passwort-Hashing-Härtung (Nutzeranfrage nach der Production-Readiness-
-- Prüfung: OWASP empfiehlt für PBKDF2-HMAC-SHA256 aktuell 600.000
-- Iterationen statt der bisherigen 100.000). Iterationszahl wird jetzt pro
-- Nutzer gespeichert statt global hartkodiert - Bestandshashes bleiben mit
-- ihrer ursprünglichen Zahl gültig (DEFAULT 100000 für bestehende Zeilen),
-- neue Hashes (Registrierung, Passwortänderung/-Reset) verwenden die neue,
-- höhere Zahl. Transparentes Rehashing beim nächsten erfolgreichen Login
-- hebt bestehende Accounts schrittweise auf die neue Stufe, ohne dass
-- irgendjemand sein Passwort erneut eingeben oder zurücksetzen muss.
ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 100000;
