// Only Admin resolves duplicate FR vehicle claims. Never changes warehouse stocks.
import {ensureFrCarClaims,normalPlate} from './fr-car-claims.js';
import {getVehicleCatalogue} from './vehicle-catalogue-service.js';

export async function resolveFrCarClaim(db,body,actorId){
  await ensureFrCarClaims(db);
  const userId=String(body?.userId||'');
  const decision=String(body?.decision||'').toUpperCase();
  if(!/^GPBS-U-[a-f0-9-]{36}$/.test(userId)||
      !['APPROVE','REJECT','CORRECT'].includes(decision))
    throw Error('Nieprawidłowa decyzja dotycząca samochodu.');
  const crew=await db.prepare(
    "SELECT id,name,active FROM users WHERE id=? AND role_code='EKIPA'"
  ).bind(userId).first();
  if(!crew?.active)throw Error('Nie znaleziono aktywnej ekipy.');
  const claim=await db.prepare(
    "SELECT * FROM fr_car_claims WHERE user_id=? AND status='PENDING'"
  ).bind(userId).first();
  if(!claim)throw Error('Brak oczekującej rejestracji. Odśwież Admin.');

  if(decision==='REJECT'){
    await db.batch([
      db.prepare(
        "UPDATE fr_car_claims SET status='REJECTED',inventory_json=NULL,"+
        "inventory_event_id=NULL,resolved_by=?,resolved_at=CURRENT_TIMESTAMP,"+
        "updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='PENDING'"
      ).bind(actorId,userId),
      db.prepare(
        'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
        'VALUES(?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),actorId,'CAR_REJECT','USER',userId,
        JSON.stringify({plate:claim.requested_plate}))
    ]);
    return {ok:true,message:'Odrzucono przypisanie samochodu.'};
  }
  const correcting=decision==='CORRECT';
  const newPlate=correcting?normalPlate(body?.correctedPlate):claim.requested_plate;
  if(!newPlate)throw Error('Podaj poprawny numer rejestracyjny.');
  const existing=await db.prepare(
    'SELECT id FROM vehicles WHERE registration_number=? COLLATE NOCASE'
  ).bind(newPlate).first();
  const owner=existing?await db.prepare(
    'SELECT a.user_id,u.name FROM fr_vehicle_usage a JOIN users u ON u.id=a.user_id '+
    'WHERE a.vehicle_id=? AND a.user_id<>?'
  ).bind(existing.id,userId).first():null;
  if(correcting&&owner){
    await db.prepare(
      "UPDATE fr_car_claims SET requested_plate=?,owner_user_id=?,"+
      "updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='PENDING'"
    ).bind(newPlate,owner.user_id,userId).run();
    return {ok:true,pending:true,
      message:'Poprawiono numer. Samochód jest przypisany do ekipy '+owner.name+
      '. Jeśli to właściwy samochód, kliknij Zatwierdź.'};
  }
  const carId=existing?.id||'GPBS-V-'+crypto.randomUUID();
  if(existing){
    const visit=await db.prepare(
      "SELECT 1 FROM fr_visits WHERE vehicle_id=? AND status='ACTIVE' LIMIT 1"
    ).bind(carId).first();
    if(visit)throw Error('Samochód ma niezakończoną wizytę.');
  }
  const ownVisit=await db.prepare(
    "SELECT 1 FROM fr_visits WHERE user_id=? AND status='ACTIVE' LIMIT 1"
  ).bind(userId).first();
  if(ownVisit)throw Error('Ekipa ma niezakończoną wizytę.');

  let snapshot=null;
  if(claim.inventory_json){
    try{snapshot=JSON.parse(claim.inventory_json);}
    catch{throw Error('Nie można odczytać inwentaryzacji ekipy.');}
    if(!Array.isArray(snapshot)||snapshot.some(x=>
      !x||typeof x.id!=='string'||!Number.isSafeInteger(x.qty)||x.qty<0))
      throw Error('Nieprawidłowy zapis inwentaryzacji.');
    const allowed=new Set((await getVehicleCatalogue(db)).parts.filter(p=>p.id).map(p=>p.id));
    if(!allowed.size||snapshot.length!==allowed.size||
       new Set(snapshot.map(x=>x.id)).size!==snapshot.length||
       snapshot.some(x=>!allowed.has(x.id)))
      throw Error('Zmieniono katalog samochodowy. Ekipa musi ponownie zrobić inwentaryzację.');
  }
  const stmts=[];
  if(!existing)stmts.push(db.prepare(
    'INSERT INTO vehicles(id,registration_number,active) VALUES(?,?,1)'
  ).bind(carId,newPlate));
  stmts.push(
    db.prepare('DELETE FROM fr_vehicle_usage WHERE vehicle_id=? AND user_id<>?')
      .bind(carId,userId),
    db.prepare(
      'INSERT INTO fr_vehicle_usage(user_id,vehicle_id,assigned_at) VALUES(?,?,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(user_id) DO UPDATE SET vehicle_id=excluded.vehicle_id,'+
      'assigned_at=CURRENT_TIMESTAMP'
    ).bind(userId,carId)
  );
  if(snapshot){
    const raw=JSON.stringify(snapshot);
    const eventId=claim.inventory_event_id||'INW-ADMIN-'+crypto.randomUUID();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    stmts.push(
      db.prepare(
        "INSERT INTO fr_vehicle_events(id,user_id,vehicle_id,type) "+
        "VALUES(?,?,?,'INWENTARYZACJA')"
      ).bind(eventId,userId,carId),
      db.prepare(
        'INSERT INTO fr_vehicle_event_fingerprints(event_id,content_hash) VALUES(?,?)'
      ).bind(eventId,hash),
      db.prepare(
        'INSERT INTO fr_vehicle_event_lines(event_id,part_id,quantity_before,quantity_after) '+
        "SELECT ?,json_extract(j.value,'$.id'),"+
        "(SELECT quantity FROM vehicle_stock WHERE vehicle_id=? AND "+
        "part_id=json_extract(j.value,'$.id')),"+
        "CAST(json_extract(j.value,'$.qty') AS INTEGER) FROM json_each(?) j"
      ).bind(eventId,carId,raw),
      db.prepare(
        'INSERT INTO vehicle_stock(vehicle_id,part_id,quantity,updated_at) '+
        "SELECT ?,json_extract(j.value,'$.id'),"+
        "CAST(json_extract(j.value,'$.qty') AS INTEGER),CURRENT_TIMESTAMP "+
        'FROM json_each(?) j WHERE 1=1 '+
        'ON CONFLICT(vehicle_id,part_id) DO UPDATE SET quantity=excluded.quantity,'+
        'updated_at=CURRENT_TIMESTAMP'
      ).bind(carId,raw)
    );
  }
  stmts.push(
    db.prepare(
      "UPDATE fr_car_claims SET status='APPROVED',requested_plate=?,"+
      "resolved_by=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP "+
      "WHERE user_id=? AND status='PENDING'"
    ).bind(newPlate,actorId,userId),
    db.prepare(
      'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
      'VALUES(?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(),actorId,correcting?'CAR_CORRECT':'CAR_APPROVE',
      'USER',userId,JSON.stringify({from:claim.requested_plate,to:newPlate,
        inventory:!!snapshot,previousCrew:owner?.name||''}))
  );
  await db.batch(stmts);
  return {ok:true,plate:newPlate,message:
    (correcting?'Poprawiono numer i przypisano samochód.':'Zatwierdzono samochód.')+
    (snapshot?' Zapisano również inwentaryzację.':'')};
}
