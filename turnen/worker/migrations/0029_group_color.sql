-- Frei wählbare Farbe pro Gruppe (statt nur automatischem Hash im Kalender)
ALTER TABLE groups ADD COLUMN color TEXT;
