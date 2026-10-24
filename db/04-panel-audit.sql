-- GPBS Storage — panel WWW: audyt administracji (D1).
-- Ten skrypt nie modyfikuje tabel ani stanów francuskich magazynów.
-- Bezpieczny do ponownego wykonania.
CREATE TABLE IF NOT EXISTS panel_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_panel_audit_created
ON panel_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_panel_audit_target
ON panel_audit_log(target_type, target_id, created_at DESC);
