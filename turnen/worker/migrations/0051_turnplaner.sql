-- Turnplaner & Hallen-Aufbauplaner
CREATE TABLE IF NOT EXISTS training_plans (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  group_id TEXT,
  canvas_data TEXT NOT NULL, -- JSON String mit Gerätepositionen, Notizen, etc.
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_training_plans_club ON training_plans(club_id, created_at);
