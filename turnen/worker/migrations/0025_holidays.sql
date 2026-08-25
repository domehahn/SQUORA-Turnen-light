-- Vereinsspezifische Ferien-/Trainingsausfall-Zeiträume, zusätzlich zu den
-- fest im Frontend hinterlegten RLP-Schulferien (src/lib/holidays.ts) -
-- z.B. für bewegliche Ferientage oder Vereine außerhalb Rheinland-Pfalz.
CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_holidays_club ON holidays(club_id);
