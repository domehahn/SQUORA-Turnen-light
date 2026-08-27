-- Rate-Limiting für POST /api/password-reset/request (externe Production-
-- Readiness-Prüfung 2026-08-27, P1 "PASSWORD RESET HARDENING") - vorher
-- ohne jede Begrenzung, jemand hätte eine fremde Adresse mit Reset-Mails
-- fluten können. Getrennt von login_attempts (andere Bedeutung/Query-Muster),
-- absichtlich ohne Erfolgs-/Fehlschlag-Unterscheidung - jede Anfrage zählt,
-- unabhängig davon, ob die E-Mail-Adresse überhaupt existiert (sonst ließe
-- sich über das Rate-Limit-Verhalten selbst schon auf Existenz schließen).
CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_password_reset_requests_email_time ON password_reset_requests(email, created_at);
CREATE INDEX idx_password_reset_requests_ip_time ON password_reset_requests(ip, created_at);
