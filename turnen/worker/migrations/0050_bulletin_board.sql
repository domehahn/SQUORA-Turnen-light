-- Digitales Schwarzes Brett & Trainer-Pinnwand
CREATE TABLE IF NOT EXISTS bulletin_posts (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', -- 'general', 'hall', 'training', 'event', 'urgent'
  author_id TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0, -- 1 = oben angepinnt
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bulletin_posts_club ON bulletin_posts(club_id, is_pinned, created_at);
