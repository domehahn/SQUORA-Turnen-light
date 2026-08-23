-- Nachvollziehbarkeit: wer hat wann was an den gemeinsamen Vereinsdaten
-- geändert (Gruppen anlegen/ändern/löschen/zuordnen, Rollenwechsel,
-- Freigabe-Entscheidungen). Pro Verein einsehbar für alle Mitglieder.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_log_club ON audit_log(club_id, created_at);
