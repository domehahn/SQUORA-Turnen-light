-- Erzwungener Passwortwechsel beim ersten Login (Nutzeranfrage 2026-08-27):
-- wenn eine andere Person (Admin, oder das Bootstrap-Skript
-- scripts/create-admin.mjs) ein initiales Passwort für einen Account
-- vergibt, kennt diese Person das Passwort - es muss beim nächsten Login
-- durch ein nur der betroffenen Person bekanntes ersetzt werden, bevor der
-- Account normal nutzbar ist.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
