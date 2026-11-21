// PL test crew marker and deliberately scoped cleanup; no warehouse stock mutations.
export async function plTestTableExists(db){
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_test_crews'"
  ).first());
}
export async function ensurePlTestTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_test_crews ('+
      'user_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)'
  ).run();
}
export async function isPlTestCrew(db,userId){
  if(!await plTestTableExists(db))return false;
  return Boolean(await db.prepare(
    'SELECT user_id FROM pl_test_crews WHERE user_id=?'
  ).bind(userId).first());
}
const tableExists=async(db,name)=>Boolean(await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
).bind(name).first());

// Only the explicitly flagged account can enter this path.
// All associated PL routes must be presentation records; real records block deletion.
export async function deletePlTestCrew(env,userId){
  const db=env.DB;
  if(!await isPlTestCrew(db,userId))
    return {error:'To konto nie jest oznaczone jako testowa ekipa PL.',status:403};
  const user=await db.prepare(
    'SELECT u.id,u.name,u.role_code,p.display_code FROM users u '+
    'LEFT JOIN user_private_profiles p ON p.user_id=u.id WHERE u.id=?'
  ).bind(userId).first();
  if(!user||user.role_code!=='EKIPA')
    return {error:'Nie znaleziono testowej ekipy.',status:404};
  const symbol=String(user.display_code||'').trim().toUpperCase();
  if(!symbol||symbol.length>30)
    return {error:'Nie można ustalić symbolu testowej ekipy.',status:409};
  const hasRoutes=await tableExists(db,'pl_routes');
  const hasDemoFlag=hasRoutes&&(await db.prepare('PRAGMA table_info(pl_routes)').all())
    .results?.some(x=>x.name==='is_presentation');
  if(hasRoutes&&!hasDemoFlag)
    return {error:'Brak oznaczenia tras demonstracyjnych. Usuwanie przerwano.',status:409};
  if(hasRoutes){
    const real=await db.prepare(
      "SELECT id FROM pl_routes WHERE UPPER(TRIM(crew_symbol))=? "+
      'AND COALESCE(is_presentation,0)<>1 LIMIT 1'
    ).bind(symbol).first();
    if(real)return {error:'Do ekipy przypisano trasę nieoznaczoną jako demo. Nie usunięto konta ani tras.',status:409};
    const userCreatedReal=await db.prepare(
      'SELECT id FROM pl_routes WHERE created_by=? AND is_presentation<>1 LIMIT 1'
    ).bind(userId).first();
    if(userCreatedReal)return {error:'Ekipa ma powiązania z rzeczywistą trasą. Usuwanie zablokowane.',status:409};
  }
  const hasAudit=await tableExists(db,'pl_route_audit');
  if(hasAudit&&hasRoutes){
    const otherAudit=await db.prepare(
      "SELECT a.id FROM pl_route_audit a JOIN pl_routes r ON r.id=a.route_id "+
      "WHERE a.actor_id=? AND (r.is_presentation<>1 OR UPPER(TRIM(r.crew_symbol))<>?) LIMIT 1"
    ).bind(userId,symbol).first();
    if(otherAudit)return {error:'Ekipa ma wpisy w historii innych tras. Nie usunięto konta.',status:409};
  }
  const hasDocs=await tableExists(db,'pl_route_documents');
  const docs=hasRoutes&&hasDocs?(await db.prepare(
    'SELECT d.object_key,d.size_bytes FROM pl_route_documents d '+
    'JOIN pl_routes r ON r.id=d.route_id WHERE r.is_presentation=1 '+
    'AND UPPER(TRIM(r.crew_symbol))=?'
  ).bind(symbol).all()).results||[]:[];
  if(docs.length){
    if(!env.PART_PHOTOS||typeof env.PART_PHOTOS.delete!=='function')
      return {error:'Brak dostępu do zdjęć R2. Nie usunięto ekipy.',status:503};
    for(let i=0;i<docs.length;i+=1000)
      await env.PART_PHOTOS.delete(docs.slice(i,i+1000).map(x=>x.object_key));
  }
  const present=(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
    "'pl_route_audit','pl_route_documents','pl_route_return_approvals',"+
    "'pl_route_lines','pl_r2_photo_quota','user_private_profiles',"+
    "'user_warehouse_access','user_pin_credentials','user_access_settings',"+
    "'user_archives','panel_audit_log','fr_car_claims')"
  ).all()).results||[];
  const has=new Set(present.map(x=>x.name));
  const statements=[];
  if(docs.length&&has.has('pl_r2_photo_quota')){
    const bytes=docs.reduce((acc,d)=>acc+Number(d.size_bytes||0),0);
    statements.push(db.prepare(
      'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) WHERE id=1'
    ).bind(bytes));
  }
  const routeSubquery='SELECT id FROM pl_routes WHERE is_presentation=1 '+
    'AND UPPER(TRIM(crew_symbol))=?';
  if(hasRoutes){
    if(has.has('pl_route_return_approvals'))
      statements.push(db.prepare(
        'DELETE FROM pl_route_return_approvals WHERE route_id IN ('+routeSubquery+')'
      ).bind(symbol));
    if(has.has('pl_route_documents'))
      statements.push(db.prepare(
        'DELETE FROM pl_route_documents WHERE route_id IN ('+routeSubquery+')'
      ).bind(symbol));
    if(has.has('pl_route_audit'))
      statements.push(db.prepare(
        'DELETE FROM pl_route_audit WHERE route_id IN ('+routeSubquery+')'
      ).bind(symbol));
    if(has.has('pl_route_lines'))
      statements.push(db.prepare(
        'DELETE FROM pl_route_lines WHERE route_id IN ('+routeSubquery+')'
      ).bind(symbol));
    statements.push(db.prepare(
      'DELETE FROM pl_routes WHERE is_presentation=1 AND UPPER(TRIM(crew_symbol))=?'
    ).bind(symbol));
  }
  // Clear only the test account's metadata, PIN and mobile car claim.
  if(has.has('fr_car_claims'))
    statements.push(db.prepare('DELETE FROM fr_car_claims WHERE user_id=?').bind(userId));
  for(const table of ['user_private_profiles','user_warehouse_access',
    'user_pin_credentials','user_access_settings','user_archives']){
    if(has.has(table))statements.push(db.prepare('DELETE FROM '+table+' WHERE user_id=?').bind(userId));
  }
  if(has.has('panel_audit_log'))
    statements.push(db.prepare(
      "DELETE FROM panel_audit_log WHERE target_type='USER' AND target_id=?"
    ).bind(userId));
  statements.push(db.prepare('DELETE FROM pl_test_crews WHERE user_id=?').bind(userId));
  statements.push(db.prepare("DELETE FROM users WHERE id=? AND role_code='EKIPA'").bind(userId));
  const result=await db.batch(statements);
  const deletedUser=Number(result[result.length-1]?.meta?.changes||0);
  if(deletedUser!==1)throw Error('Test crew deletion did not remove exactly one account.');
  return {deletedUser,deletedRoutes:0,notice:
    'Usunięto testową ekipę PL, PIN oraz powiązane trasy demonstracyjne i ich historię. Stanów magazynowych nie zmieniono.'};
}
