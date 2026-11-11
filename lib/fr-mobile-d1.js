// GPBS Storage FR: D1 replacement for the former Google Apps Script action API.
// Keep the existing mobile action names and response fields. No Google writes.
import {
  workerAuthReady, workerCookie, createWorkerSession, verifyWorkerSession,
  loadActiveWorker, workerJson
} from './pl-worker-auth.js';
import {getVehicleCatalogue} from './vehicle-catalogue-service.js';

const enc=new TextEncoder();
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toUpperCase();
const plate=v=>norm(v).replace(/\s+/g,'');
const fail=(msg,status=400)=>workerJson({ok:false,error:msg},status);
const ok=(body,headers={})=>workerJson({ok:true,...body},200,headers);
const idOk=v=>/^[a-zA-Z0-9_-]{4,100}$/.test(clean(v));
const qtyOk=v=>Number.isSafeInteger(Number(v))&&Number(v)>0&&Number(v)<=100000;
let schemaReady=null;

async function hasTable(db,name){
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
}
async function ensureSchema(db){
  if(schemaReady)return schemaReady;
  schemaReady=(async()=>{
    // Existing vehicle tables remain compatible with db/02; never overwrite balances.
    const sql=[
      'CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY,registration_number TEXT NOT NULL UNIQUE COLLATE NOCASE,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS vehicle_stock (vehicle_id TEXT NOT NULL REFERENCES vehicles(id),part_id TEXT NOT NULL REFERENCES parts(id),quantity INTEGER NOT NULL CHECK(quantity>=0),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(vehicle_id,part_id))',
      'CREATE TABLE IF NOT EXISTS fr_mobile_test_users (user_id TEXT PRIMARY KEY REFERENCES users(id))',
      'CREATE TABLE IF NOT EXISTS fr_mobile_scan_codes (warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),scan_code TEXT NOT NULL UNIQUE COLLATE NOCASE)',
      'CREATE TABLE IF NOT EXISTS fr_mobile_vehicle_links (user_id TEXT PRIMARY KEY REFERENCES users(id),vehicle_id TEXT NOT NULL REFERENCES vehicles(id),linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE UNIQUE INDEX IF NOT EXISTS fr_mobile_vehicle_link_unique ON fr_mobile_vehicle_links(vehicle_id)',
      "CREATE TABLE IF NOT EXISTS fr_mobile_visits (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),vehicle_id TEXT REFERENCES vehicles(id),started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT,status TEXT NOT NULL DEFAULT 'AKTYWNA' CHECK(status IN ('AKTYWNA','ZAKONCZONA')))",
      'CREATE INDEX IF NOT EXISTS fr_mobile_visits_user ON fr_mobile_visits(user_id,started_at)',
      'CREATE TABLE IF NOT EXISTS fr_mobile_sessions (id TEXT PRIMARY KEY,visit_id TEXT NOT NULL REFERENCES fr_mobile_visits(id),user_id TEXT NOT NULL REFERENCES users(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),vehicle_id TEXT REFERENCES vehicles(id),fingerprint TEXT NOT NULL,comment TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE INDEX IF NOT EXISTS fr_mobile_sessions_visit ON fr_mobile_sessions(visit_id,created_at)',
      'CREATE TABLE IF NOT EXISTS fr_mobile_stock_effects (session_id TEXT NOT NULL REFERENCES fr_mobile_sessions(id),location_type TEXT NOT NULL CHECK(location_type IN (\'WAREHOUSE\',\'VEHICLE\')),location_id TEXT NOT NULL,part_id TEXT NOT NULL REFERENCES parts(id),applied_delta INTEGER NOT NULL,PRIMARY KEY(session_id,location_type,location_id,part_id))',
      "CREATE TABLE IF NOT EXISTS fr_mobile_session_lines (session_id TEXT NOT NULL REFERENCES fr_mobile_sessions(id),direction TEXT NOT NULL CHECK(direction IN ('POBRANIE','ZWROT')),part_id TEXT NOT NULL REFERENCES parts(id),quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(session_id,direction,part_id))",
      'CREATE TABLE IF NOT EXISTS fr_mobile_vehicle_versions (vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id),version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_inventory_at TEXT)',
      'CREATE TABLE IF NOT EXISTS fr_mobile_vehicle_events (id TEXT PRIMARY KEY,vehicle_id TEXT NOT NULL REFERENCES vehicles(id),user_id TEXT NOT NULL REFERENCES users(id),event_type TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    ];
    for(const query of sql)await db.prepare(query).run();
    // Reuse the two physical QR codes; do not touch warehouse_stock or old history.
    for(const [id,code] of [['FR-TOULOUSE','MAG-TL7A2Q'],['FR-PARIS','MAG-PA5A4B']]){
      await db.prepare(
        'INSERT OR IGNORE INTO fr_mobile_scan_codes(warehouse_id,scan_code) '+
        'SELECT id,? FROM warehouses WHERE id=? AND active=1 AND country_code=?'
      ).bind(code,id,'FR').run();
    }
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}
async function digestPin(pepper,pin){
  const key=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,enc.encode('GPBS:D1:PIN:v1:'+pin));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256(v){
  const bytes=await crypto.subtle.digest('SHA-256',enc.encode(v));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function checkLoginLimit(request,env){
  const ip=clean(request.headers.get('CF-Connecting-IP'));
  if(!ip||ip.length>64)return 'Nie można zweryfikować połączenia.';
  if(!await hasTable(env.DB,'pl_login_rate_limits'))return 'Brak tabeli limitów logowania D1.';
  const now=Math.floor(Date.now()/1000);
  const identifier='fr:'+await sha256(env.PANEL_SESSION_SECRET+':'+ip);
  for(const [key,max] of [['global:fr-worker-v1',60],[identifier,7]]){
    const row=await env.DB.prepare(
      'INSERT INTO pl_login_rate_limits(identifier,attempts,window_expires,locked_until,updated_at) '+
      'VALUES (?,1,?,0,?) ON CONFLICT(identifier) DO UPDATE SET '+
      'attempts=CASE WHEN window_expires<=? THEN 1 ELSE attempts+1 END,'+
      'window_expires=CASE WHEN window_expires<=? THEN excluded.window_expires ELSE window_expires END,'+
      'locked_until=CASE WHEN locked_until>? THEN locked_until WHEN window_expires<=? THEN 0 '+
      'WHEN attempts+1>? THEN ? ELSE 0 END,updated_at=excluded.updated_at '+
      'RETURNING locked_until'
    ).bind(key,now+900,now,now,now,now,now,max,now+900).first();
    if(Number(row?.locked_until||0)>now)return 'Zbyt wiele prób logowania. Spróbuj później.';
  }
  return '';
}
async function login(request,env,p){
  const limit=await checkLoginLimit(request,env);
  if(limit)return fail(limit,limit.includes('prób')?429:503);
  const pin=clean(p.pin);
  if(!/^\d{4}$/.test(pin))return fail('Wpisz czterocyfrowy PIN.');
  const hash=await digestPin(env.PIN_PEPPER,pin);
  const row=await env.DB.prepare('SELECT user_id FROM user_pin_credentials WHERE pin_digest=? LIMIT 1').bind(hash).first();
  if(!row)return fail('Nieprawidłowy PIN lub brak dostępu.',401);
  const user=await loadActiveWorker(env,row.user_id);
  if(!user||!user.markets.FR||!['EKIPA','ADMIN','KOORDYNATOR','KIEROWNIK'].includes(user.role))
    return fail('Nieprawidłowy PIN lub brak dostępu.',401);
  const reg=plate(p.rejestracja||p.registration||p.plate);
  if(user.role==='EKIPA'&&!/^[A-Z0-9-]{2,20}$/.test(reg))
    return fail('Podaj numer rejestracyjny samochodu (bez spacji).');
  if(reg){
    if(!/^[A-Z0-9-]{2,20}$/.test(reg))return fail('Nieprawidłowy numer rejestracyjny.');
    let car=await env.DB.prepare('SELECT id FROM vehicles WHERE registration_number=? COLLATE NOCASE').bind(reg).first();
    if(!car){
      const vehicleId='GPBS-V-'+crypto.randomUUID();
      await env.DB.prepare('INSERT OR IGNORE INTO vehicles(id,registration_number,active) VALUES (?,?,1)').bind(vehicleId,reg).run();
      car=await env.DB.prepare('SELECT id FROM vehicles WHERE registration_number=? COLLATE NOCASE').bind(reg).first();
    }
    if(!car)return fail('Nie udało się przypisać samochodu.',503);
    // Last crew that logs into a plate becomes its current user automatically.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM fr_mobile_vehicle_links WHERE vehicle_id=? OR user_id=?').bind(car.id,user.id),
      env.DB.prepare('INSERT INTO fr_mobile_vehicle_links(user_id,vehicle_id) VALUES (?,?)').bind(user.id,car.id)
    ]);
    await env.DB.prepare('INSERT OR IGNORE INTO fr_mobile_vehicle_versions(vehicle_id) VALUES (?)').bind(car.id).run();
  }
  const active=await loadActiveWorker(env,user.id);
  if(!active)return fail('Nie można potwierdzić konta.',401);
  const token=await createWorkerSession(env,active);
  return ok({ekipa:{id:user.id,nazwa:user.nickname,rola:user.role,rejestracja:reg},apiVersion:6},
    {'Set-Cookie':workerCookie(token)});
}
async function getVehicle(db,userId){
  const row=await db.prepare(
    'SELECT v.id,v.registration_number FROM fr_mobile_vehicle_links a '+
    'JOIN vehicles v ON v.id=a.vehicle_id WHERE a.user_id=? AND v.active=1'
  ).bind(userId).first();
  return row||null;
}
async function getScanWarehouses(db){
  return (await db.prepare(
    'SELECT w.id,w.name,c.scan_code FROM fr_mobile_scan_codes c '+
    'JOIN warehouses w ON w.id=c.warehouse_id WHERE w.active=1 AND w.country_code=? ORDER BY w.name'
  ).bind('FR').all()).results||[];
}
async function partCatalogue(db){
  const aliases=await hasTable(db,'pl_part_index_migrations');
  const staging=await hasTable(db,'fr_stock_import_20261107');
  const query='SELECT p.id,p.name,p.part_number,p.sap_number'+
    (aliases?',ix.old_index,ix.new_index':",' ' AS old_index,'' AS new_index")+
    (staging?',s.source_code':",' ' AS source_code")+
    ' FROM parts p '+
    (aliases?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
    (staging?'LEFT JOIN fr_stock_import_20261107 s ON s.part_id=p.id ':'')+
    'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE LIMIT 3000';
  const rows=(await db.prepare(query).all()).results||[];
  return rows.map(r=>({
    id:r.id,nazwa:r.name,kod:clean(r.new_index)||clean(r.part_number)||clean(r.old_index)||r.id,
    aliases:[r.id,r.part_number,r.sap_number,r.old_index,r.new_index,r.source_code]
      .map(norm).filter(Boolean)
  }));
}
function partResolver(parts){
  const map=new Map();
  for(const part of parts)for(const alias of [part.kod,...part.aliases]){
    const key=norm(alias);
    if(!key)continue;
    if(map.has(key)&&map.get(key)?.id!==part.id)map.set(key,null);
    else if(!map.has(key))map.set(key,part);
  }
  return map;
}
async function startData(env,user){
  const [parts,warehouses]=await Promise.all([partCatalogue(env.DB),getScanWarehouses(env.DB)]);
  return ok({ekipa:{id:user.id,nazwa:user.nickname,rola:user.role},
    czesci:parts.map(p=>({kod:p.kod,nazwa:p.nazwa,aliases:p.aliases})),
    magazyny:warehouses.map(w=>({id:w.id,nazwa:w.name,kodQr:w.scan_code,aktywny:true,gotowy:true})),
    ustawienia:{logowanieOfflineDni:0,autoSynchronizacja:true,whatsappAlert:false,whatsappStartWizyty:false},
    apiVersion:6,serverTime:new Date().toISOString()});
}
async function visitStart(env,user,p){
  const code=norm(p.kodMagazynu||p.kodQr||p.qr);
  const id=clean(p.idWizyty);
  if(!idOk(id))return fail('Nieprawidłowy numer wizyty.');
  const warehouse=await env.DB.prepare(
    'SELECT w.id,w.name,c.scan_code FROM fr_mobile_scan_codes c JOIN warehouses w ON w.id=c.warehouse_id '+
    'WHERE c.scan_code=? COLLATE NOCASE AND w.active=1 AND w.country_code=?'
  ).bind(code,'FR').first();
  if(!warehouse)return fail('Nieznany lub nieaktywny kod magazynu.');
  const car=await getVehicle(env.DB,user.id);
  if(user.role==='EKIPA'&&!car)return fail('Zaloguj się ponownie z numerem rejestracyjnym samochodu.');
  const prev=await env.DB.prepare('SELECT id,user_id,warehouse_id,vehicle_id,status,started_at FROM fr_mobile_visits WHERE id=?').bind(id).first();
  if(prev&&(prev.user_id!==user.id||prev.warehouse_id!==warehouse.id||prev.vehicle_id!==(car?.id||null)))
    return fail('Ten numer wizyty należy do innej ekipy, auta lub magazynu.',409);
  if(!prev)await env.DB.prepare(
    'INSERT INTO fr_mobile_visits(id,user_id,warehouse_id,vehicle_id) VALUES (?,?,?,?)'
  ).bind(id,user.id,warehouse.id,car?.id||null).run();
  const fresh=prev||await env.DB.prepare('SELECT started_at,status FROM fr_mobile_visits WHERE id=?').bind(id).first();
  return ok({duplicate:Boolean(prev),idWizyty:id,start:fresh.started_at,status:fresh.status,
    ekipa:{id:user.id,nazwa:user.nickname,rola:user.role},
    magazyn:{id:warehouse.id,nazwa:warehouse.name,kodQr:warehouse.scan_code}});
}
async function visitEnd(env,user,p){
  const id=clean(p.idWizyty);
  const visit=await env.DB.prepare('SELECT user_id,status FROM fr_mobile_visits WHERE id=?').bind(id).first();
  if(!visit||visit.user_id!==user.id)return fail('Nie znaleziono wizyty tej ekipy.',404);
  if(visit.status==='ZAKONCZONA')return ok({idWizyty:id,status:'ZAKOŃCZONA',duplicate:true});
  await env.DB.prepare(
    "UPDATE fr_mobile_visits SET status='ZAKONCZONA',ended_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='AKTYWNA'"
  ).bind(id,user.id).run();
  return ok({idWizyty:id,status:'ZAKOŃCZONA',koniec:new Date().toISOString(),duplicate:false});
}
function readLines(p,mapper){
  const out=[];
  for(const [direction,items] of [['POBRANIE',p.pobranie||[]],['ZWROT',p.zwrot||[]]]){
    if(!Array.isArray(items)||items.length>300)throw new Error('Nieprawidłowa lista części.');
    for(const item of items){
      const code=norm(item?.kod||item?.code);
      const part=mapper.get(code);
      const qty=Number(item?.ilosc??item?.qty);
      if(!part)throw new Error('Nieznana lub niejednoznaczna część: '+code);
      if(!qtyOk(qty))throw new Error('Nieprawidłowa ilość: '+code);
      const found=out.find(x=>x.direction===direction&&x.part.id===part.id);
      if(found)found.qty+=qty;
      else out.push({direction,part,qty});
    }
  }
  if(!out.length)throw new Error('Dodaj przynajmniej jedną część.');
  return out.sort((a,b)=>(a.direction+a.part.id).localeCompare(b.direction+b.part.id));
}
async function vehicleVersion(db,vehicleId){
  if(!vehicleId)return null;
  return await db.prepare('SELECT version,updated_at,last_inventory_at FROM fr_mobile_vehicle_versions WHERE vehicle_id=?').bind(vehicleId).first();
}
async function saveSession(env,user,p){
  const id=clean(p.idSesji),visitId=clean(p.idWizyty);
  if(!idOk(id)||!idOk(visitId))return fail('Nieprawidłowy identyfikator operacji.');
  const visit=await env.DB.prepare('SELECT * FROM fr_mobile_visits WHERE id=?').bind(visitId).first();
  if(!visit||visit.user_id!==user.id||visit.warehouse_id!==clean(p.idMagazynu))
    return fail('Wizyta nie należy do tej ekipy lub magazynu.',403);
  const activeCar=await getVehicle(env.DB,user.id);
  if(visit.vehicle_id&&activeCar?.id!==visit.vehicle_id)
    return fail('Samochód został zmieniony. Zakończ pracę na właściwym samochodzie.',409);
  const parts=await partCatalogue(env.DB);
  const lines=readLines(p,partResolver(parts));
  const comment=clean(p.komentarz).slice(0,1200);
  const fingerprint=await sha256(JSON.stringify({visitId,userId:user.id,warehouseId:visit.warehouse_id,
    vehicleId:visit.vehicle_id,comment,lines:lines.map(x=>[x.direction,x.part.id,x.qty])}));
  const old=await env.DB.prepare('SELECT fingerprint FROM fr_mobile_sessions WHERE id=?').bind(id).first();
  if(old){
    if(old.fingerprint!==fingerprint)return fail('Ta operacja ma już inny zapis. Nie wysyłaj jej ponownie ze zmianami.',409);
    const v=await vehicleVersion(env.DB,visit.vehicle_id);
    return ok({duplicate:true,idSesji:id,idWizyty:visitId,status:'ZAPISANA',
      wersjaStanuAuta:v?.version||null,hashStanuAuta:'',warnings:[]});
  }
  if(visit.status!=='AKTYWNA')return fail('Wizyta została już zakończona.',409);
  const tracked=new Set((await getVehicleCatalogue(env.DB)).parts.filter(x=>x.part_found&&x.id).map(x=>x.id));
  const byPart=new Map();
  for(const line of lines){
    const existing=byPart.get(line.part.id)||{part:line.part,pick:0,ret:0};
    if(line.direction==='POBRANIE')existing.pick+=line.qty;
    else existing.ret+=line.qty;
    byPart.set(line.part.id,existing);
  }
  const changes=[env.DB.prepare(
    'INSERT INTO fr_mobile_sessions(id,visit_id,user_id,warehouse_id,vehicle_id,fingerprint,comment) '+
    'VALUES (?,?,?,?,?,?,?)'
  ).bind(id,visitId,user.id,visit.warehouse_id,visit.vehicle_id,fingerprint,comment)];
  const warnings=[];
  for(const entry of byPart.values()){
    const wh=await env.DB.prepare('SELECT quantity FROM warehouse_stock WHERE warehouse_id=? AND part_id=?')
      .bind(visit.warehouse_id,entry.part.id).first();
    const before=Number(wh?.quantity||0);
    const raw=before+entry.ret-entry.pick;
    const warehouseAfter=Math.max(0,raw);
    if(raw<0)warnings.push(entry.part.nazwa+': pobrano więcej niż wynosił zapisany stan magazynu.');
    changes.push(env.DB.prepare(
      'INSERT INTO warehouse_stock(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(warehouse_id,part_id) DO UPDATE SET quantity=CASE '+
      'WHEN warehouse_stock.quantity=? THEN excluded.quantity ELSE NULL END,updated_at=CURRENT_TIMESTAMP'
    ).bind(visit.warehouse_id,entry.part.id,warehouseAfter,before));
    changes.push(env.DB.prepare(
      'INSERT INTO fr_mobile_stock_effects(session_id,location_type,location_id,part_id,applied_delta) VALUES (?,?,?,?,?)'
    ).bind(id,'WAREHOUSE',visit.warehouse_id,entry.part.id,warehouseAfter-before));
    if(visit.vehicle_id&&tracked.has(entry.part.id)){
      const row=await env.DB.prepare('SELECT quantity FROM vehicle_stock WHERE vehicle_id=? AND part_id=?')
        .bind(visit.vehicle_id,entry.part.id).first();
      const carBefore=Number(row?.quantity||0);
      const carAfter=Math.max(0,carBefore+entry.pick-entry.ret);
      if(carBefore+entry.pick-entry.ret<0)
        warnings.push(entry.part.nazwa+': zwrot przekroczył zapisany stan samochodu.');
      changes.push(env.DB.prepare(
        'INSERT INTO vehicle_stock(vehicle_id,part_id,quantity,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) '+
        'ON CONFLICT(vehicle_id,part_id) DO UPDATE SET quantity=CASE '+
        'WHEN vehicle_stock.quantity=? THEN excluded.quantity ELSE NULL END,updated_at=CURRENT_TIMESTAMP'
      ).bind(visit.vehicle_id,entry.part.id,carAfter,carBefore));
      changes.push(env.DB.prepare(
        'INSERT INTO fr_mobile_stock_effects(session_id,location_type,location_id,part_id,applied_delta) VALUES (?,?,?,?,?)'
      ).bind(id,'VEHICLE',visit.vehicle_id,entry.part.id,carAfter-carBefore));
    }
  }
  for(const line of lines)changes.push(env.DB.prepare(
    'INSERT INTO fr_mobile_session_lines(session_id,direction,part_id,quantity) VALUES (?,?,?,?)'
  ).bind(id,line.direction,line.part.id,line.qty));
  if(visit.vehicle_id)changes.push(env.DB.prepare(
    'INSERT INTO fr_mobile_vehicle_versions(vehicle_id,version) VALUES (?,1) '+
    'ON CONFLICT(vehicle_id) DO UPDATE SET version=version+1,updated_at=CURRENT_TIMESTAMP'
  ).bind(visit.vehicle_id));
  // One D1 transaction: session, all lines and BOTH stock locations together.
  try{await env.DB.batch(changes);}
  catch(error){
    const existing=await env.DB.prepare('SELECT fingerprint FROM fr_mobile_sessions WHERE id=?').bind(id).first();
    if(existing?.fingerprint===fingerprint){
      const v=await vehicleVersion(env.DB,visit.vehicle_id);
      return ok({duplicate:true,idSesji:id,idWizyty:visitId,status:'ZAPISANA',
        wersjaStanuAuta:v?.version||null,hashStanuAuta:'',warnings:[]});
    }
    throw error;
  }
  const v=await vehicleVersion(env.DB,visit.vehicle_id);
  return ok({duplicate:false,idSesji:id,idWizyty:visitId,status:'ZAPISANA',
    wersjaStanuAuta:v?.version||null,hashStanuAuta:'',warnings});
}
async function vehicleStock(env,user,meta=false){
  const car=await getVehicle(env.DB,user.id);
  if(!car)return fail('Brak przypisanego samochodu. Zaloguj się z numerem rejestracyjnym.',409);
  const [v,catalogue,parts]=await Promise.all([
    vehicleVersion(env.DB,car.id),getVehicleCatalogue(env.DB),partCatalogue(env.DB)
  ]);
  const inventoryDone=Boolean(v?.last_inventory_at);
  const common={wersjaStanu:v?.version||1,wersjaListy:'D1-FR-1',hashStanu:'',
    ostatniaAktualizacja:v?.updated_at||null,
    inwentaryzacjaWykonana:inventoryDone,ostatniaInwentaryzacja:v?.last_inventory_at||'',
    rejestracja:car.registration_number};
  if(meta)return ok(common);
  const state=(await env.DB.prepare('SELECT part_id,quantity FROM vehicle_stock WHERE vehicle_id=?')
    .bind(car.id).all()).results||[];
  const amounts=new Map(state.map(x=>[x.part_id,Number(x.quantity)]));
  const details=new Map(parts.map(x=>[x.id,x]));
  const result=catalogue.parts.filter(x=>x.part_found&&x.id).map(x=>{
    const part=details.get(x.id);
    return {kod:part?.kod||x.part_number||x.old_index||x.id,
      numerIndeksu:x.part_number||'',nazwa:x.name,
      stanDocelowy:x.required_quantity??null,
      stanAktualny:amounts.has(x.id)?amounts.get(x.id):inventoryDone?0:null,
      wymagany:Number(x.required_quantity||0)>0};
  });
  return ok({...common,ekipa:{id:user.id,nazwa:user.nickname},czesci:result});
}
async function vehicleChange(env,user,p){
  const car=await getVehicle(env.DB,user.id);
  if(!car)return fail('Brak przypisanego samochodu.',409);
  const id=clean(p.idZmiany);
  if(!idOk(id))return fail('Brak identyfikatora zmiany.');
  const changes=Array.isArray(p.zmiany)?p.zmiany:[];
  if(!changes.length||changes.length>300)return fail('Brak zmian stanu samochodu.');
  const old=await env.DB.prepare('SELECT id FROM fr_mobile_vehicle_events WHERE id=?').bind(id).first();
  if(old){
    const v=await vehicleVersion(env.DB,car.id);
    return ok({duplicate:true,wersjaStanu:v?.version||1,wersjaListy:'D1-FR-1',
      hashStanu:'',inwentaryzacjaWykonana:Boolean(v?.last_inventory_at),ostatniaInwentaryzacja:v?.last_inventory_at||''});
  }
  const parts=await partCatalogue(env.DB);
  const resolver=partResolver(parts);
  const statements=[];
  const cleanChanges=[];
  for(const change of changes){
    const part=resolver.get(norm(change.kod||change.code));
    if(!part)return fail('Nieznana część w stanie auta.');
    const isSet=change.stan!==undefined||change.state!==undefined;
    const quantity=Number(isSet?(change.stan??change.state):change.delta);
    if(!Number.isSafeInteger(quantity)||Math.abs(quantity)>100000||(isSet&&quantity<0))
      return fail('Nieprawidłowa ilość dla części '+part.nazwa);
    const row=await env.DB.prepare('SELECT quantity FROM vehicle_stock WHERE vehicle_id=? AND part_id=?')
      .bind(car.id,part.id).first();
    const next=Math.max(0,isSet?quantity:Number(row?.quantity||0)+quantity);
    statements.push(env.DB.prepare(
      'INSERT INTO vehicle_stock(vehicle_id,part_id,quantity,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(vehicle_id,part_id) DO UPDATE SET quantity=CASE '+
      'WHEN vehicle_stock.quantity=? THEN excluded.quantity ELSE NULL END,updated_at=CURRENT_TIMESTAMP'
    ).bind(car.id,part.id,next,Number(row?.quantity||0)));
    cleanChanges.push({partId:part.id,from:row?.quantity??null,to:next});
  }
  const inventory=norm(p.typZmiany||p.typ).includes('INWENT');
  statements.push(env.DB.prepare(
    'INSERT INTO fr_mobile_vehicle_events(id,vehicle_id,user_id,event_type,details) VALUES (?,?,?,?,?)'
  ).bind(id,car.id,user.id,inventory?'INWENTARYZACJA':'RĘCZNA ZMIANA',JSON.stringify(cleanChanges)));
  statements.push(env.DB.prepare(
    'INSERT INTO fr_mobile_vehicle_versions(vehicle_id,version,last_inventory_at) VALUES (?,1,'+
    (inventory?'CURRENT_TIMESTAMP':'NULL')+') ON CONFLICT(vehicle_id) DO UPDATE SET '+
    'version=version+1,updated_at=CURRENT_TIMESTAMP'+
    (inventory?',last_inventory_at=CURRENT_TIMESTAMP':'')
  ).bind(car.id));
  await env.DB.batch(statements);
  const v=await vehicleVersion(env.DB,car.id);
  return ok({duplicate:false,wersjaStanu:v?.version||1,wersjaListy:'D1-FR-1',hashStanu:'',
    inwentaryzacjaWykonana:Boolean(v?.last_inventory_at),ostatniaInwentaryzacja:v?.last_inventory_at||''});
}
export async function handleFrenchMobile(request,env){
  if(!workerAuthReady(env))return fail('Brak konfiguracji D1 i logowania.',503);
  const origin=new URL(request.url).origin;
  if(request.headers.get('Origin')!==origin)return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>100000)return fail('Za dużo danych.',413);
    body=JSON.parse(raw);
  }catch{return fail('Niepoprawne dane JSON.');}
  const action=norm(body?.action),p=body?.payload||{};
  try{
    await ensureSchema(env.DB);
    if(action==='LOGIN')return await login(request,env,p);
    const user=await verifyWorkerSession(request,env);
    if(!user||!user.markets.FR)return fail('Sesja wygasła. Zaloguj się ponownie.',401);
    if(action==='POBIERZ_DANE_STARTOWE')return await startData(env,user);
    if(action==='SKAN_MAGAZYNU')return await visitStart(env,user,p);
    if(action==='ZAKONCZ_WIZYTE')return await visitEnd(env,user,p);
    if(action==='ZAPISZ_SESJE')return await saveSession(env,user,p);
    if(action==='POBIERZ_STAN_AUTA')return await vehicleStock(env,user);
    if(action==='SPRAWDZ_SYNC_AUTA')return await vehicleStock(env,user,true);
    if(action==='AKTUALIZUJ_STAN_AUTA')return await vehicleChange(env,user,p);
    if(action==='PING')return ok({apiVersion:6,serverTime:new Date().toISOString()});
    return fail('Nieznana akcja: '+action,404);
  }catch(error){
    console.error('GPBS FR D1 action failed',action,error?.name||'Error',error?.message||'');
    if(/(?:FOREIGN KEY|no such table|no such column)/i.test(String(error?.message||'')))
      return fail('Niekompletna struktura D1. Sprawdź migracje bazy.',503);
    return fail('Nie udało się zapisać operacji. Spróbuj ponownie.',503);
  }
}
