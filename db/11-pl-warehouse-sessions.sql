-- GPBS Storage / Poland: one signed-in warehouse visit with both PZ and WZ.
-- Apply once to the EXISTING testing D1 before using /pl/ PZ/WZ.
-- NON-DESTRUCTIVE: does not initialize/erase warehouse_stock, parts or history.
-- These tables must also be included in the fresh-production schema and zero audit.

CREATE TABLE IF NOT EXISTS pl_warehouse_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  warehouse_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  counterparty TEXT NOT NULL CHECK(length(counterparty) BETWEEN 2 AND 120),
  commit_guard INTEGER NOT NULL CHECK(commit_guard=1),
  committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pl_sessions_warehouse_time
  ON pl_warehouse_sessions(warehouse_id,committed_at DESC);

CREATE TABLE IF NOT EXISTS pl_warehouse_session_lines (
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('PZ','WZ')),
  part_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  quantity_before INTEGER NOT NULL CHECK(quantity_before>=0),
  quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),
  PRIMARY KEY (session_id,direction,part_id),
  FOREIGN KEY (session_id) REFERENCES pl_warehouse_sessions(id),
  FOREIGN KEY (part_id) REFERENCES parts(id)
);

CREATE INDEX IF NOT EXISTS idx_pl_session_lines_part
  ON pl_warehouse_session_lines(part_id);
