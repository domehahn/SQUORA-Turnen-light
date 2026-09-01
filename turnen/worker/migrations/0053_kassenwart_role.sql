-- Zusatz-Rolle "Kassenwart:in": ruft eingereichte Stundennachweise ab und
-- rechnet sie ab. Bewusst KEIN weiterer club_role-Wert, sondern ein Flag neben
-- der Rolle - eine Kassenwart:in kann gleichzeitig Turnleiter:in (mit eigenen
-- Gruppen), Springer:in oder Jugendleitung sein und weiterhin eigene
-- Stundennachweise einreichen.
ALTER TABLE users ADD COLUMN is_kassenwart INTEGER NOT NULL DEFAULT 0;
