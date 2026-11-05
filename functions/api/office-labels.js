// GPBS Storage Poland: print-ready part catalogue and per-warehouse print dates.
// Every request checks the live office session and grants; no printer data is collected.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {ensurePartIndexes} from '../../lib/pl-part-indexes.js';

const ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
const WAREHOUSE=/^[A-Z0-9-]{2,50}$/;
const PART=/^[A-Za-z0-9_-]{1,100}$/;
const fail=(message,status=400)=>workerJson({ok:false,error:message},status);

async function authenticate(request,env){
  if(!workerAuthReady(env))return {error:fail('Panel biurowy nie jest skonfigurowany.',503)};
  let user;
  try{user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);}
  catch{return {error:fail('Nie można zweryfikować sesji.',503)};}
  if(!user)return {error:fail('Sesja wygasła. Zaloguj się ponownie.',401)};
  if(!ROLES.has(user.role))return {error:fail('Brak uprawnień do etykiet.',403)};
  return {user};
}

async function verifyWarehouse(db,user,id){
  if(!WAREHOUSE.test(id)||!user.warehouses.some(w=>w.id===id))return false;
  return Boolean(await db.prepare(
    "SELECT id FROM warehouses WHERE id=? AND country_code='PL' AND active=1"
  ).bind(id).first());
}

async function ensurePrintTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_part_label_prints ('+
    'warehouse_id TEXT NOT NULL,part_id TEXT NOT NULL,'+
    'last_print_at TEXT NOT NULL,print_count INTEGER NOT NULL DEFAULT 1,'+
    'PRIMARY KEY(warehouse_id,part_id))'
  ).run();
}

export async function onRequestGet({request,env}){
  const auth=await authenticate(request,env);
  if(auth.error)return auth.error;
  const url=new URL(request.url);
  const warehouseId=url.searchParams.get('warehouse')||'';
  try{
    if(!await verifyWarehouse(env.DB,auth.user,warehouseId))
      return fail('Nie masz dostępu do tego magazynu.',403);
    await ensurePrintTable(env.DB);
    const mapped=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
    ).first();
    if(!mapped)await ensurePartIndexes(env.DB);
    const hasR2=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photo_objects'"
    ).first();
    const hasD1Photo=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
    ).first();
    const flags=[
      hasR2?'EXISTS(SELECT 1 FROM pl_part_photo_objects o WHERE o.part_id=p.id)':null,
      hasD1Photo?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
    ].filter(Boolean).join(' OR ');
    const rows=await env.DB.prepare(
      'SELECT p.id,p.name,p.sap_number,'+
      'COALESCE(ix.new_index,p.part_number) AS part_number,'+
      (flags?'('+flags+')':'0')+' AS has_photo,'+
      'lp.last_print_at '+
      'FROM parts p LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id '+
      'LEFT JOIN pl_part_label_prints lp ON lp.part_id=p.id AND lp.warehouse_id=? '+
      'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE,p.id LIMIT 3000'
    ).bind(warehouseId).all();
    return workerJson({ok:true,warehouseId,parts:rows.results||[]});
  }catch(error){
    console.error('Office label list failed',error?.name||'Error');
    return fail('Nie udało się pobrać listy etykiet.',503);
  }
}

export async function onRequestPost({request,env}){
  const auth=await authenticate(request,env);
  if(auth.error)return auth.error;
  const origin=request.headers.get('Origin');
  if(!origin||origin!==new URL(request.url).origin)return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>16000)return fail('Zbyt wiele etykiet w kolejce.',413);
    body=JSON.parse(raw);
  }catch{return fail('Nieprawidłowe dane.',400);}
  if(body?.action!=='recordPrint'||!Array.isArray(body.partIds)||body.partIds.length<1||
     body.partIds.length>200)return fail('Nieprawidłowa lista etykiet.',400);
  const warehouseId=String(body.warehouseId||'');
  const ids=[...new Set(body.partIds)];
  if(ids.some(id=>typeof id!=='string'||!PART.test(id)))
    return fail('Nieprawidłowa część.',400);
  try{
    if(!await verifyWarehouse(env.DB,auth.user,warehouseId))
      return fail('Nie masz dostępu do tego magazynu.',403);
    const rows=await env.DB.prepare(
      'SELECT id FROM parts WHERE active=1 AND id IN ('+ids.map(()=>'?').join(',')+')'
    ).bind(...ids).all();
    if((rows.results||[]).length!==ids.length)
      return fail('Niektóre części nie są już dostępne.',409);
    await ensurePrintTable(env.DB);
    const statements=ids.map(id=>env.DB.prepare(
      'INSERT INTO pl_part_label_prints(warehouse_id,part_id,last_print_at,print_count) '+
      "VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1) "+
      'ON CONFLICT(warehouse_id,part_id) DO UPDATE SET '+
      'last_print_at=excluded.last_print_at,print_count=pl_part_label_prints.print_count+1'
    ).bind(warehouseId,id));
    for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
    return workerJson({ok:true,message:'Zapisano datę wydruku.',updated:ids.length});
  }catch(error){
    console.error('Office label date save failed',error?.name||'Error');
    return fail('Nie udało się zapisać daty wydruku.',503);
  }
}
