-- Entfernt das allgemeine Freitext-Notizfeld bei Kindern (children.notes).
--
-- Hintergrund: Nach Entfernung von health_notes (0033) wurde festgestellt,
-- dass ein generisches Freitextfeld denselben Zweck durch die Hintertür
-- ermöglicht ("Notiz" statt "Gesundheitshinweis") - Trainer*innen können
-- dort trotzdem Diagnosen, Allergien, Medikamente o.ä. eintragen. Für den
-- Art.-9-DSGVO-Schutz ist der Feldinhalt entscheidend, nicht der Spalten-
-- name. Deshalb: Feld komplett entfernt statt nur umbenannt/eingeschränkt.
ALTER TABLE children DROP COLUMN notes;
