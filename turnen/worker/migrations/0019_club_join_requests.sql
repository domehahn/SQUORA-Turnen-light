-- Vereinsbeitritt braucht Freigabe der Jugendleitung, sobald der Verein
-- schon eine hat (ohne Jugendleitung bleibt der direkte Beitritt möglich -
-- sonst könnte niemand mehr beitreten). Analog zu move_requests/
-- capacity_requests/placement_requests.
CREATE TABLE club_join_requests (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_club_join_requests_club ON club_join_requests(club_id, status);
-- Pro Person nur eine offene Beitrittsanfrage gleichzeitig.
CREATE UNIQUE INDEX idx_club_join_requests_pending_unique ON club_join_requests(user_id) WHERE status = 'pending';
