-- Verlauf für normale Turnleiter*innen auf die jeweils eigene(n) Gruppe(n)
-- einschränken (die Jugendleitung sieht weiterhin alles). Dafür muss jeder
-- Eintrag wissen, zu welcher Gruppe er gehört - nicht jede Aktion betrifft
-- eine Gruppe (z.B. Rollenwechsel), daher nullable.
ALTER TABLE audit_log ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX idx_audit_log_group ON audit_log(group_id);
