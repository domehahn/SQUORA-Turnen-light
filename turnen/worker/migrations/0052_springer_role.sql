-- Neue Vereinsrolle "springer": Turntrainer:innen / Gruppenleiter:innen, die
-- Vertretungen übernehmen können, aber (zunächst) keine eigene Gruppe leiten.
-- Fachlich zwischen "member" (eigene Gruppe) und "jugendleiter" (Verwaltung).
--
-- SQLite/D1 kann eine CHECK-Constraint nicht per ALTER ändern - deshalb der
-- Standard-Table-Rebuild ("12-Schritte-Verfahren"), analog zu
-- 0043_families_club_id_not_null.sql. Die users.id-Werte bleiben unverändert,
-- daher bleiben alle FKs anderer Tabellen (REFERENCES users(id)) gültig;
-- PRAGMA foreign_keys=OFF nur für die Dauer des Rebuilds.
--
-- Spaltenreihenfolge = Reihenfolge der bisherigen Migrationen
-- (0001, 0002, 0004, 0028, 0030, 0035, 0038, 0040, 0041). Der Code liest
-- ausschliesslich spaltennamen-basiert (.first<UserRow>()), die Reihenfolge
-- ist also nicht verhaltensrelevant, wird hier aber sauber beibehalten.
PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  club_role TEXT NOT NULL DEFAULT 'member' CHECK (club_role IN ('member', 'jugendleiter', 'springer')),
  last_login_at TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_backup_codes TEXT,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  pending_totp_secret TEXT
);

INSERT INTO users_new (
  id, email, name, password_hash, password_salt, created_at, club_id, club_role,
  last_login_at, is_admin, totp_secret, totp_enabled, totp_backup_codes,
  password_iterations, must_change_password, pending_totp_secret
)
SELECT
  id, email, name, password_hash, password_salt, created_at, club_id, club_role,
  last_login_at, is_admin, totp_secret, totp_enabled, totp_backup_codes,
  password_iterations, must_change_password, pending_totp_secret
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX idx_users_club ON users(club_id);

PRAGMA foreign_keys=ON;
