-- Poland: NOK (incomplete) parts are separated from normal warehouse stock.
-- Additive tables. Existing PZ/WZ, stock, history, parts and users are unchanged.
-- The PL session API also creates these tables on first NOK PZ/WZ.
CREATE TABLE IF NOT EXISTS pl_nok_stock (
  warehouse_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000000),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(warehouse_id,part_id),
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY(part_id) REFERENCES parts(id)
);

CREATE TABLE IF NOT EXISTS pl_nok_session_lines (
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('PZ','WZ')),
  part_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  quantity_before INTEGER NOT NULL CHECK(quantity_before>=0),
  quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),
  before_unknown INTEGER NOT NULL DEFAULT 1 CHECK(before_unknown IN (0,1)),
  shortage_quantity INTEGER NOT NULL DEFAULT 0 CHECK(shortage_quantity>=0),
  PRIMARY KEY(session_id,direction,part_id),
  FOREIGN KEY(session_id) REFERENCES pl_warehouse_sessions(id),
  FOREIGN KEY(part_id) REFERENCES parts(id)
);
CREATE INDEX IF NOT EXISTS idx_pl_nok_lines_part ON pl_nok_session_lines(part_id);
