// PL crew routes: PIN-authenticated read and first pickup confirmation.
// No stock/vehicle balance changes. Crew identity always comes from the session.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../../lib/pl-worker-auth.js';
import {ensureRouteAuditSchema} from '../../../lib/pl-route-audit.js';

const send=(message,status=400)=>workerJson({ok:false,error:message},status);
const validId=id=>/^PL-ROUTE-[a-f0-9-]{36}$/.test(String(id||''));
const exists=async(db,table)=>Boolean(await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
).bind(table).first());
const maxLines=150;

async function authorize(request,env){
  if(!workerAuthReady(env))return {error:send('Brak konfiguracji aplikacji.',503)};
  const user=await verifyWorkerSession(request,env);
  if(!user)return {error:send('Zaloguj się ponownie.',401)};
  if(user.role!=='EKIPA'||!user.markets?.PL||!user.apps?.mobile)
    return {error:send('Brak dostępu do tras ekipy PL.',403)};
  const symbol=String(user.displayCode||user.nickname||'').trim().toUpperCase();
  if(!symbol||symbol.length>20)return {error:send('Nie rozpoznano symbolu ekipy.',403)};
  return {user,symbol};
}
function routeRow(row){
  return {id:row.id,routeNumber:row.routeNumber,routeDate:row.routeDate,
    status:row.status,revision:Number(row.revision||0),
    unconfirmedCount:Number(row.unconfirmedCount||0),
    pending:row.status==='AWAITING_CONFIRMATION'&&Number(row.unconfirmedCount)>0};
}
const routeQuery="SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,"+
  "r.status,COALESCE(r.edit_revision,0) AS revision,"+
  "COALESCE((SELECT COUNT(*) FROM pl_route_lines l "+
  "WHERE l.route_id=r.id AND l.confirmed_quantity IS NULL),0) AS unconfirmedCount "+
  "FROM pl_routes r WHERE r.id=? AND UPPER(TRIM(r.crew_symbol))=?";
