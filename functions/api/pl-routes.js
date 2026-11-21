// GPBS Storage — PL Office route creation. Does not mutate stock or vehicle balances.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';

const CAN_CREATE=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
const send=(message,status=400)=>workerJson({ok:false,error:message},status);

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
        'created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
        'UNIQUE(route_number,route_date))'
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_route_lines ('+
        'route_id TEXT NOT NULL, position INTEGER NOT NULL,'+
        'part_code TEXT NOT NULL DEFAULT \'\', part_name TEXT NOT NULL DEFAULT \'\','+
        'quantity INTEGER NOT NULL CHECK(quantity>0),'+
        'PRIMARY KEY(route_id,position),'+
        'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pl_routes_date ON pl_routes(route_date DESC,created_at DESC)')
  ]);
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
  return {routeNumber,routeDate,crewSymbol,lines};
}
export async function onRequestGet({request,env}){
  const auth=await authorize(request,env);
  if(auth.response)return auth.response;
  const url=new URL(request.url);
  try{
    if(!await exists(env.DB,'pl_routes'))
      return workerJson({ok:true,routes:[],storageReady:false});
    const id=url.searchParams.get('id');
    if(id!==null){
      if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return send('Nieprawidłowa trasa.',400);
      const route=await env.DB.prepare(
        'SELECT id,route_number AS routeNumber,route_date AS routeDate,'+
        'crew_symbol AS crewSymbol,status,created_at AS createdAt '+
        'FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      const lines=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,quantity '+
        'FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      return workerJson({ok:true,route,lines,storageReady:true});
    }
    const routes=(await env.DB.prepare(
      'SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,'+
      'r.crew_symbol AS crewSymbol,r.status,'+
      'COUNT(l.position) AS positions,COALESCE(SUM(l.quantity),0) AS units '+
      'FROM pl_routes r LEFT JOIN pl_route_lines l ON l.route_id=r.id '+
      'GROUP BY r.id ORDER BY r.route_date DESC,r.created_at DESC,r.id DESC LIMIT 200'
    ).all()).results||[];
    return workerJson({ok:true,routes,storageReady:true});
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
  if(body?.action!=='create')return send('Nieznana operacja.',400);
  const route=parseRoute(body);
  if(!route)return send('Uzupełnij numer i datę trasy, ekipę oraz prawidłową listę części.',400);
  try{
    if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
      await ensureSchema(env.DB);
    const duplicate=await env.DB.prepare(
      'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
    ).bind(route.routeNumber,route.routeDate).first();
    if(duplicate)return send('Trasa z tym numerem i datą jest już zapisana.',409);
    const id='PL-ROUTE-'+crypto.randomUUID();
    const steps=[
      env.DB.prepare(
        'INSERT INTO pl_routes (id,route_number,route_date,crew_number,crew_symbol,status,created_by) '+
        'VALUES (?,?,?,?,?,?,?)'
      ).bind(id,route.routeNumber,route.routeDate,'',route.crewSymbol,
        'AWAITING_CONFIRMATION',auth.user.id)
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
