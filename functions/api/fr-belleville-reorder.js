// Belleville reorder thresholds. Separate from warehouse_stock; no stock writes.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
const ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
const fail=(message,status)=>Object.assign(new Error(message),{status});
async function authorize(request,env,warehouse){
  if(!workerAuthReady(env))throw fail('Panel nie jest skonfigurowany.',503);
  const user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  if(!user)throw fail('Zaloguj się ponownie.',401);
  if(!user.apps?.office||!ROLES.has(user.role)||!user.markets?.FR||user.features?.stocks===false)
    throw fail('Brak uprawnień do części Belleville.',403);
  if(!/^[A-Z0-9-]{2,50}$/.test(warehouse))throw fail('Nieprawidłowy magazyn.',400);
  const w=await env.DB.prepare("SELECT w.id,w.name FROM warehouses w JOIN user_warehouse_access a ON a.warehouse_id=w.id WHERE w.id=? AND a.user_id=? AND w.active=1 AND w.country_code='FR'").bind(warehouse,user.id).first();
  const name=String(w?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^magazyn/,'');
  if(!w||name!=='belleville')throw fail('Brak dostępu do magazynu Belleville.',403);
  return user;
}
const error=e=>workerJson({ok:false,error:e?.status?e.message:'Nie udało się odczytać lub zapisać minimum.'},e?.status||503);
export async function onRequestGet({request,env}){
  try{
    const warehouse=new URL(request.url).searchParams.get('warehouse')||'';
    await authorize(request,env,warehouse);
    const exists=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_belleville_reorder_minimums'").first();
    const rows=exists?(await env.DB.prepare('SELECT part_id,minimum FROM fr_belleville_reorder_minimums WHERE warehouse_id=?').bind(warehouse).all()).results||[]:[];
    return workerJson({ok:true,minimums:rows});
  }catch(e){return error(e);}
}
export async function onRequestPost({request,env}){
  try{
    const url=new URL(request.url);
    if(request.headers.get('Origin')!==url.origin)throw fail('Niedozwolona domena.',403);
    if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))throw fail('Wymagany JSON.',415);
    const raw=await request.text();
    if(raw.length>1500)throw fail('Nieprawidłowe dane.',400);
    let b;try{b=JSON.parse(raw);}catch{throw fail('Nieprawidłowe dane.',400);}
    if(!b||typeof b!=='object')throw fail('Nieprawidłowe dane.',400);
    const warehouse=String(b.warehouse||'');
    const user=await authorize(request,env,warehouse);
    if(typeof b.partId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(b.partId))throw fail('Nieprawidłowa część.',400);
    if(b.minimum!==null&&(!Number.isInteger(b.minimum)||b.minimum<0||b.minimum>99999))throw fail('Nieprawidłowe minimum.',400);
    const part=await env.DB.prepare('SELECT id FROM parts WHERE id=? AND active=1').bind(b.partId).first();
    if(!part)throw fail('Część nie istnieje.',404);
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS fr_belleville_reorder_minimums (warehouse_id TEXT NOT NULL,part_id TEXT NOT NULL,minimum INTEGER NOT NULL CHECK(minimum BETWEEN 0 AND 99999),updated_by TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(warehouse_id,part_id))').run();
    if(b.minimum===null){
      await env.DB.prepare('DELETE FROM fr_belleville_reorder_minimums WHERE warehouse_id=? AND part_id=?').bind(warehouse,b.partId).run();
    }else{
      await env.DB.prepare('INSERT INTO fr_belleville_reorder_minimums (warehouse_id,part_id,minimum,updated_by) VALUES (?,?,?,?) ON CONFLICT(warehouse_id,part_id) DO UPDATE SET minimum=excluded.minimum,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP').bind(warehouse,b.partId,b.minimum,user.id).run();
    }
    return workerJson({ok:true,minimum:b.minimum});
  }catch(e){return error(e);}
}
