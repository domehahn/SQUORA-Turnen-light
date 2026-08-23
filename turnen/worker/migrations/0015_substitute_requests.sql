-- Vertretungsbörse: eine Turnleitung kann für einen konkreten Termin eine
-- Vertretung suchen ("kann nicht, wer übernimmt?"). Andere Mitglieder des
-- Vereins sehen offene Anfragen und können sie übernehmen. Bei Übernahme
-- wird die Anwesenheits-Session für diesen Termin/Gruppe direkt mit
-- led_by = übernehmende Person vorbelegt (siehe worker/src/index.ts), damit
-- die Stunde automatisch im richtigen Stundennachweis landet.
CREATE TABLE substitute_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'cancelled')),
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_substitute_requests_group ON substitute_requests(group_id, session_date);
CREATE INDEX idx_substitute_requests_status ON substitute_requests(status);
-- Pro Gruppe/Termin darf immer nur eine offene Anfrage existieren.
CREATE UNIQUE INDEX idx_substitute_requests_open_unique ON substitute_requests(group_id, session_date) WHERE status = 'open';
