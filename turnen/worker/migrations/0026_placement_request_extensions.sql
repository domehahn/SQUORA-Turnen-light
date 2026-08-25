-- Erweitert placement_requests um die Gegenrichtung: nicht nur die
-- Jugendleitung schlägt einer Gruppenleitung ein Kind vor, sondern eine
-- Gruppenleitung kann jetzt auch selbst anfragen, ein wartendes Kind in die
-- eigene Gruppe zu übernehmen - das muss dann immer die Jugendleitung
-- freigeben (unabhängig von freier Kapazität), statt die Gruppenleitung
-- selbst bestätigen zu lassen.
ALTER TABLE placement_requests ADD COLUMN initiated_by_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE placement_requests ADD COLUMN reason TEXT;
ALTER TABLE placement_requests ADD COLUMN decline_reason TEXT;
