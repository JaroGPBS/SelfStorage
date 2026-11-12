// Isolated FR BOX test environment.
// Deliberately independent from warehouse_stock, vehicles, vehicle_stock and
// every real fr_* operational table. No mock balances in production tables.
export async function ensureFrTestSchema(db){
  const ready=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_test_vehicle_event_fingerprints'"
  ).first();
  if(ready)return;
  const ddl=[
    "CREATE TABLE IF NOT EXISTS fr_test_accounts ("+
      "user_id TEXT PRIMARY KEY REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_warehouse_snapshots ("+
      "warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_warehouse_stock ("+
      "warehouse_id TEXT NOT NULL REFERENCES warehouses(id),part_id TEXT NOT NULL REFERENCES parts(id),"+
      "quantity INTEGER NOT NULL CHECK(quantity>=0),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"+
      "PRIMARY KEY(warehouse_id,part_id))",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicles ("+
      "id TEXT PRIMARY KEY,registration_number TEXT NOT NULL UNIQUE COLLATE NOCASE,"+
      "active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),"+
      "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicle_usage ("+
      "user_id TEXT PRIMARY KEY REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),"+
      "assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicle_stock ("+
      "vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),"+
      "part_id TEXT NOT NULL REFERENCES parts(id),quantity INTEGER NOT NULL CHECK(quantity>=0),"+
      "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(vehicle_id,part_id))",
    "CREATE TABLE IF NOT EXISTS fr_test_visits ("+
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),"+
      "warehouse_id TEXT NOT NULL REFERENCES warehouses(id),"+
      "started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT,"+
      "status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED')))",
    "CREATE INDEX IF NOT EXISTS idx_fr_test_visits_user ON fr_test_visits(user_id,started_at)",
    "CREATE TABLE IF NOT EXISTS fr_test_sessions ("+
      "id TEXT PRIMARY KEY,visit_id TEXT NOT NULL REFERENCES fr_test_visits(id),"+
      "user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),"+
      "warehouse_id TEXT NOT NULL REFERENCES warehouses(id),"+
      "content_hash TEXT NOT NULL,comment TEXT,saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_session_lines ("+
      "session_id TEXT NOT NULL REFERENCES fr_test_sessions(id),"+
      "direction TEXT NOT NULL CHECK(direction IN ('POBRANIE','ZWROT')),"+
      "part_id TEXT NOT NULL REFERENCES parts(id),quantity INTEGER NOT NULL CHECK(quantity>0),"+
      "PRIMARY KEY(session_id,direction,part_id))",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicle_events ("+
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES fr_test_vehicles(id),"+
      "type TEXT NOT NULL CHECK(type IN ('INWENTARYZACJA','RECZNA')),"+
      "event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicle_event_lines ("+
      "event_id TEXT NOT NULL REFERENCES fr_test_vehicle_events(id),"+
      "part_id TEXT NOT NULL REFERENCES parts(id),"+
      "quantity_before INTEGER,quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),"+
      "PRIMARY KEY(event_id,part_id))",
    "CREATE TABLE IF NOT EXISTS fr_test_vehicle_event_fingerprints ("+
      "event_id TEXT PRIMARY KEY REFERENCES fr_test_vehicle_events(id),"+
      "content_hash TEXT NOT NULL)"
  ];
  for(const sql of ddl)await db.prepare(sql).run();
}
export async function isFrTestAccount(db,userId){
  const exists=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_test_accounts'"
  ).first();
  if(!exists)return false;
  return Boolean(await db.prepare('SELECT 1 FROM fr_test_accounts WHERE user_id=?')
    .bind(userId).first());
}
// A snapshot is taken exactly once per BOX; never copied back into real stock.
export async function seedFrTestWarehouse(db,warehouseId){
  await ensureFrTestSchema(db);
  const existing=await db.prepare(
    'SELECT 1 FROM fr_test_warehouse_snapshots WHERE warehouse_id=?'
  ).bind(warehouseId).first();
  if(existing)return;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO fr_test_warehouse_snapshots(warehouse_id) VALUES(?)')
      .bind(warehouseId),
    db.prepare(
      'INSERT OR IGNORE INTO fr_test_warehouse_stock(warehouse_id,part_id,quantity) '+
      'SELECT warehouse_id,part_id,quantity FROM warehouse_stock WHERE warehouse_id=?'
    ).bind(warehouseId)
  ]);
}
// Table identifiers come exclusively from these hard-coded values, never client input.
const TEST={
  vehicles:'fr_test_vehicles',usage:'fr_test_vehicle_usage',
  vehicleStock:'fr_test_vehicle_stock',warehouseStock:'fr_test_warehouse_stock',
  visits:'fr_test_visits',sessions:'fr_test_sessions',lines:'fr_test_session_lines',
  events:'fr_test_vehicle_events',eventLines:'fr_test_vehicle_event_lines',
  fingerprints:'fr_test_vehicle_event_fingerprints'
};
const REAL={
  vehicles:'vehicles',usage:'fr_vehicle_usage',vehicleStock:'vehicle_stock',
  warehouseStock:'warehouse_stock',visits:'fr_visits',sessions:'fr_sessions',
  lines:'fr_session_lines',events:'fr_vehicle_events',
  eventLines:'fr_vehicle_event_lines',fingerprints:'fr_vehicle_event_fingerprints'
};
export function frTables(testAccount){return testAccount?TEST:REAL;}
