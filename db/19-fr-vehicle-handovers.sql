-- GPBS Storage FR: przekazanie samochodu ekipie (D1).
-- TYLKO nowe tabele. Nie modyfikuje stanów warehouse_stock ani vehicle_stock.
-- Interfejs FR tworzy je również automatycznie przy pierwszym użyciu.

CREATE TABLE IF NOT EXISTS fr_vehicle_handovers (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_crew TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  inventory_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_INVENTORY'
    CHECK (status IN ('PENDING_INVENTORY', 'ACTIVE')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fr_vehicle_handovers_vehicle_current
  ON fr_vehicle_handovers(vehicle_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_fr_vehicle_handovers_user_current
  ON fr_vehicle_handovers(user_id,is_current,assigned_at);

-- Nie dzielimy fikcyjnych aut i zdarzeń z prawdziwymi ekipami.
CREATE TABLE IF NOT EXISTS fr_test_vehicle_handovers (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_crew TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  inventory_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_INVENTORY'
    CHECK (status IN ('PENDING_INVENTORY', 'ACTIVE')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fr_test_vehicle_handovers_vehicle_current
  ON fr_test_vehicle_handovers(vehicle_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_fr_test_vehicle_handovers_user_current
  ON fr_test_vehicle_handovers(user_id,is_current,assigned_at);
