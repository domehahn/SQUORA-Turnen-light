-- Kinder können jetzt austreten statt gelöscht zu werden - erhält Historie
-- (Anwesenheit, Stundennachweis) und erlaubt spätere Reaktivierung.
ALTER TABLE children ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'));
ALTER TABLE children ADD COLUMN archived_at TEXT;
CREATE INDEX idx_children_status ON children(status);
