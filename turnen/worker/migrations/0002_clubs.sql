-- Vereine: mehrere Turnleiter (Nutzer) können demselben Verein angehören.
-- Gruppen bekommen einen Besitzer (owner_id) und den Verein des Besitzers
-- zum Anlagezeitpunkt (club_id). Andere Mitglieder desselben Vereins können
-- diese Gruppen und die zugehörigen Kinder danach lesend sehen, bearbeiten
-- dürfen weiterhin nur die Besitzer selbst.
--
-- Bestehende Gruppen bleiben ohne Besitzer/Verein (owner_id/club_id NULL)
-- und sind damit weiterhin für alle angemeldeten Nutzer sicht- und
-- bearbeitbar (Bestandsschutz, kein Datenverlust durch die Migration).

CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE users ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;
CREATE INDEX idx_users_club ON users(club_id);

ALTER TABLE groups ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE groups ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;
CREATE INDEX idx_groups_owner ON groups(owner_id);
CREATE INDEX idx_groups_club ON groups(club_id);