async function preparedRoute(db,id,symbol){
  return db.prepare(routeQuery).bind(id,symbol).first();
}
async function ensureReceiptTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_pickups ('+
    'route_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,details_json TEXT NOT NULL,'+
    'confirmed_at TEXT NOT NULL DEFAULT (strftime('+
    "'%Y-%m-%dT%H:%M:%fZ','now'"+
    ')),FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
  ).run();
}
export async function onRequestGet({request,env}){
  const auth=await authorize(request,env);
  if(auth.error)return auth.error;
  try{
    if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
      return workerJson({ok:true,routes:[],route:null,lines:[]});
    const col=(await env.DB.prepare('PRAGMA table_info(pl_routes)').all()).results||[];
    const hasRevision=col.some(x=>x.name==='edit_revision');
    const routeCols=(await env.DB.prepare('PRAGMA table_info(pl_route_lines)').all()).results||[];
    if(!routeCols.some(x=>x.name==='confirmed_quantity'))
      return send('Moduł tras wymaga aktualizacji schematu.',503);
    const query="SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,"+
      "r.status,"+(hasRevision?"r.edit_revision":"0")+" AS revision,"+
      "COALESCE((SELECT COUNT(*) FROM pl_route_lines l "+
      "WHERE l.route_id=r.id AND l.confirmed_quantity IS NULL),0) AS unconfirmedCount "+
      "FROM pl_routes r WHERE UPPER(TRIM(r.crew_symbol))=? ";
    const url=new URL(request.url);
    const id=url.searchParams.get('id');
    if(id!==null){
      if(!validId(id))return send('Nieprawidłowy numer trasy.',400);
      const route=await env.DB.prepare(query+'AND r.id=?').bind(auth.symbol,id).first();
      if(!route)return send('Nie znaleziono trasy przypisanej do tej ekipy.',404);
      const lines=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,'+
        'quantity,confirmed_quantity AS confirmedQuantity '+
        'FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      return workerJson({ok:true,route:routeRow(route),lines});
    }
    const routes=(await env.DB.prepare(
      query+"AND r.status<>'COMPLETED' "+
      "ORDER BY r.route_date DESC,r.created_at DESC,r.id DESC LIMIT 50"
    ).bind(auth.symbol).all()).results||[];
    return workerJson({ok:true,routes:routes.map(routeRow)});
  }catch(error){
    console.error('PL crew route read failed',error?.name||'Error');
    return send('Nie udało się pobrać tras ekipy.',503);
  }
}
export async function onRequestPost({request,env}){
  const origin=new URL(request.url).origin;
  if(request.headers.get('Origin')!==origin)return send('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return send('Wymagany format JSON.',415);
  const auth=await authorize(request,env);
  if(auth.error)return auth.error;
  let body;
  try{
    const raw=await request.text();
    if(raw.length>30000)return send('Zbyt dużo danych.',413);
    body=JSON.parse(raw);
  }catch{return send('Nieprawidłowy formularz.',400);}
  if(body?.action!=='confirmPickup')return send('Nieznana operacja.',400);
  const id=String(body.id||'');
  const revision=Number(body.revision);
  const lines=body.lines;
  if(!validId(id)||!Number.isSafeInteger(revision)||revision<0||
    !Array.isArray(lines)||!lines.length||lines.length>maxLines)
    return send('Nieprawidłowe potwierdzenie trasy.',400);
  const quantities=new Map();
  for(const item of lines){
    if(!item||!Number.isSafeInteger(item.position)||item.position<1||
      !Number.isSafeInteger(item.quantity)||item.quantity<0||item.quantity>999999||
      quantities.has(item.position))
      return send('Sprawdź ilości przy każdej części.',400);
    quantities.set(item.position,item.quantity);
  }
  try{
    if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
      return send('Nie znaleziono trasy.',404);
    // The editing revision must exist before the read and conditional update.
    await ensureRouteAuditSchema(env.DB);
    const route=await preparedRoute(env.DB,id,auth.symbol);
    if(!route)return send('Nie znaleziono trasy przypisanej do tej ekipy.',404);
    if(route.status!=='AWAITING_CONFIRMATION')
      return send('Odbiór tej trasy został już potwierdzony lub zmieniony.',409);
    if(Number(route.revision)!==revision)
      return send('Lista części została zmieniona w biurze. Otwórz ją ponownie.',409);
    const current=(await env.DB.prepare(
      'SELECT position,part_name AS partName,part_code AS partCode,quantity,'+
      'confirmed_quantity AS confirmedQuantity,returned_quantity AS returnedQuantity,'+
      'verified_quantity AS verifiedQuantity FROM pl_route_lines '+
      'WHERE route_id=? ORDER BY position'
    ).bind(id).all()).results||[];
    if(!current.length||current.length!==quantities.size||
       current.some(x=>!quantities.has(x.position)||x.confirmedQuantity!=null||
         x.returnedQuantity!=null||x.verifiedQuantity!=null))
      return send('Trasa została zmieniona. Otwórz ją ponownie.',409);
    const mismatch=current.some(x=>quantities.get(x.position)!==Number(x.quantity));
    const status=mismatch?'REVIEW_REQUIRED':'CONFIRMED';
    const token=crypto.randomUUID();
    await ensureReceiptTable(env.DB);
    const snapshot=current.map(x=>({
      position:x.position,partName:x.partName,partCode:x.partCode,
      issued:Number(x.quantity),received:quantities.get(x.position)
    }));
    const guard="SELECT 1 FROM pl_routes r WHERE r.id=? "+
      "AND UPPER(TRIM(r.crew_symbol))=? AND r.status=? "+
      "AND r.edit_revision=? AND r.edit_token=?";
    const stmts=[env.DB.prepare(
      'UPDATE pl_routes SET status=?,edit_revision=edit_revision+1,edit_token=? '+
      'WHERE id=? AND UPPER(TRIM(crew_symbol))=? '+
      "AND status='AWAITING_CONFIRMATION' AND edit_revision=? "+
      'AND NOT EXISTS(SELECT 1 FROM pl_route_lines l WHERE l.route_id=pl_routes.id '+
      'AND (l.confirmed_quantity IS NOT NULL OR l.returned_quantity IS NOT NULL))'
    ).bind(status,token,id,auth.symbol,revision)];
    for(const x of snapshot){
      stmts.push(env.DB.prepare(
        'UPDATE pl_route_lines SET confirmed_quantity=? WHERE route_id=? '+
        'AND position=? AND confirmed_quantity IS NULL AND EXISTS ('+guard+')'
      ).bind(x.received,id,x.position,id,auth.symbol,status,revision+1,token));
    }
    stmts.push(env.DB.prepare(
      'INSERT INTO pl_route_pickups(route_id,actor_id,details_json) '+
      'SELECT ?,?,? WHERE EXISTS ('+guard+')'
    ).bind(id,auth.user.id,JSON.stringify(snapshot),id,auth.symbol,status,revision+1,token));
    const results=await env.DB.batch(stmts);
    if(Number(results[0]?.meta?.changes||0)!==1 ||
      results.slice(1).some(r=>Number(r?.meta?.changes||0)!==1))
      return send('Potwierdzenie wymaga ponownego sprawdzenia trasy.',409);
    return workerJson({ok:true,id,status,discrepancy:mismatch});
  }catch(error){
    console.error('PL crew pickup failed',error?.name||'Error');
    return send('Nie udało się zapisać potwierdzenia odbioru.',503);
  }
}
