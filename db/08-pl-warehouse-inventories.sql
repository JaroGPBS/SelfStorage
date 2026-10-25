-- GPBS Storage — Polish warehouse inventory counting sheets (Cloudflare D1).
-- Execute once via D1 Console before using /api/pl/inventory.
-- Does not change or initialize existing warehouse_stock rows.
-- Empty quantity remains UNKNOWN; an explicitly counted zero is 0.

CREATE TABLE IF NOT EXISTS pl_warehouse_inventories (
  id TEXT PRIMARY KEY NOT NULL,
  warehouse_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','COMMITTED')),
  revision INTEGER NOT NULL DEFAULT 0,
  commit_guard INTEGER NOT NULL DEFAULT 1 CHECK(commit_guard = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TEXT,
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY(actor_id) REFERENCES users(id)
);

-- One unfinished counting sheet per worker + warehouse.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_inventory_open
ON pl_warehouse_inventories(warehouse_id,actor_id)
WHERE status='DRAFT';

CREATE INDEX IF NOT EXISTS idx_pl_inventory_warehouse_time
ON pl_warehouse_inventories(warehouse_id,created_at DESC);

CREATE TABLE IF NOT EXISTS pl_warehouse_inventory_lines (
  inventory_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  counted_quantity INTEGER NOT NULL
    CHECK(counted_quantity BETWEEN 0 AND 100000),
  base_quantity INTEGER CHECK(base_quantity>=0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(inventory_id,part_id),
  FOREIGN KEY(inventory_id) REFERENCES pl_warehouse_inventories(id),
  FOREIGN KEY(part_id) REFERENCES parts(id)
);

-- Immutable, auditable before/after snapshot, inserted in the same D1 batch
-- as each warehouse_stock update. assertion=1 guards stale stock values.
CREATE TABLE IF NOT EXISTS pl_warehouse_inventory_changes (
  id TEXT PRIMARY KEY NOT NULL,
  inventory_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  quantity_before INTEGER CHECK(quantity_before>=0),
  quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),
  assertion INTEGER NOT NULL CHECK(assertion=1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(inventory_id,part_id),
  FOREIGN KEY(inventory_id) REFERENCES pl_warehouse_inventories(id),
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY(part_id) REFERENCES parts(id),
  FOREIGN KEY(actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pl_inventory_changes_warehouse
ON pl_warehouse_inventory_changes(warehouse_id,created_at DESC);
