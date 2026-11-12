// FR car registration conflicts. Crew submits the plate; Admin resolves only conflicts.
// This table never holds production warehouse stock.
export async function ensureFrCarClaims(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS fr_car_claims ('+
    'user_id TEXT PRIMARY KEY REFERENCES users(id),'+
    'requested_plate TEXT NOT NULL,'+
    'owner_user_id TEXT,'+
    "status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),"+
    'inventory_json TEXT,inventory_event_id TEXT,'+
    'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'resolved_at TEXT,resolved_by TEXT)'
  ).run();
}
export async function pendingFrCarClaim(db,userId){
  return db.prepare(
    "SELECT user_id,requested_plate,owner_user_id,inventory_json,inventory_event_id "+
    "FROM fr_car_claims WHERE user_id=? AND status='PENDING'"
  ).bind(userId).first();
}
export function normalPlate(input){
  const code=String(input||'').trim().toUpperCase().replace(/\s+/g,'');
  return /^[A-Z0-9-]{3,20}$/.test(code)?code:'';
}
