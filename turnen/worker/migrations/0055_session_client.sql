-- Client-Typ einer Sitzung: "web" (Browser, HttpOnly-Cookie, kurzer
-- Idle-Timeout) oder "app" (native Capacitor-App, Bearer-Token, deutlich
-- längere Timeouts). Reines ADD COLUMN - bestehende Sitzungen gelten als "web".
ALTER TABLE sessions ADD COLUMN client TEXT NOT NULL DEFAULT 'web';
