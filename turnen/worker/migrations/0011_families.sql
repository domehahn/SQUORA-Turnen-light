-- Familien-Verknüpfung: Geschwister teilen sich einen gemeinsamen Kontakt
-- (statt Notfallkontakt separat pro Kind zu pflegen). `family_id` ist
-- optional - Kinder ohne Geschwister brauchen keine Familie.
CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE children ADD COLUMN family_id TEXT REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_children_family ON children(family_id);
