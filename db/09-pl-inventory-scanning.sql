-- GPBS Storage: inventory scan events and parts awaiting office verification.
-- Run AFTER db/08-pl-warehouse-inventories.sql.
-- Existing stock and French app are unchanged.
CREATE TABLE IF NOT EXISTS pl_warehouse_inventory_events (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('ADD','SET')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 100000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES pl_warehouse_inventories(id),
  FOREIGN KEY(part_id) REFERENCES parts(id),
  FOREIGN KEY(actor_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pl_inv_events_inventory
  ON pl_warehouse_inventory_events(inventory_id,created_at);

CREATE TABLE IF NOT EXISTS pl_part_verifications (
  part_id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  raw_code TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','VERIFIED')),
  verified_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY(part_id) REFERENCES parts(id),
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_part_verifications_code
  ON pl_part_verifications(raw_code)
  WHERE raw_code IS NOT NULL AND TRIM(raw_code)<>'';

CREATE INDEX IF NOT EXISTS idx_pl_part_verifications_pending
  ON pl_part_verifications(status,created_at);
