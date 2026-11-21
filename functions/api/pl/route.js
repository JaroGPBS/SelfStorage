// PL crew mobile workflow: scoped route list, pickup and final report.
// Stock is never adjusted. Route parts and Office use the same D1 records.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../../lib/pl-worker-auth.js';
import {ensureRouteAuditSchema} from '../../../lib/pl-route-audit.js';
import {plRouteTableExists,ensurePlCrewRouteSchema,getPlRouteCrewNotes,normalizePlRouteComment} from '../../../lib/pl-route-crew.js';

const send=(message,status=400)=>workerJson({ok:false,error:message},status);
const validId=id=>/^PL-ROUTE-[a-f0-9-]{36}$/.test(String(id||''));
const maxLines=150, maxQuantity=999999;

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
const int=value=>Number.isSafeInteger(value)&&value>=0&&value<=maxQuantity;
const routeRow=row=>{
  const unconfirmedCount=Number(row.unconfirmedCount||0);
  const discrepancyCount=Number(row.discrepancyCount||0);
  const pendingPickup=row.status==='AWAITING_CONFIRMATION'&&unconfirmedCount>0;
  const pendingReport=!pendingPickup&&row.status!=='COMPLETED'&&unconfirmedCount===0;
  return {id:row.id,routeNumber:row.routeNumber,routeDate:row.routeDate,
    status:row.status,revision:Number(row.revision||0),
    unconfirmedCount,discrepancyCount,pendingPickup,pendingReport,
    requiresOfficeReview:pendingReport&&discrepancyCount>0};
};
async function listQuery(db){
  const cols=(await db.prepare('PRAGMA table_info(pl_routes)').all()).results||[];
  const revision=cols.some(x=>x.name==='edit_revision')
    ?'r.edit_revision':'0';
  return 'SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,'+
    'r.status,'+revision+' AS revision,'+
    'COALESCE((SELECT COUNT(*) FROM pl_route_lines l '+
    'WHERE l.route_id=r.id AND l.confirmed_quantity IS NULL),0) AS unconfirmedCount,'+
    'COALESCE((SELECT COUNT(*) FROM pl_route_lines l '+
    'WHERE l.route_id=r.id AND l.confirmed_quantity IS NOT NULL '+
    'AND l.confirmed_quantity<>l.quantity AND l.verified_quantity IS NULL),0) AS discrepancyCount '+
    'FROM pl_routes r WHERE UPPER(TRIM(r.crew_symbol))=? ';
}
async function fetchLines(db,id){
  return (await db.prepare(
    'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
    'confirmed_quantity AS confirmedQuantity,verified_quantity AS verifiedQuantity,'+
    'returned_quantity AS returnedQuantity,return_location AS returnLocation '+
    'FROM pl_route_lines WHERE route_id=? ORDER BY position'
  ).bind(id).all()).results||[];
}
async function checkTables(db){
  return await plRouteTableExists(db,'pl_routes')&&
    await plRouteTableExists(db,'pl_route_lines');
}
async function ensurePickupTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_pickups ('+
    'route_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,details_json TEXT NOT NULL,'+
    'confirmed_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),'+
    'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
  ).run();
}
const condition="SELECT 1 FROM pl_routes r WHERE r.id=? "+
  "AND UPPER(TRIM(r.crew_symbol))=? AND r.status=? "+
  "AND r.edit_revision=? AND r.edit_token=?";

