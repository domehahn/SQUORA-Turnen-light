-- Vereinsweite Warteliste (getrennt von der Gruppen-Warteliste aus
-- 0008_waitlist.sql, die nur für volle Gruppen automatisch nachrückt):
-- Kinder, die noch keiner Gruppe zugeordnet sind, landen hier. Die
-- Jugendleitung kann von hier aus einen Platz bei einer bestimmten Gruppe
-- vorschlagen ("nach Rücksprache mit dem Turntrainer") - die betroffene
-- Gruppenleitung muss diesen Vorschlag aber aktiv bestätigen, bevor das Kind
-- wirklich in die Gruppe übernommen wird.
CREATE TABLE club_waitlist_entries (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  note TEXT,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'placed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_club_waitlist_club ON club_waitlist_entries(club_id);
CREATE INDEX idx_club_waitlist_status ON club_waitlist_entries(status);
-- Ein Kind steht nie doppelt gleichzeitig auf der Vereinswarteliste.
CREATE UNIQUE INDEX idx_club_waitlist_unique_waiting ON club_waitlist_entries(child_id) WHERE status = 'waiting';

-- Vorschlag der Jugendleitung, ein wartendes Kind einer bestimmten Gruppe
-- zuzuteilen. Erst wenn die Gruppenleitung bestätigt, wird das Kind
-- tatsächlich verschoben.
CREATE TABLE placement_requests (
  id TEXT PRIMARY KEY,
  waitlist_entry_id TEXT NOT NULL REFERENCES club_waitlist_entries(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  proposed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_placement_requests_entry ON placement_requests(waitlist_entry_id);
CREATE INDEX idx_placement_requests_group ON placement_requests(group_id);
-- Pro Warteliste-Eintrag darf immer nur ein Vorschlag gleichzeitig offen sein.
CREATE UNIQUE INDEX idx_placement_requests_pending_unique ON placement_requests(waitlist_entry_id) WHERE status = 'pending';
