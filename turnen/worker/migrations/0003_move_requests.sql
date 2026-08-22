-- Verschiebe-Anfragen: Ein Kind, das die Altersvoraussetzung der Zielgruppe
-- NICHT erfüllt, kann nur nach Freigabe durch den Turnleiter (Besitzer) der
-- Zielgruppe dorthin verschoben werden. Erfüllt es die Voraussetzung - oder
-- ist die Zielgruppe die eigene bzw. eine herrenlose Alt-Gruppe - wird
-- direkt verschoben und es entsteht kein Eintrag hier.
CREATE TABLE move_requests (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  from_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  to_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_move_requests_child ON move_requests(child_id);
CREATE INDEX idx_move_requests_to_group ON move_requests(to_group_id);
-- Pro Kind darf immer nur eine Anfrage gleichzeitig offen sein.
CREATE UNIQUE INDEX idx_move_requests_pending_unique ON move_requests(child_id) WHERE status = 'pending';
