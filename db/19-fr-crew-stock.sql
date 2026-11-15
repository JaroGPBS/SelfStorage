-- GPBS Storage FR: crew-owned parts ledger (not vehicle-owned).
-- Non-destructive. The /api/fr Worker creates these tables on first FR request.
-- This file is a schema reference; committing it does NOT execute it against D1.
-- No migration of legacy vehicle_stock into crew stocks: old data may be test.
-- Real BOX warehouse_stock and all PL data must remain untouched.

CREATE TABLE IF NOT EXISTS fr_crew_stock (
  user_id TEXT NOT NULL REFERENCES users(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, part_id)
);

CREATE TABLE IF NOT EXISTS fr_crew_first_inventory (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES fr_vehicle_events(id),
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fr_crew_stock_revisions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
