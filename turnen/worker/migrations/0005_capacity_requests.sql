-- Kapazitäts-Anfragen: Würde das Anlegen/Bearbeiten/Verschieben eines
-- Kindes die maximale Gruppengröße überschreiten UND gibt es für den
-- Verein der Zielgruppe eine Jugendleitung, wird die Aktion nicht sofort
-- ausgeführt, sondern hier als Anfrage hinterlegt. Erst nach Freigabe durch
-- die Jugendleitung wird sie nachgeholt (siehe worker/src/index.ts).
--
-- `payload` enthält die für die jeweilige `action` nötigen Felder als JSON
-- (z.B. Vor-/Nachname/Geburtsdatum/Gruppe für "create_child").  Gibt es
-- keine Jugendleitung im Verein (oder ist die Gruppe keinem Verein
-- zugeordnet), entsteht kein Eintrag hier - dann greift weiterhin die
-- Selbstbestätigung per confirmOverCapacity.
CREATE TABLE capacity_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create_child', 'update_child', 'move_child', 'approve_move_request')),
  child_id TEXT REFERENCES children(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_capacity_requests_group ON capacity_requests(group_id);
CREATE INDEX idx_capacity_requests_status ON capacity_requests(status);
