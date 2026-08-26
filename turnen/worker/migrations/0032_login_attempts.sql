-- Login-Versuche (erfolgreich und fehlgeschlagen) für Rate Limiting/Brute-
-- Force-Schutz (siehe PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding SEC-01) und
-- als Audit-Trail für LOGIN/FAILED_LOGIN-Ereignisse (Finding SEC-10) - dafür
-- eigene Tabelle statt audit_log, da audit_log einen gültigen actor_id
-- (bestehender Nutzer) voraussetzt, ein fehlgeschlagener Login aber auch
-- mit unbekannter E-Mail-Adresse erfolgen kann.
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, created_at);
