-- Vertretungs-Anfragen, deren Termin verstrichen ist, wandern ins Archiv:
-- sie bleiben zur Nachvollziehbarkeit erhalten, sind aber nicht mehr über
-- die Börse übernehmbar. Rein additive Spalte (kein Tabellen-Rebuild auf
-- D1 - siehe Vorfall bei 0052). archived_at IS NULL = weiterhin aktiv.
-- Vom Trainer abgesagte Termine (attendance_sessions.cancelled = 1) werden
-- dagegen komplett gelöscht, nicht archiviert.
ALTER TABLE substitute_requests ADD COLUMN archived_at TEXT;

CREATE INDEX idx_substitute_requests_archived ON substitute_requests(archived_at);