export async function onRequestGet({request,env}){
  let auth;
  try{auth=await authorize(request,env);}catch{return send('Nie można potwierdzić sesji.',503);}
  if(auth.error)return auth.error;
  try{
    if(!await checkTables(env.DB))
      return workerJson({ok:true,routes:[],hasMore:false,route:null,lines:[]});
    const columns=(await env.DB.prepare('PRAGMA table_info(pl_route_lines)').all()).results||[];
    if(!['confirmed_quantity','verified_quantity','returned_quantity','return_location']
      .every(key=>columns.some(x=>x.name===key)))
      return send('Moduł tras wymaga aktualizacji schematu.',503);
    const query=await listQuery(env.DB);
    const url=new URL(request.url);
    const id=url.searchParams.get('id');
    if(id!==null){
      if(!validId(id))return send('Nieprawidłowa trasa.',400);
      const route=await env.DB.prepare(query+'AND r.id=?').bind(auth.symbol,id).first();
      if(!route)return send('Nie znaleziono trasy przypisanej do tej ekipy.',404);
      const lines=await fetchLines(env.DB,id);
      const crewComments=await getPlRouteCrewNotes(env.DB,id);
      const pickup=await plRouteTableExists(env.DB,'pl_route_pickups')
        ?await env.DB.prepare('SELECT confirmed_at AS confirmedAt FROM pl_route_pickups WHERE route_id=?')
          .bind(id).first():null;
      const report=await plRouteTableExists(env.DB,'pl_route_reports')
        ?await env.DB.prepare('SELECT submitted_at AS submittedAt FROM pl_route_reports WHERE route_id=?')
          .bind(id).first():null;
      return workerJson({ok:true,route:routeRow(route),lines,crewComments,
        pickupAt:pickup?.confirmedAt||null,reportAt:report?.submittedAt||null});
    }
    const view=url.searchParams.get('view')||'active';
    if(view!=='active'&&view!=='history')return send('Nieprawidłowy widok tras.',400);
    const offset=Number(url.searchParams.get('offset')||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)
      return send('Nieprawidłowa strona historii.',400);
    const limit=view==='active'?200:100;
    const search=String(url.searchParams.get('search')||'').trim();
    if(search.length>80)return send('Wpisz krótszy numer trasy.',400);
    const where=view==='active'?"AND r.status<>'COMPLETED' ":'';
    const filter=view==='history'&&search
      ?'AND r.route_number LIKE ? ESCAPE '+String.fromCharCode(39,92,39)+' ':'';
    const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const rows=(await env.DB.prepare(query+where+filter+
      'ORDER BY r.route_date DESC,r.created_at DESC,r.id DESC LIMIT ? OFFSET ?'
    ).bind(auth.symbol,...(filter?[pattern]:[]),limit+1,offset).all()).results||[];
    return workerJson({ok:true,routes:rows.slice(0,limit).map(routeRow),
      hasMore:rows.length>limit,nextOffset:offset+limit});
  }catch(error){
    console.error('PL crew routes read failed',error?.name||'Error');
    return send('Nie udało się pobrać tras ekipy.',503);
  }
}
function readPayload(body,withReturns){
  const lines=body?.lines;
  if(!Array.isArray(lines)||!lines.length||lines.length>maxLines)return null;
  const values=new Map();
  for(const item of lines){
    const position=item?.position;
    const quantity=withReturns?item?.used:item?.quantity;
    const returned=withReturns?item?.returned:0;
    const location=withReturns?String(item?.returnLocation||'').trim():'';
    if(!Number.isSafeInteger(position)||position<1||
      !int(quantity)||!int(returned)||values.has(position)||
      location.length>90||(withReturns&&returned>0&&!location)||
      (withReturns&&returned===0&&location))
      return null;
    values.set(position,withReturns?{used:quantity,returned,returnLocation:location}:quantity);
  }
  return values;
}
export async function onRequestPost({request,env}){
  if(request.headers.get('Origin')!==new URL(request.url).origin)
    return send('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return send('Wymagany format JSON.',415);
  let auth;
  try{auth=await authorize(request,env);}catch{return send('Nie można potwierdzić sesji.',503);}
  if(auth.error)return auth.error;
  let body;
  try{const raw=await request.text();
    if(raw.length>45000)return send('Zbyt dużo danych.',413);
    body=JSON.parse(raw);
  }catch{return send('Nieprawidłowy formularz.',400);}
  const reportAction=body?.action==='submitReport';
  if(body?.action!=='confirmPickup'&&!reportAction)
    return send('Nieznana operacja.',400);
  const id=String(body.id||'');
  const revision=body.revision;
  const comment=normalizePlRouteComment(body.comment);
  const values=readPayload(body,reportAction);
  if(!validId(id)||!Number.isSafeInteger(revision)||revision<0||
    !values||comment===null)return send('Sprawdź wprowadzone dane trasy.',400);
  try{
    if(!await checkTables(env.DB))return send('Nie znaleziono trasy.',404);
    await ensureRouteAuditSchema(env.DB);
    const sql=await listQuery(env.DB);
    const route=await env.DB.prepare(sql+'AND r.id=?').bind(auth.symbol,id).first();
    if(!route)return send('Nie znaleziono trasy przypisanej do tej ekipy.',404);
    if(Number(route.revision)!==revision)
      return send('Trasa została zmieniona w biurze. Otwórz ją ponownie.',409);
    const current=await fetchLines(env.DB,id);
    if(!current.length||current.length!==values.size||
      current.some(x=>!values.has(x.position)))
      return send('Lista części została zmieniona. Otwórz ją ponownie.',409);
    if(!reportAction){
      if(route.status!=='AWAITING_CONFIRMATION'||
        current.some(x=>x.confirmedQuantity!=null||x.returnedQuantity!=null))
        return send('Odbiór tej trasy został już potwierdzony.',409);
      const discrepancy=current.some(x=>values.get(x.position)!==Number(x.quantity));
      const status=discrepancy?'REVIEW_REQUIRED':'CONFIRMED';
      const token=crypto.randomUUID();
      const snapshot=current.map(x=>({
        position:x.position,partName:x.partName,partCode:x.partCode,
        issued:Number(x.quantity),received:values.get(x.position)
      }));
      await ensurePickupTable(env.DB);
      if(comment)await ensurePlCrewRouteSchema(env.DB);
      const steps=[env.DB.prepare(
        'UPDATE pl_routes SET status=?,edit_revision=edit_revision+1,edit_token=? '+
        'WHERE id=? AND UPPER(TRIM(crew_symbol))=? '+
        "AND status='AWAITING_CONFIRMATION' AND edit_revision=? "+
        'AND NOT EXISTS(SELECT 1 FROM pl_route_lines l WHERE l.route_id=pl_routes.id '+
        'AND (l.confirmed_quantity IS NOT NULL OR l.returned_quantity IS NOT NULL))'
      ).bind(status,token,id,auth.symbol,revision)];
      for(const x of snapshot){
        steps.push(env.DB.prepare(
          'UPDATE pl_route_lines SET confirmed_quantity=? WHERE route_id=? '+
          'AND position=? AND confirmed_quantity IS NULL AND EXISTS ('+condition+')'
        ).bind(x.received,id,x.position,id,auth.symbol,status,revision+1,token));
      }
      steps.push(env.DB.prepare(
        'INSERT INTO pl_route_pickups(route_id,actor_id,details_json) '+
        'SELECT ?,?,? WHERE EXISTS ('+condition+')'
      ).bind(id,auth.user.id,JSON.stringify(snapshot),id,auth.symbol,status,revision+1,token));
      if(comment)steps.push(env.DB.prepare(
        "INSERT INTO pl_route_crew_notes(route_id,stage,actor_id,comment) "+
        "SELECT ?,'PICKUP',?,? WHERE EXISTS ("+condition+")"
      ).bind(id,auth.user.id,comment,id,auth.symbol,status,revision+1,token));
      const result=await env.DB.batch(steps);
      if(result.some(x=>Number(x?.meta?.changes||0)!==1))
        return send('Nie można potwierdzić trasy po zmianie danych. Odśwież listę.',409);
      return workerJson({ok:true,id,status,discrepancy});
    }
    if(!['CONFIRMED','REVIEW_EXPLAINED','REVIEW_REQUIRED','DISCREPANCY']
      .includes(route.status)||current.some(x=>x.confirmedQuantity==null||
        x.returnedQuantity!=null))
      return send('Ta trasa nie jest gotowa do raportu lub została już rozliczona.',409);
    // Office must resolve pickup discrepancies before quantities can be settled.
    if(current.some(x=>x.verifiedQuantity==null&&
      Number(x.confirmedQuantity)!==Number(x.quantity)))
      return send('Przed rozliczeniem biuro musi zweryfikować różnice w odbiorze.',409);
    const snapshot=[];
    for(const x of current){
      const accepted=Number(x.verifiedQuantity??x.confirmedQuantity);
      const input=values.get(x.position);
      if(!int(accepted)||input.used+input.returned!==accepted)
        return send('Suma wykorzystanych i zwróconych części musi odpowiadać ilości odebranej.',400);
      snapshot.push({position:x.position,partName:x.partName,partCode:x.partCode,
        received:accepted,used:input.used,returned:input.returned,
        returnLocation:input.returnLocation});
    }
    const status='COMPLETED',token=crypto.randomUUID();
    await ensurePlCrewRouteSchema(env.DB);
    const steps=[env.DB.prepare(
      "UPDATE pl_routes SET status='COMPLETED',edit_revision=edit_revision+1,edit_token=? "+
      'WHERE id=? AND UPPER(TRIM(crew_symbol))=? AND edit_revision=? '+
      "AND status IN ('CONFIRMED','REVIEW_EXPLAINED','REVIEW_REQUIRED','DISCREPANCY') "+
      'AND NOT EXISTS (SELECT 1 FROM pl_route_lines l WHERE l.route_id=pl_routes.id '+
      'AND (l.confirmed_quantity IS NULL OR l.returned_quantity IS NOT NULL OR '+
      '(l.confirmed_quantity<>l.quantity AND l.verified_quantity IS NULL)))'
    ).bind(token,id,auth.symbol,revision)];
    for(const x of snapshot)steps.push(env.DB.prepare(
      'UPDATE pl_route_lines SET returned_quantity=?,return_location=? '+
      'WHERE route_id=? AND position=? AND returned_quantity IS NULL AND EXISTS ('+condition+')'
    ).bind(x.returned,x.returnLocation||null,id,x.position,
      id,auth.symbol,status,revision+1,token));
    steps.push(env.DB.prepare(
      'INSERT INTO pl_route_reports(route_id,actor_id,details_json) '+
      'SELECT ?,?,? WHERE EXISTS ('+condition+')'
    ).bind(id,auth.user.id,JSON.stringify(snapshot),id,auth.symbol,status,revision+1,token));
    if(comment)steps.push(env.DB.prepare(
      "INSERT INTO pl_route_crew_notes(route_id,stage,actor_id,comment) "+
      "SELECT ?,'REPORT',?,? WHERE EXISTS ("+condition+")"
    ).bind(id,auth.user.id,comment,id,auth.symbol,status,revision+1,token));
    const result=await env.DB.batch(steps);
    if(result.some(x=>Number(x?.meta?.changes||0)!==1))
      return send('Raport wymaga ponownego sprawdzenia. Odśwież trasę.',409);
    return workerJson({ok:true,id,status,completed:true});
  }catch(error){
    console.error('PL crew route write failed',error?.name||'Error');
    return send('Nie udało się zapisać danych trasy w D1.',503);
  }
}
