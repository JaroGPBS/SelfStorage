// FR vehicle handovers. A vehicle belongs to its registration plate, not to a crew.
// A new crew assignment is immediately visible but requires a complete vehicle
// inventory before the crew can perform warehouse operations. No manager approval.
const tables=(test)=>({
  handovers:test?'fr_test_vehicle_handovers':'fr_vehicle_handovers',
  vehicles:test?'fr_test_vehicles':'vehicles'
});
export async function ensureFrHandoverSchema(db,test=false){
  const t=tables(test);
  const found=await db.prepare(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?'
  ).bind(t.handovers).first();
  if(found)return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS '+t.handovers+' ('+
      'id TEXT PRIMARY KEY,'+
      'vehicle_id TEXT NOT NULL REFERENCES '+t.vehicles+'(id),'+
      'user_id TEXT NOT NULL REFERENCES users(id),'+
      'previous_crew TEXT,'+
      'assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'verified_at TEXT,'+
      'inventory_event_id TEXT,'+
      "status TEXT NOT NULL DEFAULT 'PENDING_INVENTORY' "+
      "CHECK(status IN ('PENDING_INVENTORY','ACTIVE')),"+
      'is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)))'
  ).run();
  await db.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_'+t.handovers+'_vehicle_current '+
      'ON '+t.handovers+'(vehicle_id) WHERE is_current=1'
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_'+t.handovers+'_user_current '+
      'ON '+t.handovers+'(user_id,is_current,assigned_at)'
  ).run();
}
export async function currentFrHandover(db,user,vehicleId){
  const t=tables(Boolean(user.testCrew));
  return db.prepare(
    'SELECT id,previous_crew,assigned_at,verified_at,status FROM '+t.handovers+
    ' WHERE vehicle_id=? AND user_id=? AND is_current=1 LIMIT 1'
  ).bind(vehicleId,user.id).first();
}
export function handoverTable(test=false){return tables(test).handovers;}
