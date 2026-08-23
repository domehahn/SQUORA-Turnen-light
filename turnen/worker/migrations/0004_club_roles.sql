-- Jugendleiter-Rolle: pro Verein kann es eine oder mehrere Jugendleitungen
-- geben, die zusätzliche Verwaltungsrechte haben (aktuell: herrenlose
-- Alt-Gruppen dem Verein zuordnen; perspektivisch: Freigabe von
-- Kapazitätsüberschreitungen). Der/die Vereinsgründer*in wird beim Anlegen
-- automatisch erste Jugendleitung, behält aber ganz normal eigene Gruppen.
ALTER TABLE users ADD COLUMN club_role TEXT NOT NULL DEFAULT 'member' CHECK (club_role IN ('member', 'jugendleiter'));
