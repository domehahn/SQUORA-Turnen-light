-- Mehrere gleichberechtigte Leitungen pro Gruppe (dauerhaft, nicht nur als
-- Vertretung für einen einzelnen Termin): Mit-Trainer*innen bekommen
-- dieselben Schreibrechte wie die Gruppenleitung selbst.
CREATE TABLE group_co_leaders (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_co_leaders_user ON group_co_leaders(user_id);
