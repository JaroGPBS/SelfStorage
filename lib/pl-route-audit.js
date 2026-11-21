// Route history is stored separately from the parts and R2. Only Office writes it.
export async function ensureRouteAuditSchema(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_audit ('+
    'id TEXT PRIMARY KEY,route_id TEXT NOT NULL,'+
    'action TEXT NOT NULL CHECK(action IN (\'EDIT\',\'EXPLAIN\')),'+
    'actor_id TEXT NOT NULL,details_json TEXT NOT NULL,'+
    'created_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')))'
  ).run();
  const info=await db.prepare('PRAGMA table_info(pl_routes)').all();
  for(const [column,definition] of [
    ['edit_revision','INTEGER NOT NULL DEFAULT 0'],
    ['edit_token','TEXT']
  ]){
    if((info.results||[]).some(row=>row.name===column))continue;
    try{
      await db.prepare(
        'ALTER TABLE pl_routes ADD COLUMN '+column+' '+definition
      ).run();
    }catch(error){
      const again=await db.prepare('PRAGMA table_info(pl_routes)').all();
      if(!(again.results||[]).some(row=>row.name===column))throw error;
    }
  }
}
export function auditEntry(db,entry){
  return db.prepare(
    'INSERT INTO pl_route_audit (id,route_id,action,actor_id,details_json) '+
    'SELECT ?,r.id,?,?,? FROM pl_routes r WHERE r.id=? AND r.edit_revision=? '+
    'AND r.edit_token=?'
  ).bind(entry.id,entry.routeId,entry.action,entry.actorId,
    JSON.stringify(entry.details),entry.routeId,entry.revision,entry.token);
}
