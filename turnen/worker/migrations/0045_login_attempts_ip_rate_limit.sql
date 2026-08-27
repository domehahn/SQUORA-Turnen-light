-- CI-17 (zweiter Production-Readiness-Härtungsdurchgang 2026-08-27):
-- login_attempts kannte bisher keine IP-Adresse - Rate Limiting lief
-- ausschließlich pro E-Mail-Adresse (10 Fehlversuche / 15 Minuten, s.
-- LOGIN_MAX_FAILED_ATTEMPTS in worker/src/index.ts). Ein Angreifer mit
-- vielen bekannten/erratenen E-Mail-Adressen konnte damit von EINER IP aus
-- beliebig viele verschiedene Accounts durchprobieren (Credential
-- Stuffing/Password Spraying), solange pro einzelnem Account unter 10
-- Versuchen blieb - komplett ungebremst. Ergänzt jetzt eine IP-Spalte plus
-- Index, analog zum bereits bestehenden Muster bei
-- password_reset_requests (email + ip, s. Migration 0042).
--
-- Additive ALTER TABLE ADD COLUMN (NULLable, kein Rebuild nötig) - bereits
-- bestehende Zeilen bekommen ip = NULL, was countRecentFailedLoginsByIp()
-- korrekt als "keine IP bekannt" behandelt (kein rückwirkendes Sperren
-- alter Einträge).
ALTER TABLE login_attempts ADD COLUMN ip TEXT;

CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, created_at);
