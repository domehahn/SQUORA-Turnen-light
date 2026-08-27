-- AUTH-12/AUTH-13 (zweiter Production-Readiness-Härtungsdurchgang
-- 2026-08-27): MFA-Backup-Codes waren bisher ein einzelnes JSON-Array in
-- users.totp_backup_codes. Verwendung eines Codes war ein klassisches
-- Read-Modify-Write: Zeile lesen, Array in JS parsen/splicen, komplettes
-- Array zurückschreiben. Zwei GLEICHZEITIGE Requests mit demselben
-- Backup-Code lasen beide dasselbe Array, verifizierten beide erfolgreich
-- und überschrieben sich beim Zurückschreiben gegenseitig - der zweite
-- Request "gewann" einfach den letzten Write, unabhängig vom Ergebnis der
-- Prüfung. Ein Backup-Code war damit NICHT zuverlässig ein echtes
-- One-Time-Credential.
--
-- Neues Modell: eigene Zeile pro Code, Verbrauch über ein atomares
-- `UPDATE ... SET used_at = ... WHERE id = ? AND used_at IS NULL` -
-- exakt derselbe bewährte Mechanismus wie bei `used_password_reset_tokens`
-- (PRIMARY-KEY-Insert) und `password_reset_requests`, nur hier über die
-- betroffene-Zeilen-Anzahl des UPDATE statt eines PRIMARY-KEY-Konflikts:
-- gewinnt genau der Request, dessen UPDATE tatsächlich eine Zeile trifft
-- (rows_written/changes = 1), jeder andere gleichzeitige Versuch mit
-- demselben Code trifft danach 0 Zeilen und schlägt fehl.
CREATE TABLE mfa_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE INDEX idx_mfa_backup_codes_user ON mfa_backup_codes(user_id);
-- Für die spätere "aktive Codes"-Abfrage (WHERE user_id = ? AND used_at IS NULL).
CREATE INDEX idx_mfa_backup_codes_user_active ON mfa_backup_codes(user_id, used_at);

-- Datenübernahme: bestehende, bereits als Hash+Salt gespeicherte Codes aus
-- dem alten JSON-Array in eigene Zeilen überführen (kein Klartext-Code an
-- irgendeiner Stelle involviert - json_each liest lediglich das bereits
-- gehashte {hash, salt}-Objekt pro Eintrag). Betrifft zum Zeitpunkt dieser
-- Migration einen produktiven Account mit 8 Codes (verifiziert 27.08.2026).
INSERT INTO mfa_backup_codes (id, user_id, code_hash, code_salt)
SELECT
  lower(hex(randomblob(16))),
  users.id,
  json_extract(je.value, '$.hash'),
  json_extract(je.value, '$.salt')
FROM users, json_each(users.totp_backup_codes) je
WHERE users.totp_backup_codes IS NOT NULL AND users.totp_backup_codes != '';

-- users.totp_backup_codes bleibt als Spalte bestehen (kein DROP COLUMN in
-- dieser Migration - unnötiges zusätzliches Risiko für einen rein
-- kosmetischen Aufräumschritt), wird vom Anwendungscode ab sofort aber
-- nicht mehr gelesen oder beschrieben. Kandidat für eine spätere,
-- eigenständige Aufräum-Migration, nachdem das neue Modell produktiv
-- verifiziert wurde.
