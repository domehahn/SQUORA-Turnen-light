-- Zustellstatus, persönliche Kanaleinstellungen, widerrufbare Kalenderfeeds
-- und datensparsame App-Level-Betriebssignale.

CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('requests', 'substitutes', 'waitlist', 'membership', 'attendance', 'system')),
  email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, category)
);

CREATE TABLE calendar_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX idx_calendar_tokens_user ON calendar_tokens(user_id, revoked_at);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider_id TEXT UNIQUE,
  category TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  payload_encrypted TEXT,
  last_error_code TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_deliveries_status ON email_deliveries(status, next_retry_at);
CREATE INDEX idx_email_deliveries_created ON email_deliveries(created_at);

CREATE TABLE email_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail_code TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_operational_events_time ON operational_events(occurred_at);

CREATE TABLE cron_runs (
  job_name TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  detail_code TEXT
);
