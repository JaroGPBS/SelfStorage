// GPBS Storage FR: D1-only mobile gateway. Never reads Google Sheets / Apps Script.
// The signed D1 PIN cookie is issued by /api/pl/auth; FR-only crews use it here.
import {verifyWorkerSession,workerJson} from '../../lib/pl-worker-auth.js';
import {getVehicleCatalogue} from '../../lib/vehicle-catalogue-service.js';
import {ensureFrCarClaims,normalPlate} from '../../lib/fr-car-claims.js';

const fail=(message,status=400)=>workerJson({ok:false,error:message},status);
const clean=value=>String(value||'').trim();
const plate=value=>clean(value).toUpperCase().replace(/\s+/g,'');
const positive=n=>Number.isSafeInteger(n)&&n>0;
const uuid=()=>crypto.randomUUID();
const entryCode=value=>clean(value).toUpperCase();
const validId=value=>typeof value==='string'&&value.length>=8&&value.length<=120&&/^[A-Za-z0-9_-]+$/.test(value);

async function ready(db){
  const r=await db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ("+
    "'fr_warehouse_qr','fr_vehicle_usage','fr_visits','fr_sessions','fr_session_lines',"+
    "'fr_vehicle_events','fr_vehicle_event_lines','fr_vehicle_event_fingerprints','vehicle_stock','vehicles')"
  ).first();
  return Number(r?.n)===10;
}
// Non-destructive first-use bootstrap. Never updates existing warehouse quantities.
async function ensureSchema(db){
  if(await ready(db))return;
  const ddl=[
    "CREATE TABLE IF NOT EXISTS vehicles ("+
      "id TEXT PRIMARY KEY,registration_number TEXT NOT NULL UNIQUE COLLATE NOCASE,"+
      "active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),"+
      "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS vehicle_stock ("+
      "vehicle_id TEXT NOT NULL,part_id TEXT NOT NULL,"+
      "quantity INTEGER NOT NULL CHECK(quantity>=0),"+
      "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"+
      "PRIMARY KEY(vehicle_id,part_id),"+
      "FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),"+
      "FOREIGN KEY(part_id) REFERENCES parts(id))",
    "CREATE TABLE IF NOT EXISTS fr_warehouse_qr ("+
      "warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),"+
      "code TEXT NOT NULL UNIQUE)",
    "CREATE TABLE IF NOT EXISTS fr_vehicle_usage ("+
      "user_id TEXT PRIMARY KEY REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES vehicles(id),"+
      "assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE INDEX IF NOT EXISTS idx_fr_vehicle_usage_vehicle ON fr_vehicle_usage(vehicle_id)",
    "CREATE TABLE IF NOT EXISTS fr_visits ("+
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES vehicles(id),"+
      "warehouse_id TEXT NOT NULL REFERENCES warehouses(id),"+
      "started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT,"+
      "status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED')))",
    "CREATE INDEX IF NOT EXISTS idx_fr_visits_user ON fr_visits(user_id,started_at)",
    "CREATE INDEX IF NOT EXISTS idx_fr_visits_warehouse ON fr_visits(warehouse_id,started_at)",
    "CREATE TABLE IF NOT EXISTS fr_sessions ("+
      "id TEXT PRIMARY KEY,visit_id TEXT NOT NULL REFERENCES fr_visits(id),"+
      "user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES vehicles(id),"+
      "warehouse_id TEXT NOT NULL REFERENCES warehouses(id),"+
      "content_hash TEXT NOT NULL,comment TEXT,"+
      "saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE INDEX IF NOT EXISTS idx_fr_sessions_warehouse ON fr_sessions(warehouse_id,saved_at)",
    "CREATE TABLE IF NOT EXISTS fr_session_lines ("+
      "session_id TEXT NOT NULL REFERENCES fr_sessions(id),"+
      "direction TEXT NOT NULL CHECK(direction IN ('POBRANIE','ZWROT')),"+
      "part_id TEXT NOT NULL REFERENCES parts(id),"+
      "quantity INTEGER NOT NULL CHECK(quantity>0),"+
      "PRIMARY KEY(session_id,direction,part_id))",
    "CREATE INDEX IF NOT EXISTS idx_fr_session_lines_part ON fr_session_lines(part_id)",
    "CREATE TABLE IF NOT EXISTS fr_vehicle_events ("+
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),"+
      "vehicle_id TEXT NOT NULL REFERENCES vehicles(id),"+
      "type TEXT NOT NULL CHECK(type IN ('INWENTARYZACJA','RECZNA')),"+
      "event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS fr_vehicle_event_lines ("+
      "event_id TEXT NOT NULL REFERENCES fr_vehicle_events(id),"+
      "part_id TEXT NOT NULL REFERENCES parts(id),"+
      "quantity_before INTEGER,quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),"+
      "PRIMARY KEY(event_id,part_id))",
    "CREATE TABLE IF NOT EXISTS fr_vehicle_event_fingerprints ("+
      "event_id TEXT PRIMARY KEY REFERENCES fr_vehicle_events(id),"+
      "content_hash TEXT NOT NULL)"
  ];
  for(const sql of ddl)await db.prepare(sql).run();
  await db.prepare(
    "INSERT INTO fr_warehouse_qr(warehouse_id,code) VALUES "+
    "('FR-TOULOUSE','MAG-TL7A2Q'),('FR-PARIS','MAG-PA5A4B') "+
    "ON CONFLICT(warehouse_id) DO NOTHING"
  ).run();
  if(!await ready(db))throw Error('Nie udało się przygotować tabel francuskich w D1.');
}

