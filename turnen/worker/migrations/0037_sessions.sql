-- Serverseitige Sitzungsverwaltung (Session-Management-Härtung, externe
-- Production-Readiness-Prüfung 2026-08-27). Löst das bisherige, rein
-- zustandslose JWT-im-localStorage-Modell ab: Sitzungen sind jetzt aktiv
-- widerrufbar (Passwortänderung/-Reset, MFA-Deaktivierung, "alle Geräte
-- abmelden"), haben ein echtes Idle-Timeout und ein absolutes Maximum -
-- beides serverseitig durchgesetzt, nicht nur clientseitig.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  -- Nur für die "aktive Sitzungen"-Übersicht (Selbstauskunft), keine
  -- sicherheitskritische Prüfung.
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);

-- Einmaligkeit für den Passwort-Reset-Link (Finding aus derselben Prüfung):
-- der Reset-Token war bisher nur ein 30-Minuten-JWT ohne Revocation, also
-- innerhalb seiner Gültigkeit theoretisch mehrfach nutzbar. Jeder Token
-- trägt jetzt eine eindeutige jti; wird beim Einlösen hier eingetragen
-- (PRIMARY KEY verhindert ein zweites Mal), alte Zeilen können anhand
-- expires_at aufgeräumt werden.
CREATE TABLE used_password_reset_tokens (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
