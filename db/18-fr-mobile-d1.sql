-- GPBS Storage FR / self-service boxes. Apply ONCE to the existing D1.
-- Does NOT modify existing warehouse_stock or import any fictitious history.
-- Requires db/02-d1-teams-vehicles-inventory.sql and user accounts tables.
CREATE TABLE IF NOT EXISTS fr_warehouse_qr (
  warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),
  code TEXT NOT NULL UNIQUE
);
INSERT INTO fr_warehouse_qr(warehouse_id,code) VALUES
 ('FR-TOULOUSE','MAG-TL7A2Q'),
 ('FR-PARIS','MAG-PA5A4B')
ON CONFLICT(warehouse_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS fr_vehicle_usage (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fr_vehicle_usage_vehicle ON fr_vehicle_usage(vehicle_id);

CREATE TABLE IF NOT EXISTS fr_visits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED'))
);
CREATE INDEX IF NOT EXISTS idx_fr_visits_user ON fr_visits(user_id,started_at);
CREATE INDEX IF NOT EXISTS idx_fr_visits_warehouse ON fr_visits(warehouse_id,started_at);

CREATE TABLE IF NOT EXISTS fr_sessions (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES fr_visits(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  content_hash TEXT NOT NULL,
  comment TEXT,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fr_sessions_warehouse ON fr_sessions(warehouse_id,saved_at);

CREATE TABLE IF NOT EXISTS fr_session_lines (
  session_id TEXT NOT NULL REFERENCES fr_sessions(id),
  direction TEXT NOT NULL CHECK(direction IN ('POBRANIE','ZWROT')),
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  PRIMARY KEY(session_id,direction,part_id)
);
CREATE INDEX IF NOT EXISTS idx_fr_session_lines_part ON fr_session_lines(part_id);

CREATE TABLE IF NOT EXISTS fr_vehicle_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  type TEXT NOT NULL CHECK(type IN ('INWENTARYZACJA','RECZNA')),
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fr_vehicle_event_lines (
  event_id TEXT NOT NULL REFERENCES fr_vehicle_events(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity_before INTEGER,
  quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),
  PRIMARY KEY(event_id,part_id)
);

-- Diagnostic (should show two rows; existing quantities remain untouched):
SELECT w.id,w.name,q.code,COUNT(s.part_id) AS positions,
       COALESCE(SUM(s.quantity),0) AS units
FROM fr_warehouse_qr q JOIN warehouses w ON w.id=q.warehouse_id
LEFT JOIN warehouse_stock s ON s.warehouse_id=w.id
GROUP BY w.id,w.name,q.code ORDER BY w.id;
