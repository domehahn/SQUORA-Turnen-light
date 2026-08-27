-- Behebt einen zweiten Cross-Tenant-Isolation-Fehler (P0, externe
-- Production-Readiness-Prüfung 2026-08-27, analog zu Migration 0036 bei
-- children): families hatte bisher KEINE eigene Vereinszuordnung. Die
-- Mandantengrenze wurde stattdessen dynamisch über
-- "JOIN users ON families.created_by = users.id, WHERE users.club_id = ?"
-- berechnet - wechselt die anlegende Person später den Verein, wandert die
-- Familie (inkl. Notfallkontakten der verknüpften Kinder) logisch mit in
-- den neuen Verein, unabhängig davon, wo die eigentlich zugehörigen Kinder
-- sind.
--
-- families.club_id ist ab jetzt die primäre, beim Anlegen fest gesetzte
-- Mandantengrenze (nicht mehr aus created_by -> user.club_id abgeleitet).
ALTER TABLE families ADD COLUMN club_id TEXT REFERENCES clubs(id);

-- Backfill: Verein der anlegenden Person zum jetzigen Zeitpunkt (letzte
-- verfügbare Näherung an den historisch korrekten Verein - besser als gar
-- keine Zuordnung, aber falls jemand zwischenzeitlich den Verein gewechselt
-- hat, ist das nicht rückwirkend rekonstruierbar). Alternativ, falls schon
-- Kinder verknüpft sind, deren club_id bevorzugen (zuverlässiger, da nicht
-- vom aktuellen Nutzerkonto abhängig).
UPDATE families
SET club_id = COALESCE(
  (SELECT c.club_id FROM children c WHERE c.family_id = families.id AND c.club_id IS NOT NULL LIMIT 1),
  (SELECT u.club_id FROM users u WHERE u.id = families.created_by)
);

CREATE INDEX idx_families_club ON families(club_id);
