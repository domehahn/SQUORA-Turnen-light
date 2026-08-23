-- Trainingszeiten pro Gruppe (Wochentag + Uhrzeit) und wer eine konkrete
-- Turnstunde geleitet hat - Basis für die Stundenübersicht/den Export
-- (Übungsleiterpauschale, Zuschussnachweis).
ALTER TABLE groups ADD COLUMN weekday INTEGER; -- 0 = Sonntag ... 6 = Samstag
ALTER TABLE groups ADD COLUMN start_time TEXT; -- "HH:MM"
ALTER TABLE groups ADD COLUMN end_time TEXT;   -- "HH:MM"

ALTER TABLE attendance_sessions ADD COLUMN led_by TEXT REFERENCES users(id) ON DELETE SET NULL;
