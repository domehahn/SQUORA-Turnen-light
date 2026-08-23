-- Strukturierte Notfallkontakte & Gesundheitshinweise pro Kind - statt nur
-- im Freitext-Notizfeld vergraben, damit sie im Ernstfall schnell auffindbar
-- sind.
ALTER TABLE children ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE children ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE children ADD COLUMN health_notes TEXT;
