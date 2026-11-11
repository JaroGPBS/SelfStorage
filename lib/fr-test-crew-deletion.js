// Permanent disposal of fictional crew accounts. Production movements are protected.
// For explicitly marked TEST crews, reverse their D1 movements in the SAME batch
// as their history deletion. Never touch the authoritative FR import snapshot.
async function tables(db){
  const r=await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return new Set((r.results||[]).map(x=>x.name));
}
async function count(db,sql,id){
  const row=await db.prepare(sql).bind(id).first();
  return Number(row?.n||0);
}
function bump(map,key,delta){
  map.set(key,(map.get(key)||0)+delta);
}
function problem(error,status=409){return {ok:false,error,status};}

export async function deleteDisposableCrew(env,userId,actorId){
  const db=env.DB;
  if(!/^GPBS-U-[a-f0-9-]{36}$/.test(String(userId||'')))
    return problem('Niepoprawny identyfikator konta.',400);
  const user=await db.prepare(
    'SELECT id,name,role_code FROM users WHERE id=?'
  ).bind(userId).first();
  if(!user)return problem('Nie znaleziono ekipy.',404);
  if(user.role_code!=='EKIPA'||String(user.name||'').toUpperCase()==='JJ')
    return problem('Trwale usuwać można wyłącznie ekipy. Pozostałe konta zachowują historię.',403);
  const all=await tables(db);
  const test=all.has('fr_mobile_test_users')&&Boolean(await db.prepare(
    'SELECT user_id FROM fr_mobile_test_users WHERE user_id=?'
  ).bind(userId).first());

  const prohibitions=[
    ['pl_warehouse_sessions','actor_id'],
    ['warehouse_operations','operator_id'],
    ['vehicle_assignments','team_id'],
    ['vehicle_inventories','team_id'],
    ['manager_actions','team_id'],
    ['stock_movements','actor_id']
  ];
  for(const [table,column] of prohibitions){
    if(!all.has(table))continue;
    const fields=(await db.prepare('PRAGMA table_info('+table+')').all()).results||[];
    if(!fields.some(x=>x.name===column))continue;
    if(await count(db,'SELECT COUNT(*) AS n FROM '+table+' WHERE '+column+'=?',userId))
      return problem('Ekipa ma rzeczywistą historię operacji. Można ją zarchiwizować, ale nie usunąć trwale.');
  }
  const frCount=all.has('fr_mobile_sessions')
    ?await count(db,'SELECT COUNT(*) AS n FROM fr_mobile_sessions WHERE user_id=?',userId):0;
  const eventCount=all.has('fr_mobile_vehicle_events')
    ?await count(db,'SELECT COUNT(*) AS n FROM fr_mobile_vehicle_events WHERE user_id=?',userId):0;
  if((frCount||eventCount)&&!test)
    return problem('Ta ekipa ma zapisane operacje. Trwałe usuwanie jest dostępne dla ekip oznaczonych jako testowe.');

  const warehouseDeltas=new Map(),vehicleDeltas=new Map(),cars=new Set();
  if(frCount){
    if(!all.has('fr_mobile_stock_effects'))
      return problem('Brakuje historii rzeczywistych zmian stanów. Nie można bezpiecznie cofnąć testów.');
    const rows=(await db.prepare(
      'SELECT e.location_type,e.location_id,e.part_id,SUM(e.applied_delta) AS total '+
      'FROM fr_mobile_stock_effects e JOIN fr_mobile_sessions s ON s.id=e.session_id '+
      'WHERE s.user_id=? GROUP BY e.location_type,e.location_id,e.part_id'
    ).bind(userId).all()).results||[];
    for(const row of rows){
      if(row.location_type==='WAREHOUSE')
        bump(warehouseDeltas,row.location_id+'|'+row.part_id,-Number(row.total||0));
      else if(row.location_type==='VEHICLE'){
        cars.add(row.location_id);
        bump(vehicleDeltas,row.location_id+'|'+row.part_id,-Number(row.total||0));
      }
    }
  }
  if(eventCount){
    const events=(await db.prepare(
      'SELECT vehicle_id,details FROM fr_mobile_vehicle_events WHERE user_id=?'
    ).bind(userId).all()).results||[];
    for(const event of events){
      cars.add(event.vehicle_id);
      let lines;
      try{lines=JSON.parse(event.details);}catch{return problem('Nie można odwrócić uszkodzonej historii samochodu.');}
      if(!Array.isArray(lines))return problem('Nieprawidłowa historia zmian samochodu.');
      for(const item of lines){
        if(!item.partId||!Number.isFinite(Number(item.to)))return problem('Nieprawidłowy zapis zmiany stanu auta.');
        const change=Number(item.to)-Number(item.from||0);
        bump(vehicleDeltas,event.vehicle_id+'|'+item.partId,-change);
      }
    }
  }
  // Never reverse test adjustments into a vehicle already used operationally
  // by somebody else; that would silently alter a real crew's stock.
  for(const car of cars){
    if(all.has('fr_mobile_vehicle_links')&&await db.prepare(
      'SELECT user_id FROM fr_mobile_vehicle_links WHERE vehicle_id=? AND user_id<>?'
    ).bind(car,userId).first())
      return problem('Samochód tej ekipy jest już używany przez inną ekipę. Nie można bezpiecznie cofnąć testów.');
    if(all.has('fr_mobile_sessions')&&await db.prepare(
      'SELECT id FROM fr_mobile_sessions WHERE vehicle_id=? AND user_id<>? LIMIT 1'
    ).bind(car,userId).first())
      return problem('Samochód ma historię innej ekipy. Nie można usunąć testów bez naruszenia jej danych.');
  }

  const batch=[];
  for(const [key,delta] of warehouseDeltas){
    if(!delta)continue;
    const sep=key.indexOf('|'),warehouseId=key.slice(0,sep),partId=key.slice(sep+1);
    const row=await db.prepare(
      'SELECT quantity FROM warehouse_stock WHERE warehouse_id=? AND part_id=?'
    ).bind(warehouseId,partId).first();
    if(!row||Number(row.quantity)+delta<0)
      return problem('Nie można bezpiecznie odwrócić testowych stanów magazynu. Sprawdź ilości.');
    batch.push(db.prepare(
      'UPDATE warehouse_stock SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP '+
      'WHERE warehouse_id=? AND part_id=?'
    ).bind(delta,warehouseId,partId));
  }
  for(const [key,delta] of vehicleDeltas){
    if(!delta)continue;
    const sep=key.indexOf('|'),vehicleId=key.slice(0,sep),partId=key.slice(sep+1);
    const row=await db.prepare(
      'SELECT quantity FROM vehicle_stock WHERE vehicle_id=? AND part_id=?'
    ).bind(vehicleId,partId).first();
    if(!row||Number(row.quantity)+delta<0)
      return problem('Nie można bezpiecznie odwrócić testowego stanu samochodu. Sprawdź ilości.');
    batch.push(db.prepare(
      'UPDATE vehicle_stock SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP '+
      'WHERE vehicle_id=? AND part_id=?'
    ).bind(delta,vehicleId,partId));
  }
  // Updates are protected by DB CHECK constraints: failures roll back the batch.
  if(all.has('fr_mobile_stock_effects'))batch.push(db.prepare(
    'DELETE FROM fr_mobile_stock_effects WHERE session_id IN (SELECT id FROM fr_mobile_sessions WHERE user_id=?)'
  ).bind(userId));
  if(all.has('fr_mobile_session_lines')){
    batch.push(db.prepare(
      'DELETE FROM fr_mobile_session_lines WHERE session_id IN (SELECT id FROM fr_mobile_sessions WHERE user_id=?)'
    ).bind(userId));
  }
  if(all.has('fr_mobile_sessions'))
    batch.push(db.prepare('DELETE FROM fr_mobile_sessions WHERE user_id=?').bind(userId));
  if(all.has('fr_mobile_visits'))
    batch.push(db.prepare('DELETE FROM fr_mobile_visits WHERE user_id=?').bind(userId));
  if(all.has('fr_mobile_vehicle_events'))
    batch.push(db.prepare('DELETE FROM fr_mobile_vehicle_events WHERE user_id=?').bind(userId));
  if(all.has('fr_mobile_vehicle_links'))
    batch.push(db.prepare('DELETE FROM fr_mobile_vehicle_links WHERE user_id=?').bind(userId));
  for(const car of cars){
    if(all.has('fr_mobile_vehicle_versions'))
      batch.push(db.prepare(
        'UPDATE fr_mobile_vehicle_versions SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE vehicle_id=?'
      ).bind(car));
  }
  for(const [table,column] of [
    ['fr_mobile_test_users','user_id'],['user_archives','user_id'],
    ['user_access_settings','user_id'],['user_pin_credentials','user_id'],
    ['user_private_profiles','user_id'],['user_warehouse_access','user_id'],
    ['teams','id']]){
    if(all.has(table))batch.push(db.prepare(
      'DELETE FROM '+table+' WHERE '+column+'=?'
    ).bind(userId));
  }
  if(all.has('panel_audit_log')){
    batch.push(db.prepare(
      'DELETE FROM panel_audit_log WHERE target_id=? OR actor_id=?'
    ).bind(userId,userId));
    // Keep a nameless security audit of permanent deletion, without a ghost account.
    batch.push(db.prepare(
      'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
      'VALUES (?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(),actorId,'TEST_CREW_PURGED','SYSTEM','DISPOSABLE_CREW',
      JSON.stringify({revertedTestSessions:frCount,revertedVehicleEvents:eventCount})));
  }
  batch.push(db.prepare('DELETE FROM users WHERE id=?').bind(userId));
  try{await db.batch(batch);}
  catch(error){
    console.error('Permanent crew deletion rolled back',error?.name||'Error');
    return problem('Nie udało się bezpiecznie usunąć konta i cofnąć testów. Dane pozostawiono bez zmian.',503);
  }
  return {ok:true,userId,deleted:true,revertedTestSessions:frCount};
}
