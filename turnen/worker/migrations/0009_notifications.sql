-- In-App-Postfach für Benachrichtigungen (Freigabe-Anfragen, Warteliste,
-- Anwesenheits-Trends). Wird zusätzlich - best effort, ohne den Aufruf zu
-- blockieren - per E-Mail über Resend verschickt, sobald der API-Schlüssel
-- als Worker-Secret gesetzt ist (siehe worker/src/notifications.ts).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
