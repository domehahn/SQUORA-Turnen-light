-- Vereinsübergreifende Admin-Rolle: kann alle Vereine sehen und sich in
-- einen beliebigen Verein als dessen Jugendleitung wechseln (siehe
-- POST /api/admin/switch-club). Unabhängig von club_role/club_id.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
