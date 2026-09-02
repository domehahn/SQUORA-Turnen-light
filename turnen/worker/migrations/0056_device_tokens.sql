-- Push-Geräte-Tokens der nativen App (APNs/FCM über FCM HTTP v1). Ein Nutzer
-- kann mehrere Geräte haben. Bei ON DELETE CASCADE verschwinden die Tokens
-- mit dem Account. Ungültige Tokens werden vom Sender beim nächsten Versuch
-- aussortiert (FCM-Fehler UNREGISTERED / INVALID_ARGUMENT).
CREATE TABLE device_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
