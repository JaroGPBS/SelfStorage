// PL route mobile stages, comments and final-report receipts.
// No warehouse or car stock is changed by this module.
export async function plRouteTableExists(db,name){
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).bind(name).first());
}
export async function ensurePlCrewRouteSchema(db){
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_route_crew_notes ('+
        'route_id TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN (\'PICKUP\',\'REPORT\')),'+
        'actor_id TEXT NOT NULL,comment TEXT NOT NULL,'+
        'created_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),'+
        'PRIMARY KEY(route_id,stage),'+
        'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_route_reports ('+
        'route_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,'+
        'details_json TEXT NOT NULL,'+
        'submitted_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),'+
        'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
    )
  ]);
}
export async function getPlRouteCrewNotes(db,id){
  if(!await plRouteTableExists(db,'pl_route_crew_notes'))return [];
  const records=(await db.prepare(
    'SELECT n.stage,n.comment,n.created_at AS createdAt,n.actor_id AS actorId,'+
    "COALESCE(NULLIF(TRIM(p.display_code),''),u.name,'Ekipa') AS actor "+
    'FROM pl_route_crew_notes n LEFT JOIN users u ON u.id=n.actor_id '+
    'LEFT JOIN user_private_profiles p ON p.user_id=n.actor_id '+
    'WHERE n.route_id=? ORDER BY n.created_at,n.stage'
  ).bind(id).all()).results||[];
  return records.map(({actorId,...entry})=>entry);
}
export const normalizePlRouteComment=value=>{
  if(value===null||value===undefined)return '';
  if(typeof value!=='string')return null;
  const comment=value.trim().replace(/\r\n?/g,'\n');
  return comment.length<=1000?comment:null;
};
