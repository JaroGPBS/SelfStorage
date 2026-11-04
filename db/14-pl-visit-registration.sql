-- GPBS Storage / PL: optional dedicated vehicle registration for shared PZ/WZ visits.
-- Run ONCE after db/13-pl-confirmed-overissues.sql in the Cloudflare D1 database.
-- Non-destructive: existing sessions, stock and history are not removed or changed.
-- Until applied, the API safely stores registration in counterparty as "NAZWA | REJ: XXXXX".
-- After this migration, new visits store the crew and plate in separate columns.
ALTER TABLE pl_warehouse_sessions
  ADD COLUMN registration_plate TEXT
  CHECK(registration_plate IS NULL OR length(registration_plate) BETWEEN 2 AND 20);

CREATE INDEX IF NOT EXISTS idx_pl_sessions_registration
  ON pl_warehouse_sessions(warehouse_id,registration_plate,committed_at DESC);
