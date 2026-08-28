-- Events und Helfer-Zuteilung (Sommerspiele, Turniere, Pausenaktionen etc.)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  required_trainers INTEGER NOT NULL DEFAULT 1,
  tasks TEXT,
  materials TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_helpers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_events_club_date ON events(club_id, event_date);
CREATE INDEX IF NOT EXISTS idx_event_helpers_event ON event_helpers(event_id);
CREATE INDEX IF NOT EXISTS idx_event_helpers_user ON event_helpers(user_id);
