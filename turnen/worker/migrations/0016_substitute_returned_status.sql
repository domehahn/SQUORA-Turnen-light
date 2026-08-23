-- Erweitert den Status einer Vertretungs-Anfrage um "returned": eine bereits
-- übernommene Vertretung kann zurückgegeben werden - entweder von der
-- Vertretung selbst (kann kurzfristig doch nicht) oder vom ursprünglichen
-- Turnleiter (will die Stunde kurzfristig doch wieder selbst übernehmen).
-- SQLite kennt kein ALTER TABLE ... ALTER CHECK, daher die Tabelle neu
-- anlegen und die Daten übernehmen.
CREATE TABLE substitute_requests_new (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'cancelled', 'returned')),
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO substitute_requests_new SELECT * FROM substitute_requests;
DROP TABLE substitute_requests;
ALTER TABLE substitute_requests_new RENAME TO substitute_requests;

CREATE INDEX idx_substitute_requests_group ON substitute_requests(group_id, session_date);
CREATE INDEX idx_substitute_requests_status ON substitute_requests(status);
CREATE UNIQUE INDEX idx_substitute_requests_open_unique ON substitute_requests(group_id, session_date) WHERE status = 'open';
