-- Helfer-Aufgaben und Geräte-Mängelmelder
ALTER TABLE event_helpers ADD COLUMN assigned_task TEXT;

CREATE TABLE IF NOT EXISTS equipment_reports (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  severity TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high'
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'resolved'
  description TEXT,
  reported_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_reports_club ON equipment_reports(club_id, status);
