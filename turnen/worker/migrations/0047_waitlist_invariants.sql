-- Bestehende Vereinswartelisten-Einträge abschließen, wenn das Kind
-- zwischenzeitlich bereits einer Gruppe zugeordnet wurde. Neue Inkonsistenzen
-- verhindert zusätzlich die API-Validierung.
UPDATE club_waitlist_entries
SET status = 'placed', resolved_at = COALESCE(resolved_at, datetime('now'))
WHERE status = 'waiting'
  AND child_id IN (SELECT id FROM children WHERE group_id IS NOT NULL);
