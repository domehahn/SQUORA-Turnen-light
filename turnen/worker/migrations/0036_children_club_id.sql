-- Behebt einen Cross-Tenant-Isolation-Fehler (P0, externe Production-
-- Readiness-Prüfung 2026-08-27): Kinder ohne Gruppe (group_id IS NULL, z.B.
-- frisch auf der Vereins-Warteliste angelegt, bevor eine Gruppe zugeteilt
-- ist) hatten bisher KEINE eigene Vereinszuordnung. Die bestehende
-- Sichtbarkeits-/Schreibprüfung behandelte "keine Gruppe" fälschlich als
-- "für alle sichtbar/bearbeitbar" - das war als Kompatibilitäts-Öffnung für
-- Alt-Bestand vor Einführung der Vereine gedacht, gilt inzwischen aber auch
-- für ganz normal neu angelegte, noch gruppenlose Kinder eines Vereins.
--
-- children.club_id ist ab jetzt die primäre Mandantengrenze (nicht mehr nur
-- group_id -> group.club_id). Wird beim Anlegen immer gesetzt: aus der
-- Zielgruppe, falls vorhanden, sonst aus dem Verein der anlegenden Person.
ALTER TABLE children ADD COLUMN club_id TEXT REFERENCES clubs(id);

-- Backfill bestehender Kinder aus ihrer aktuellen Gruppe.
UPDATE children
SET club_id = (SELECT g.club_id FROM groups g WHERE g.id = children.group_id)
WHERE group_id IS NOT NULL;

CREATE INDEX idx_children_club ON children(club_id);
