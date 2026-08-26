-- Gesundheitshinweise (children.health_notes) wurden als Feature komplett
-- aus der App entfernt - auf ausdrücklichen Wunsch, um besondere Kategorien
-- personenbezogener Daten (Art. 9 DSGVO) für Kinder gar nicht erst zu
-- erheben, statt sie nur zu schützen (Datenminimierung). Notfallkontakte
-- (Name/Telefon) bleiben bestehen und weiterhin verschlüsselt.
ALTER TABLE children DROP COLUMN health_notes;
