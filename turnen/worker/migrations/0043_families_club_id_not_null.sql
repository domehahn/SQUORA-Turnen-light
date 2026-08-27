-- TENANT-11/TENANT-12: families.club_id von einer nullable Spalte zu einer
-- echten NOT NULL-Datenbank-Invariante gehärtet (zweiter Production-
-- Readiness-Härtungsdurchgang 2026-08-27). Application-Level Fail-closed-
-- Checks (isChildWritable, familyId-Verknüpfungsprüfungen) bleiben die
-- primäre Durchsetzung, aber eine DB-Constraint verhindert zusätzlich, dass
-- ein künftiger Programmierfehler (z.B. ein direktes INSERT ohne club_id,
-- außerhalb der geprüften db.ts-Funktionen) überhaupt eine Zeile ohne
-- Mandantenzuordnung anlegen kann.
--
-- PREFLIGHT (gegen Produktion ausgeführt und verifiziert am 27.08.2026,
-- alle vier Abfragen ergaben 0 Zeilen - siehe PRODUCTION_READINESS_ANALYSIS.md
-- für die vollständigen Ergebnisse):
--
--   SELECT id, name FROM families WHERE club_id IS NULL;
--   SELECT family_id, COUNT(DISTINCT club_id) FROM children
--     WHERE family_id IS NOT NULL GROUP BY family_id HAVING COUNT(DISTINCT club_id) > 1;
--   SELECT c.id FROM children c JOIN families f ON f.id = c.family_id
--     WHERE c.club_id IS NOT NULL AND f.club_id IS NOT NULL AND c.club_id != f.club_id;
--   SELECT id FROM families WHERE created_by IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = families.created_by);
--
-- SQLite/D1 unterstützt kein `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`
-- - diese Migration nutzt deshalb den Standard-SQLite-Table-Rebuild
-- ("12-Schritte-Verfahren"): neue Tabelle mit der Constraint anlegen, Daten
-- kopieren, alte Tabelle löschen, neue umbenennen, Indexe neu anlegen,
-- Fremdschlüssel-Konsistenz explizit prüfen.
--
-- children.family_id verweist per FK auf families(id) - da sich weder id-
-- Werte noch deren Bedeutung ändern, bleibt diese Beziehung nach dem
-- Rebuild unverändert gültig. `PRAGMA foreign_keys=OFF` nur für die Dauer
-- des Rebuilds selbst (in D1 pro Migration ohnehin üblich, da D1 Requests
-- nicht in einer clientseitig offenen Transaktion über mehrere Statements
-- hinweg mit aktiven FKs zuverlässig unterstützt - siehe die frühere
-- turnen→turnen-eu-Migration in der Projekthistorie).
PRAGMA foreign_keys=OFF;

CREATE TABLE families_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  club_id TEXT NOT NULL REFERENCES clubs(id)
);

INSERT INTO families_new (id, name, contact_name, contact_phone, contact_email, created_by, created_at, club_id)
SELECT id, name, contact_name, contact_phone, contact_email, created_by, created_at, club_id
FROM families;

DROP TABLE families;
ALTER TABLE families_new RENAME TO families;

CREATE INDEX idx_families_club ON families(club_id);

-- POSTFLIGHT (nach Anwendung auf Produktion manuell zu verifizieren):
-- Zeilenzahl vor/nach identisch,
-- `PRAGMA foreign_key_check` liefert keine Zeilen, `GET /api/families`
-- funktioniert weiterhin normal, ein Insert ohne club_id schlägt jetzt mit
-- einem NOT-NULL-Constraint-Fehler fehl statt stillschweigend eine
-- mandantenlose Zeile anzulegen.
PRAGMA foreign_keys=ON;
