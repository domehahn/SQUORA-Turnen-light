-- Vereinsnummer (Landessportbund) - wird auf dem amtlichen Stundennachweis
-- benötigt und ändert sich praktisch nie, daher am Verein hinterlegt statt
-- bei jedem Ausdruck neu eingetippt werden zu müssen.
ALTER TABLE clubs ADD COLUMN club_number TEXT;
