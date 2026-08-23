-- Ort/Halle einer Gruppe - Basis für die Hallenbelegungs-Konflikterkennung
-- (zwei Gruppen mit überlappender Zeit am selben Ort).
ALTER TABLE groups ADD COLUMN location TEXT;
