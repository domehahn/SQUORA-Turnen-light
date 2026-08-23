-- Pro Termin überschreibbare Uhrzeit/Ort/Notiz - für Sondertermine (z.B.
-- Turniere), die von der wöchentlichen Standardzeit/dem Standardort der
-- Gruppe abweichen. NULL bedeutet "wie in der Gruppe hinterlegt". Basis für
-- den amtlichen Stundennachweis (siehe /nachweis).
ALTER TABLE attendance_sessions ADD COLUMN start_time TEXT;
ALTER TABLE attendance_sessions ADD COLUMN end_time TEXT;
ALTER TABLE attendance_sessions ADD COLUMN location TEXT;
ALTER TABLE attendance_sessions ADD COLUMN note TEXT;
