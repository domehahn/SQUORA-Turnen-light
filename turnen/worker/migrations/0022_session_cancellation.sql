-- Trainingsausfall verwalten: ein Termin lässt sich komplett absagen (z.B.
-- Ferien-Ausnahme, Trainer krank ohne gefundene Vertretung), mit Grund,
-- statt einfach als "nicht erfasst" zu erscheinen.
ALTER TABLE attendance_sessions ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_sessions ADD COLUMN cancel_reason TEXT;
