-- Eingereichte Stundennachweise. Der/die Übungsleiter:in unterschreibt den
-- Nachweis digital, reicht ihn ein (PDF wird in R2 abgelegt) und kann ihn bis
-- zur Abrechnung durch die Kassenwärtin erneut einreichen. Danach gesperrt.
--
-- quarter: 0 = ganzes Jahr, 1-4 = Quartal (analog GET /api/hours-report).
-- total_hours: serverseitig aus den Terminen neu berechnet und denormalisiert
--   abgelegt, damit Listen/Abrechnung nicht dem Client vertrauen müssen.
-- storage_key: R2-Objektschlüssel des eingereichten PDF.
-- settled_*: von der Kassenwärtin beim Abrechnen gesetzt.
CREATE TABLE hours_report_submissions (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'settled')),
  total_hours REAL NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  signed_by_name TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT,
  settled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  settled_amount_cents INTEGER,
  settled_rate_cents INTEGER,
  settled_note TEXT,
  UNIQUE (club_id, user_id, year, quarter)
);

CREATE INDEX idx_hours_submissions_club ON hours_report_submissions(club_id);
CREATE INDEX idx_hours_submissions_user ON hours_report_submissions(user_id);