async function vehicle(db,userId){
  return db.prepare(
    'SELECT v.id,v.registration_number FROM fr_vehicle_usage a '+
    'JOIN vehicles v ON v.id=a.vehicle_id WHERE a.user_id=? AND v.active=1'
  ).bind(userId).first();
}
async function parts(db){
  const staged=!!await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_stock_import_20261107'"
  ).first();
  const indexed=!!await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
  ).first();
  const sql='SELECT p.id,p.name,p.part_number,p.sap_number,'+
    (staged?'s.source_code':'NULL AS source_code')+','+
    (indexed?'ix.old_index,ix.new_index':'NULL AS old_index,NULL AS new_index')+
    ' FROM parts p '+
    (staged?'LEFT JOIN fr_stock_import_20261107 s ON s.part_id=p.id ':'')+
    (indexed?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
    ' WHERE p.active=1 ORDER BY p.name COLLATE NOCASE LIMIT 3000';
  return (await db.prepare(sql).all()).results||[];
}
function codeForPart(p){return p.source_code||p.old_index||p.new_index||p.part_number||p.id;}
async function resolveParts(db,items){
  const catalogue=await parts(db);
  const mapping=new Map();
  for(const p of catalogue){
    for(const code of [p.id,p.part_number,p.sap_number,p.source_code,p.old_index,p.new_index]){
      if(!code)continue;
      const key=entryCode(code);
      if(mapping.has(key)&&mapping.get(key).id!==p.id)
        mapping.set(key,null); // Refuse ambiguous codes.
      else if(!mapping.has(key))mapping.set(key,p);
    }
  }
  const result=new Map();
  for(const item of items){
    const code=entryCode(item?.kod||item?.code||item?.indexQr);
    const qty=Number(item?.ilosc??item?.qty);
    if(!code||!positive(qty))throw Error('Sprawdź kod części i ilość.');
    const p=mapping.get(code);
    if(!p)throw Error('Nieznana lub niejednoznaczna część: '+code);
    result.set(p.id,{part:p,qty:(result.get(p.id)?.qty||0)+qty});
  }
  return result;
}
async function fingerprint(data){
  const encoded=new TextEncoder().encode(JSON.stringify(data));
  const digest=await crypto.subtle.digest('SHA-256',encoded);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
// Assign the vehicle directly to the crew after PIN login. The vehicle (not
// the crew) owns its stock, so multiple crews may use the same registration.
// No Admin approval or inventory is required just to record a plate.
async function assignVehicle(db,user,value){
  const number=normalPlate(value);
  if(!number)throw Error('Podaj poprawny numer rejestracyjny samochodu.');
  const own=await vehicle(db,user.id);
  if(own?.registration_number===number){
    await db.prepare(
      "DELETE FROM fr_car_claims WHERE user_id=? AND status='PENDING'"
    ).bind(user.id).run();
    return {id:own.id,registration_number:number,wymagaZatwierdzenia:false};
  }
  if(own){
    const active=await db.prepare(
      "SELECT 1 FROM fr_visits WHERE user_id=? AND status='ACTIVE' LIMIT 1"
    ).bind(user.id).first();
    if(active)throw Error('Najpierw zakończ aktualną wizytę przed zmianą samochodu.');
  }
  const existing=await db.prepare(
    'SELECT id,active FROM vehicles WHERE registration_number=? COLLATE NOCASE'
  ).bind(number).first();
  if(existing&&Number(existing.active)===0)
    throw Error('Ten samochód jest nieaktywny. Skontaktuj się z administratorem.');
  if(!existing){
    await db.prepare(
      'INSERT OR IGNORE INTO vehicles(id,registration_number,active) VALUES(?,?,1)'
    ).bind('GPBS-V-'+uuid(),number).run();
  }
  const found=await db.prepare(
    'SELECT id FROM vehicles WHERE registration_number=? COLLATE NOCASE AND active=1'
  ).bind(number).first();
  if(!found)throw Error('Nie udało się zapisać samochodu.');
  await db.batch([
    db.prepare(
      'INSERT INTO fr_vehicle_usage(user_id,vehicle_id,assigned_at) VALUES(?,?,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(user_id) DO UPDATE SET vehicle_id=excluded.vehicle_id,assigned_at=CURRENT_TIMESTAMP'
    ).bind(user.id,found.id),
    db.prepare(
      "DELETE FROM fr_car_claims WHERE user_id=? AND status='PENDING'"
    ).bind(user.id)
  ]);
  return {id:found.id,registration_number:number,wymagaZatwierdzenia:false};
}
async function startVisit(db,user,data){
  const id=clean(data.idWizyty)||'WIZ-'+uuid();
  if(!validId(id))throw Error('Nieprawidłowy identyfikator wizyty.');
  const qr=entryCode(data.kodMagazynu);
  const matches=(await db.prepare(
    "SELECT q.warehouse_id,w.name FROM fr_warehouse_qr q JOIN warehouses w "+
    "ON w.id=q.warehouse_id WHERE q.code=? AND w.country_code='FR' AND w.active=1"
  ).bind(qr).all()).results||[];
  if(matches.length!==1)throw Error('Nieznany lub nieaktywny kod magazynu.');
  const car=await vehicle(db,user.id);
  if(!car)throw Error('Najpierw wpisz numer rejestracyjny samochodu.');
  const warehouse=matches[0];
  const found=await db.prepare('SELECT * FROM fr_visits WHERE id=?').bind(id).first();
  if(found){
    if(found.user_id!==user.id||found.warehouse_id!==warehouse.warehouse_id||
       found.vehicle_id!==car.id)throw Error('Konflikt identyfikatora wizyty.');
    return {ok:true,duplicate:true,idWizyty:id,status:found.status==='ACTIVE'?'AKTYWNA':'ZAKOŃCZONA',
      magazyn:{id:warehouse.warehouse_id,nazwa:warehouse.name,kodQr:qr},start:found.started_at};
  }
  await db.prepare(
    'INSERT INTO fr_visits(id,user_id,vehicle_id,warehouse_id) VALUES(?,?,?,?)'
  ).bind(id,user.id,car.id,warehouse.warehouse_id).run();
  return {ok:true,idWizyty:id,status:'AKTYWNA',start:new Date().toISOString(),
    magazyn:{id:warehouse.warehouse_id,nazwa:warehouse.name,kodQr:qr}};
}
async function endVisit(db,user,data){
  const id=clean(data.idWizyty);
  if(!validId(id))throw Error('Nieprawidłowa wizyta.');
  const visit=await db.prepare('SELECT user_id,status FROM fr_visits WHERE id=?').bind(id).first();
  if(!visit||visit.user_id!==user.id)throw Error('Nie znaleziono wizyty ekipy.');
  if(visit.status==='ENDED')return {ok:true,duplicate:true,idWizyty:id,status:'ZAKOŃCZONA'};
  await db.prepare(
    "UPDATE fr_visits SET status='ENDED',ended_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='ACTIVE'"
  ).bind(id,user.id).run();
  return {ok:true,idWizyty:id,status:'ZAKOŃCZONA'};
}
async function saveSession(db,user,data){
  const sessionId=clean(data.idSesji),visitId=clean(data.idWizyty);
  if(!validId(sessionId)||!validId(visitId))throw Error('Nieprawidłowa sesja lub wizyta.');
  const visit=await db.prepare('SELECT * FROM fr_visits WHERE id=?').bind(visitId).first();
  if(!visit||visit.user_id!==user.id||visit.status!=='ACTIVE')
    throw Error('Wizyta nie jest aktywna.');
  if(visit.warehouse_id!==clean(data.idMagazynu))throw Error('Nieprawidłowy magazyn.');
  const activeCar=await vehicle(db,user.id);
  if(!activeCar||activeCar.id!==visit.vehicle_id)throw Error('Samochód zmienił się w trakcie wizyty. Sprawdź przypisanie.');
  const pob=await resolveParts(db,data.pobranie||[]);
  const zwr=await resolveParts(db,data.zwrot||[]);
  if(!pob.size&&!zwr.size)throw Error('Brak części do zapisania.');
  const serial=m=>[...m.entries()].map(([id,x])=>[id,x.qty]).sort((a,b)=>a[0].localeCompare(b[0]));
  const hash=await fingerprint({visitId,pob:serial(pob),zwr:serial(zwr),comment:clean(data.komentarz)});
  const old=await db.prepare('SELECT content_hash FROM fr_sessions WHERE id=?').bind(sessionId).first();
  if(old){
    if(old.content_hash!==hash)throw Error('Sesja była zapisana z inną zawartością.');
    return {ok:true,duplicate:true,idSesji:sessionId,status:'ZAPISANA'};
  }
  const deltas=new Map();
  for(const [id,x] of pob)deltas.set(id,(deltas.get(id)||0)-x.qty);
  for(const [id,x] of zwr)deltas.set(id,(deltas.get(id)||0)+x.qty);
  for(const [id,delta] of deltas){
    if(delta>=0)continue;
    const stock=await db.prepare(
      'SELECT quantity FROM warehouse_stock WHERE warehouse_id=? AND part_id=?'
    ).bind(visit.warehouse_id,id).first();
    if(!stock||Number(stock.quantity)<-delta)
      throw Error('Za mało części w magazynie. Sprawdź stany przed zatwierdzeniem.');
  }
  const vehiclePartIds=new Set((await getVehicleCatalogue(db)).parts.filter(p=>p.id).map(p=>p.id));
  const statements=[
    db.prepare(
      'INSERT INTO fr_sessions(id,visit_id,user_id,vehicle_id,warehouse_id,content_hash,comment) '+
      'VALUES(?,?,?,?,?,?,?)'
    ).bind(sessionId,visitId,user.id,visit.vehicle_id,visit.warehouse_id,hash,clean(data.komentarz))
  ];
  for(const [direction,items] of [['POBRANIE',pob],['ZWROT',zwr]]){
    for(const [id,x] of items)
      statements.push(db.prepare(
        'INSERT INTO fr_session_lines(session_id,direction,part_id,quantity) VALUES(?,?,?,?)'
      ).bind(sessionId,direction,id,x.qty));
  }
  for(const [id,delta] of deltas){
    if(delta===0)continue;
    if(delta<0){
      // SQLite checks the INSERT candidate even on an UPSERT conflict.
      // Use a valid zero candidate; fail if the existing row disappears.
      statements.push(db.prepare(
        'INSERT INTO warehouse_stock(warehouse_id,part_id,quantity,updated_at) '+
        'VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM warehouse_stock '+
        'WHERE warehouse_id=? AND part_id=?) THEN 0 ELSE -1 END,CURRENT_TIMESTAMP) '+
        'ON CONFLICT(warehouse_id,part_id) DO UPDATE SET '+
        'quantity=warehouse_stock.quantity+?,updated_at=CURRENT_TIMESTAMP'
      ).bind(visit.warehouse_id,id,visit.warehouse_id,id,delta));
    }else{
      statements.push(db.prepare(
        'INSERT INTO warehouse_stock(warehouse_id,part_id,quantity,updated_at) '+
        'VALUES(?,?,?,CURRENT_TIMESTAMP) '+
        'ON CONFLICT(warehouse_id,part_id) DO UPDATE SET '+
        'quantity=warehouse_stock.quantity+excluded.quantity,updated_at=CURRENT_TIMESTAMP'
      ).bind(visit.warehouse_id,id,delta));
    }
    // Only parts belonging to the vehicle catalogue change the car balance.
    if(vehiclePartIds.has(id))statements.push(db.prepare(
      'INSERT INTO vehicle_stock(vehicle_id,part_id,quantity,updated_at) '+
      'VALUES(?,?,MAX(0,?),CURRENT_TIMESTAMP) '+
      'ON CONFLICT(vehicle_id,part_id) DO UPDATE SET '+
      'quantity=MAX(0,vehicle_stock.quantity+?),updated_at=CURRENT_TIMESTAMP'
    ).bind(visit.vehicle_id,id,-delta,-delta));
  }
  await db.batch(statements);
  return {ok:true,idSesji:sessionId,idWizyty:visitId,status:'ZAPISANA'};
}
async function vehicleStock(db,user){
  const car=await vehicle(db,user.id);
  if(!car)throw Error('Najpierw przypisz samochód.');
  const catalogue=await getVehicleCatalogue(db);
  const balances=(await db.prepare(
    'SELECT part_id,quantity FROM vehicle_stock WHERE vehicle_id=?'
  ).bind(car.id).all()).results||[];
  const stock=new Map(balances.map(row=>[row.part_id,Number(row.quantity)]));
  const last=await db.prepare(
    "SELECT MAX(event_at) AS last_at FROM fr_vehicle_events "+
    "WHERE vehicle_id=? AND user_id=? AND type='INWENTARYZACJA'"
  ).bind(car.id,user.id).first();
  const lastAt=last?.last_at||'';
  const inventoryDone=Boolean(lastAt);
  return {ok:true,ekipa:{id:user.id,nazwa:user.nickname},
    samochod:car.registration_number,
    oczekujeNaZatwierdzenie:false,inwentaryzacjaWykonana:inventoryDone,
    ostatniaInwentaryzacja:lastAt,
    czesci:catalogue.parts.filter((x,i,all)=>x.id&&all.findIndex(p=>p.id===x.id)===i).map(x=>({
      kod:x.source_code||x.old_index||x.part_number||x.id,
      numerIndeksu:x.part_number||'',nazwa:x.name,
      stanDocelowy:x.required_quantity,
      stanAktualny:stock.has(x.id)?stock.get(x.id):(inventoryDone?0:null),
      wymagany:Number(x.required_quantity)>0
    }))};
}
async function updateVehicleStock(db,user,data){
  const car=await vehicle(db,user.id);
  if(!car)throw Error('Najpierw przypisz samochód.');
  const eventId=clean(data.idZmiany);
  if(!validId(eventId))throw Error('Brak identyfikatora zmiany.');
  const inventory=entryCode(data.typZmiany).includes('INWENT');
  const changes=Array.isArray(data.zmiany)?data.zmiany:[];
  if(!changes.length||changes.length>1000)throw Error('Brak poprawnej listy części.');
  const catalogue=await parts(db);
  const map=new Map();
  for(const p of catalogue)
    for(const x of [p.id,p.source_code,p.old_index,p.new_index,p.part_number,p.sap_number])
      if(x&&!map.has(entryCode(x)))map.set(entryCode(x),p.id);
  const allowed=new Set((await getVehicleCatalogue(db)).parts.filter(p=>p.id).map(p=>p.id));
  const byId=new Map();
  for(const row of changes){
    const id=map.get(entryCode(row.kod));
    if(!id||!allowed.has(id)||byId.has(id))throw Error('Nieznana część samochodowa lub powtórzona pozycja.');
    const absolute=row.stan!==undefined;
    const value=Number(absolute?row.stan:row.delta);
    if(!Number.isSafeInteger(value)||(absolute&&value<0)||(!absolute&&value===0))
      throw Error('Nieprawidłowa ilość części.');
    byId.set(id,{absolute,value});
  }
  const hash=await fingerprint({car:car.id,inventory,
    changes:[...byId.entries()].map(([id,v])=>[id,v.absolute,v.value])
      .sort((a,b)=>a[0].localeCompare(b[0]))});
  const previous=await db.prepare(
    'SELECT f.content_hash FROM fr_vehicle_event_fingerprints f WHERE f.event_id=?'
  ).bind(eventId).first();
  if(previous){
    if(previous.content_hash!==hash)
      throw Error('Operacja została wcześniej zapisana z inną zawartością.');
    return {ok:true,duplicate:true};
  }
  const statements=[db.prepare(
    'INSERT INTO fr_vehicle_events(id,user_id,vehicle_id,type) VALUES(?,?,?,?)'
  ).bind(eventId,user.id,car.id,inventory?'INWENTARYZACJA':'RECZNA'),
    db.prepare(
      'INSERT INTO fr_vehicle_event_fingerprints(event_id,content_hash) VALUES(?,?)'
    ).bind(eventId,hash)];
  for(const [id,x] of byId){
    const current=await db.prepare(
      'SELECT quantity FROM vehicle_stock WHERE vehicle_id=? AND part_id=?'
    ).bind(car.id,id).first();
    const before=current?Number(current.quantity):null;
    const after=x.absolute?x.value:Math.max(0,Number(before||0)+x.value);
    statements.push(db.prepare(
      'INSERT INTO fr_vehicle_event_lines(event_id,part_id,quantity_before,quantity_after) VALUES(?,?,?,?)'
    ).bind(eventId,id,before,after));
    statements.push(db.prepare(
      'INSERT INTO vehicle_stock(vehicle_id,part_id,quantity,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(vehicle_id,part_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP'
    ).bind(car.id,id,after));
  }
  await db.batch(statements);
  return {ok:true,inwentaryzacjaWykonana:inventory?true:undefined,
    ostatniaInwentaryzacja:inventory?new Date().toISOString():undefined};
}
async function action(db,user,body){
  const type=entryCode(body.action),data=body.payload||{};
  if(type==='LOGIN'){
    const car=await vehicle(db,user.id);
    return {ok:true,ekipa:{id:user.id,nazwa:user.nickname,rola:user.role},
      samochod:car?.registration_number||''};
  }
  if(type==='POBIERZ_DANE_STARTOWE'){
    const catalog=await parts(db);
    const car=await vehicle(db,user.id);
    return {ok:true,ekipa:{id:user.id,nazwa:user.nickname,rola:user.role},
      samochod:car?.registration_number||'',
      czesci:catalog.map(p=>({kod:codeForPart(p),nazwa:p.name})),
      magazyny:(await db.prepare(
        "SELECT w.id,w.name,q.code FROM fr_warehouse_qr q JOIN warehouses w ON w.id=q.warehouse_id "+
        "WHERE w.country_code='FR' AND w.active=1"
      ).all()).results.map(w=>({id:w.id,nazwa:w.name,kodQr:w.code,aktywny:true,gotowy:true})),
      ustawienia:{logowanieOfflineDni:0,autoSynchronizacja:true,whatsappAlert:false}};
  }
  if(type==='USTAW_SAMOCHOD')return {ok:true,samochod:await assignVehicle(db,user,data.numerRejestracyjny)};
  if(type==='SKAN_MAGAZYNU')return startVisit(db,user,data);
  if(type==='ZAKONCZ_WIZYTE')return endVisit(db,user,data);
  if(type==='ZAPISZ_SESJE')return saveSession(db,user,data);
  if(type==='POBIERZ_STAN_AUTA')return vehicleStock(db,user);
  if(type==='SPRAWDZ_SYNC_AUTA'){
    const car=await vehicle(db,user.id);
    return {ok:true,wersjaStanu:0,wersjaListy:'D1',samochod:car?.registration_number||''};
  }
  if(type==='AKTUALIZUJ_STAN_AUTA')return updateVehicleStock(db,user,data);
  if(type==='PING')return {ok:true,service:'FR-D1'};
  throw Error('Nieznana operacja.');
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  if(!env?.DB)return fail('Baza D1 jest niedostępna.',503);
  let body;
  try{
    const text=await request.text();
    if(text.length>65000)return fail('Zbyt duża operacja.',413);
    body=JSON.parse(text);
    if(!body||typeof body!=='object'||Array.isArray(body))return fail('Błędne dane.',400);
  }catch{return fail('Błędne dane JSON.',400);}
  try{
    const user=await verifyWorkerSession(request,env);
    if(!user||!user.apps?.mobile||!user.markets?.FR||user.role!=='EKIPA')
      return fail('Brak dostępu do francuskiego magazynu. Zaloguj się ponownie.',401);
    await ensureSchema(env.DB);
    await ensureFrCarClaims(env.DB);
    return workerJson(await action(env.DB,user,body));
  }catch(err){
    console.error('FR D1 action failed',err?.name||'Error');
    const msg=String(err?.message||'Nie udało się zapisać operacji.');
    if(/constraint|foreign key|not null|UNIQUE/i.test(msg))
      return fail('Nie zapisano operacji. Sprawdź stan części i spróbuj ponownie.',409);
    return fail(msg,400);
  }
}
