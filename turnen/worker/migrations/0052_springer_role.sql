-- Rolle "Springer:in": kann Vertretungen übernehmen, leitet aber (zunächst)
-- keine eigene Gruppe. Bewusst als additives Flag neben club_role (wie
-- is_kassenwart in 0053) - ein reiner ALTER TABLE ... ADD COLUMN, KEIN
-- Tabellen-Rebuild. Der frühere Versuch, dafür die club_role-CHECK-Constraint
-- per DROP TABLE users / users_new-Rebuild zu erweitern, hat auf D1 die
-- ON DELETE SET NULL-Aktionen abhängiger Tabellen ausgelöst
-- (groups.owner_id, attendance_sessions.led_by, families.created_by) und
-- wurde per Time-Travel zurückgerollt. Deshalb hier die risikofreie Variante.
ALTER TABLE users ADD COLUMN is_springer INTEGER NOT NULL DEFAULT 0;
