// GPBS Storage — PL Office route creation. Does not mutate stock or vehicle balances.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';

const CAN_CREATE=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
// TEMPORARY: true during initial presentation-data entry.
// After Admin uses "Wyczyść trasy", switch this ONE value to false.
// The route schema, form and normal D1 writes remain unchanged.
const ROUTE_PRESENTATION_MODE=true;
const send=(message,status=400)=>workerJson({ok:false,error:message},status);
// Send a shortened display label, never a full staff surname, to the route list.
function shortCreatorName(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0)return '—';
  if(parts.length===1)return parts[0];
  const initial=Array.from(parts[parts.length-1])[0]?.toLocaleUpperCase('pl-PL')||'';
  return parts[0]+' '+initial+'.';
}

async function authorize(request,env,write=false){
  if(!workerAuthReady(env)||!env.DB)return {response:send('Panel biurowy nie jest skonfigurowany.',503)};
  let user;
  try{
    user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  }catch(e){
    return {response:send('Nie można potwierdzić sesji.',503)};
  }
  if(!user)return {response:send('Zaloguj się ponownie.',401)};
  if(!user.apps?.office||!user.markets?.PL)
    return {response:send('Brak dostępu do tras w Polsce.',403)};
  if(write&&!CAN_CREATE.has(user.role))
    return {response:send('Brak uprawnień do dodawania tras.',403)};
  return {user};
}
async function exists(db,name){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(name).first();
  return Boolean(row);
}
async function ensureSchema(db){
  // Created on the first authorized save. Reading an empty module never writes D1.
  // crew_number stays as a legacy NOT NULL column for existing D1 schemas.
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_routes ('+
        'id TEXT PRIMARY KEY, route_number TEXT NOT NULL, route_date TEXT NOT NULL,'+
        'crew_number TEXT NOT NULL, crew_symbol TEXT NOT NULL, status TEXT NOT NULL,'+
        'is_presentation INTEGER NOT NULL DEFAULT 0 CHECK(is_presentation IN (0,1)),'+
        'created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
        'UNIQUE(route_number,route_date))'
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_route_lines ('+
        'route_id TEXT NOT NULL, position INTEGER NOT NULL,'+
        'part_code TEXT NOT NULL DEFAULT \'\', part_name TEXT NOT NULL DEFAULT \'\','+
        'quantity INTEGER NOT NULL CHECK(quantity>0),'+
        'confirmed_quantity INTEGER CHECK(confirmed_quantity>=0),'+
        'returned_quantity INTEGER CHECK(returned_quantity>=0),'+
        'return_location TEXT,'+
        'PRIMARY KEY(route_id,position),'+
        'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pl_routes_date ON pl_routes(route_date DESC,created_at DESC)')
  ]);
  // Existing route tables are upgraded in place; existing rows remain REAL (0).
  // A label/star in the UI is never used to decide which records to delete.
  if(!await hasPresentationFlag(db)){
    try{
      await db.prepare(
        'ALTER TABLE pl_routes ADD COLUMN is_presentation INTEGER NOT NULL DEFAULT 0 CHECK(is_presentation IN (0,1))'
      ).run();
    }catch(error){
      if(!await hasPresentationFlag(db))throw error;
    }
  }
  // Route settlement values live on the original route lines; completed routes
  // will be archived by status rather than duplicated to another table.
  for(const [column,definition] of [
    ['confirmed_quantity','INTEGER CHECK(confirmed_quantity>=0)'],
    ['returned_quantity','INTEGER CHECK(returned_quantity>=0)'],
    ['return_location','TEXT']
  ]){
    if((await routeLineColumns(db)).has(column))continue;
    try{
      await db.prepare('ALTER TABLE pl_route_lines ADD COLUMN '+column+' '+definition).run();
    }catch(error){
      if(!(await routeLineColumns(db)).has(column))throw error;
    }
  }
}
async function routeLineColumns(db){
  if(!await exists(db,'pl_route_lines'))return new Set();
  const schema=await db.prepare('PRAGMA table_info(pl_route_lines)').all();
  return new Set((schema.results||[]).map(col=>col.name));
}
async function hasPresentationFlag(db){
  if(!await exists(db,'pl_routes'))return false;
  const result=await db.prepare('PRAGMA table_info(pl_routes)').all();
  return (result.results||[]).some(col=>col.name==='is_presentation');
}
async function verifyCleanupPin(db,env,userId,pin){
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
  const credentials=await db.prepare(
    'SELECT c.pin_digest,u.role_code,u.active FROM user_pin_credentials c '+
    'JOIN users u ON u.id=c.user_id WHERE c.user_id=?'
  ).bind(userId).first();
  if(!credentials||credentials.role_code!=='ADMIN'||Number(credentials.active)!==1||
     !/^[0-9a-f]{64}$/i.test(String(credentials.pin_digest||'')))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PIN_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('GPBS:D1:PIN:v1:'+pin));
  const digest=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join('');
  const stored=String(credentials.pin_digest).toLowerCase();
  let difference=0;
  for(let i=0;i<64;i++)difference|=digest.charCodeAt(i)^stored.charCodeAt(i);
  return difference===0;
}
const validDate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
};
function parseRoute(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const routeNumber=String(body.routeNumber||'').trim();
  const routeDate=String(body.routeDate||'').trim();
  const crewSymbol=String(body.crewSymbol||'').trim().toUpperCase();
  if(!routeNumber||routeNumber.length>80||!validDate(routeDate)||
      !crewSymbol||crewSymbol.length>20)return null;
  if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>150)return null;
  const lines=[];
  for(const item of body.lines){
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const partCode=String(item.partCode||'').trim();
    const partName=String(item.partName||'').trim();
    const quantity=Number(item.quantity);
    if((!partCode&&!partName)||partCode.length>100||partName.length>180||
       !Number.isSafeInteger(quantity)||quantity<1||quantity>999999)return null;
    lines.push({partCode,partName,quantity});
  }
  return {routeNumber,routeDate,crewSymbol,lines,
    isPresentation:ROUTE_PRESENTATION_MODE};
}
export async function onRequestGet({request,env}){
  const auth=await authorize(request,env);
  if(auth.response)return auth.response;
  const url=new URL(request.url);
  try{
    if(!await exists(env.DB,'pl_routes'))
      return workerJson({ok:true,routes:[],storageReady:false,presentationMode:ROUTE_PRESENTATION_MODE});
    const presentationColumn=await hasPresentationFlag(env.DB);
    const flag= presentationColumn?'is_presentation AS isPresentation':'0 AS isPresentation';
    const id=url.searchParams.get('id');
    if(id!==null){
      if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return send('Nieprawidłowa trasa.',400);
      const route=await env.DB.prepare(
        'SELECT id,route_number AS routeNumber,route_date AS routeDate,'+
        'crew_symbol AS crewSymbol,status,created_at AS createdAt,'+flag+' '+
        'FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      const columns=await routeLineColumns(env.DB);
      const optional=[
        columns.has('confirmed_quantity')
          ?'confirmed_quantity AS confirmedQuantity':'NULL AS confirmedQuantity',
        columns.has('returned_quantity')
          ?'returned_quantity AS returnedQuantity':'NULL AS returnedQuantity',
        columns.has('return_location')
          ?'return_location AS returnLocation':'NULL AS returnLocation'
      ].join(',');
      const lines=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
        optional+' FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      return workerJson({ok:true,route,lines,storageReady:true});
    }
    const scope=url.searchParams.get('scope')||'active';
    if(scope!=='active'&&scope!=='history')return send('Nieprawidłowy widok tras.',400);
    const where=scope==='history'
      ?"WHERE r.status='COMPLETED' "
      :"WHERE r.status<>'COMPLETED' ";
    const hasConfirmations=(await routeLineColumns(env.DB)).has('confirmed_quantity');
    const discrepancies=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.confirmed_quantity IS NOT NULL '+
       'AND l.confirmed_quantity<>l.quantity THEN 1 ELSE 0 END),0) AS discrepancyCount,'
      :'0 AS discrepancyCount,';
    const routeRows=(await env.DB.prepare(
      'SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,'+
      'r.crew_symbol AS crewSymbol,r.status,'+
      (presentationColumn?'r.is_presentation AS isPresentation,':'0 AS isPresentation,')+
      'COUNT(l.position) AS positions,COALESCE(SUM(l.quantity),0) AS units,'+
      discrepancies+
      "COALESCE((SELECT u.name FROM users u WHERE u.id=r.created_by LIMIT 1),'') AS creatorFullName "+
      'FROM pl_routes r LEFT JOIN pl_route_lines l ON l.route_id=r.id '+
      where+
      'GROUP BY r.id ORDER BY r.route_date DESC,r.created_at DESC,r.id DESC LIMIT 200'
    ).all()).results||[];
    // Strip the full name before returning data to the browser.
    const routes=routeRows.map(({creatorFullName,...route})=>({
      ...route,enteredBy:shortCreatorName(creatorFullName)
    }));
    return workerJson({ok:true,routes,storageReady:true,presentationMode:ROUTE_PRESENTATION_MODE});
  }catch(e){
    console.error('PL routes list failed',e?.name||'Error');
    return send('Nie udało się odczytać tras z D1.',503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return send('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return send('Wymagany format JSON.',415);
  const auth=await authorize(request,env,true);
  if(auth.response)return auth.response;
  let raw;
  try{raw=await request.text();}
  catch{return send('Nie udało się odczytać formularza.',400);}
  if(raw.length>40000)return send('Zbyt duży formularz trasy.',413);
  let body;
  try{body=JSON.parse(raw);}catch{return send('Nieprawidłowy JSON.',400);}
  if(body?.action==='deletePresentation'){
    if(!ROUTE_PRESENTATION_MODE)return send('Tryb wprowadzania tras prezentacyjnych jest wyłączony.',403);
    // Cleanup is deliberately separate from ordinary route creation.
    // Never run it for a non-Admin session or without a fresh D1 PIN check.
    if(auth.user.role!=='ADMIN')return send('Tylko administrator może usuwać trasy prezentacyjne.',403);
    if(body.confirm!=='USUŃ TRASY')return send('Potwierdzenie usuwania jest nieprawidłowe.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB))
        return workerJson({ok:true,deleted:0});
      // Both statements are executed in one atomic D1 batch, scoped *only*
      // to the is_presentation flag. No stock, real routes or vehicle data.
      const results=await env.DB.batch([
        env.DB.prepare(
          'DELETE FROM pl_route_lines WHERE route_id IN ('+
          'SELECT id FROM pl_routes WHERE is_presentation=1)'
        ),
        env.DB.prepare('DELETE FROM pl_routes WHERE is_presentation=1')
      ]);
      return workerJson({ok:true,deleted:Number(results[1]?.meta?.changes||0)});
    }catch(error){
      console.error('PL route presentation cleanup failed',error?.name||'Error');
      return send('Nie udało się wyczyścić tras prezentacyjnych.',503);
    }
  }
  if(body?.action!=='create')return send('Nieznana operacja.',400);
  const route=parseRoute(body);
  if(!route)return send('Uzupełnij numer i datę trasy, ekipę oraz prawidłową listę części.',400);
  try{
    const lineColumns=await routeLineColumns(env.DB);
    if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB)||
       !['confirmed_quantity','returned_quantity','return_location'].every(
         col=>lineColumns.has(col)
       ))await ensureSchema(env.DB);
    const duplicate=await env.DB.prepare(
      'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
    ).bind(route.routeNumber,route.routeDate).first();
    if(duplicate)return send('Trasa z tym numerem i datą jest już zapisana.',409);
    const id='PL-ROUTE-'+crypto.randomUUID();
    const steps=[
      env.DB.prepare(
        'INSERT INTO pl_routes (id,route_number,route_date,crew_number,crew_symbol,status,created_by,is_presentation) '+
        'VALUES (?,?,?,?,?,?,?,?)'
      ).bind(id,route.routeNumber,route.routeDate,'',route.crewSymbol,
        'AWAITING_CONFIRMATION',auth.user.id,route.isPresentation?1:0)
    ];
    route.lines.forEach((line,i)=>{
      steps.push(env.DB.prepare(
        'INSERT INTO pl_route_lines (route_id,position,part_code,part_name,quantity) VALUES (?,?,?,?,?)'
      ).bind(id,i+1,line.partCode,line.partName,line.quantity));
    });
    await env.DB.batch(steps); // D1 batch is atomic: no partly-created route.
    return workerJson({ok:true,id},201);
  }catch(e){
    console.error('PL route creation failed',e?.name||'Error');
    if(/UNIQUE constraint failed/i.test(String(e?.message||'')))
      return send('Trasa z tym numerem i datą jest już zapisana.',409);
    return send('Nie udało się zapisać trasy w D1.',503);
  }
}
