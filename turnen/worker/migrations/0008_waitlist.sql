-- Warteliste: ist eine Gruppe voll, kann ein Kind statt einer sofortigen
-- Kapazitäts-Anfrage auf die Warteliste gesetzt werden. Wird später ein
-- Platz frei (Kind verlässt/wechselt aus der Gruppe, oder max_children wird
-- erhöht), rückt automatisch der nächste Eintrag nach (siehe
-- worker/src/index.ts, promoteWaitlist).
CREATE TABLE waitlist_entries (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_waitlist_group ON waitlist_entries(group_id);
CREATE INDEX idx_waitlist_status ON waitlist_entries(status);
-- Ein Kind soll nicht doppelt auf derselben Warteliste stehen.
CREATE UNIQUE INDEX idx_waitlist_unique_waiting ON waitlist_entries(group_id, child_id) WHERE status = 'waiting';
