-- Abweichender Termin (z.B. Turnier, andere Uhrzeit/Ort) braucht Freigabe
-- der Jugendleitung: Turnleiter*innen können nur anfragen, die Anwesenheit
-- selbst wird trotzdem sofort gespeichert (siehe saveAttendance in db.ts).
CREATE TABLE session_override_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_session_override_requests_group ON session_override_requests(group_id, session_date);
CREATE INDEX idx_session_override_requests_status ON session_override_requests(status);
-- Pro Termin nur eine offene Anfrage gleichzeitig.
CREATE UNIQUE INDEX idx_session_override_requests_pending_unique ON session_override_requests(group_id, session_date) WHERE status = 'pending';
