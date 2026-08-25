-- Für den täglichen Cron-Reminder (siehe scheduled() in worker/src/index.ts):
-- markiert, dass für eine offene Anfrage bereits einmal an alle Beteiligten
-- erinnert wurde, damit dieselbe Anfrage nicht jeden Tag erneut eine Mail
-- auslöst.
ALTER TABLE move_requests ADD COLUMN reminded_at TEXT;
ALTER TABLE capacity_requests ADD COLUMN reminded_at TEXT;
