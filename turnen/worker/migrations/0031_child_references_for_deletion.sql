-- Damit eine harte Löschung eines Kindes (DELETE /api/children/:id) auch
-- dessen Namen/Kontext aus audit_log.target_label und notifications.body
-- entfernen kann (vorher blieben diese Freitext-Reste unbegrenzt bestehen,
-- siehe PRIVACY_SECURITY_GAP_ANALYSIS.md Finding PRIV-06), bekommen beide
-- Tabellen eine optionale, strukturierte Referenz auf das Kind.
ALTER TABLE audit_log ADD COLUMN child_id TEXT REFERENCES children(id) ON DELETE SET NULL;
CREATE INDEX idx_audit_log_child ON audit_log(child_id);

ALTER TABLE notifications ADD COLUMN child_id TEXT REFERENCES children(id) ON DELETE SET NULL;
CREATE INDEX idx_notifications_child ON notifications(child_id);
