-- Zwei-Faktor-Authentifizierung (TOTP, Finding SEC-02). Secret und Backup-
-- Codes werden verschlüsselt/gehasht abgelegt (siehe worker/src/index.ts):
-- totp_secret per AES-256-GCM (crypto.ts), totp_backup_codes als JSON-Array
-- von PBKDF2-Hashes (wie Passwörter, worker/src/auth.ts).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT;
