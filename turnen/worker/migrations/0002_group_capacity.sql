-- Optionale maximale Kinderzahl pro Gruppe, Basis für die Kapazitäts-Ampel
-- in der Gruppen-Übersicht.
ALTER TABLE groups ADD COLUMN max_children INTEGER;
