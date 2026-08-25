-- Begründungspflicht: wer eine Verschiebe-Anfrage stellt (Alter passt
-- nicht oder fremde Gruppe), muss künftig angeben, warum. Ebenso wer sie
-- ablehnt.
ALTER TABLE move_requests ADD COLUMN reason TEXT;
ALTER TABLE move_requests ADD COLUMN reject_reason TEXT;
