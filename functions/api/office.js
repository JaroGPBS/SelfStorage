// GPBS Storage - independent, read-only office API (Poland).
// Existing /panel/ admin API and /pl/ warehouse operations are untouched.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';

const ALLOWED=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
const WAREHOUSE=/^[A-Z0-9-]{2,50}$/;
const PART=/^[A-Za-z0-9_-]{1,100}$/;
const SESSION=/^PL-SES-[a-f0-9-]{36}$/;
const INVENTORY=/^PL-INV-[a-f0-9-]{36}$/;
const error=(message,status=400)=>workerJson({ok:false,error:message},status);

async function selectRows(db,sql,values=[]){
  const query=db.prepare(sql).bind(...values);
  const response=await query.all();
  return response.results||[];
}
async function tableExists(db,name){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
  return Boolean(row);
}
export async function onRequestGet({request,env}){
  if(!workerAuthReady(env))return error('Panel biurowy nie jest skonfigurowany.',503);
  let user;
  try{user=await verifyWorkerSession(request,env);}
  catch{return error('Nie można potwierdzić sesji.',503);}
  if(!user)return error('Zaloguj się do panelu.',401);
  if(!ALLOWED.has(user.role))return error('Brak dostępu do panelu biurowego.',403);
  const url=new URL(request.url);
  const view=url.searchParams.get('view')||'warehouses';
  if(view==='warehouses'){
    return workerJson({ok:true,user,warehouses:user.warehouses});
  }
  const warehouseId=url.searchParams.get('warehouse')||'';
  if(!WAREHOUSE.test(warehouseId))return error('Nieprawidłowy magazyn.');
  if(!user.warehouses.some(w=>w.id===warehouseId))
    return error('Brak uprawnień do tego magazynu.',403);
  try{
    if(view==='stocks'){
      const parts=await selectRows(env.DB,
        'SELECT p.id,p.part_number,p.name,p.sap_number,s.quantity '+
        'FROM parts p LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
        'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE,p.id LIMIT 3000',
        [warehouseId]);
      return workerJson({ok:true,warehouseId,parts});
    }
    if(view==='part'){
      const partId=url.searchParams.get('part')||'';
      if(!PART.test(partId))return error('Nieprawidłowa część.');
      const part=await env.DB.prepare(
        'SELECT p.id,p.name,p.sap_number,p.part_number,s.quantity '+
        'FROM parts p LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
        'WHERE p.id=? AND p.active=1'
      ).bind(warehouseId,partId).first();
      if(!part)return error('Nie znaleziono części.',404);
      let delivery=null,inventory=null;
      if(await tableExists(env.DB,'pl_warehouse_session_lines')){
        delivery=await env.DB.prepare(
          "SELECT s.committed_at AS date,l.quantity FROM pl_warehouse_sessions s "+
          "JOIN pl_warehouse_session_lines l ON l.session_id=s.id "+
          "WHERE s.warehouse_id=? AND l.part_id=? AND l.direction='PZ' "+
          'ORDER BY s.committed_at DESC,s.id DESC LIMIT 1'
        ).bind(warehouseId,partId).first();
      }
      if(await tableExists(env.DB,'pl_warehouse_inventory_changes')){
        inventory=await env.DB.prepare(
          'SELECT i.committed_at AS date FROM pl_warehouse_inventory_changes c '+
          'JOIN pl_warehouse_inventories i ON i.id=c.inventory_id '+
          'WHERE c.warehouse_id=? AND c.part_id=? '+
          'ORDER BY i.committed_at DESC,i.id DESC LIMIT 1'
        ).bind(warehouseId,partId).first();
      }
      return workerJson({ok:true,part,delivery,inventory});
    }
    if(view==='documents'){
      const direction=url.searchParams.get('direction')||'';
      if(!['PZ','WZ'].includes(direction))return error('Nieprawidłowy typ dokumentu.');
      if(!await tableExists(env.DB,'pl_warehouse_sessions'))
        return workerJson({ok:true,documents:[],total:0,matched:0});
      const term=(url.searchParams.get('term')||'').trim().slice(0,100);
      const join='FROM pl_warehouse_sessions s '+
        'JOIN pl_warehouse_session_lines l ON l.session_id=s.id '+
        'LEFT JOIN users u ON u.id=s.actor_id ';
      const matching="AND (?='' OR LOWER(s.counterparty) LIKE '%'||LOWER(?)||'%' "+
        "OR LOWER(COALESCE(u.name,'')) LIKE '%'||LOWER(?)||'%' "+
        "OR s.committed_at LIKE '%'||?||'%' "+
        "OR EXISTS (SELECT 1 FROM pl_warehouse_session_lines x "+
        "JOIN parts p ON p.id=x.part_id WHERE x.session_id=s.id AND x.direction=? "+
        "AND (LOWER(p.name) LIKE '%'||LOWER(?)||'%' "+
        "OR LOWER(COALESCE(p.sap_number,'')) LIKE '%'||LOWER(?)||'%' "+
        "OR LOWER(COALESCE(p.part_number,'')) LIKE '%'||LOWER(?)||'%')))";
      const params=[warehouseId,direction,term,term,term,term,direction,term,term,term];
      const where='WHERE s.warehouse_id=? AND l.direction=? ';
      const count=await env.DB.prepare(
        'SELECT COUNT(DISTINCT s.id) AS n '+join+where
      ).bind(warehouseId,direction).first();
      const matches=await env.DB.prepare(
        'SELECT COUNT(DISTINCT s.id) AS n '+join+where+matching
      ).bind(...params).first();
      const docs=await selectRows(env.DB,
        'SELECT s.id,s.committed_at AS date,s.counterparty,'+
        'COALESCE(u.name,s.actor_id) AS worker,COUNT(l.part_id) AS positions,'+
        'COALESCE(SUM(l.quantity),0) AS units,'+
        'COALESCE(SUM(l.shortage_quantity),0) AS shortage '+
        join+where+matching+
        ' GROUP BY s.id ORDER BY s.committed_at DESC,s.id DESC LIMIT 200',params);
      return workerJson({
        ok:true,documents:docs,total:Number(count?.n||0),matched:Number(matches?.n||0)
      });
    }
    if(view==='document'){
      const id=url.searchParams.get('id')||'';
      const direction=url.searchParams.get('direction')||'';
      if(!SESSION.test(id)||!['PZ','WZ'].includes(direction))return error('Nieprawidłowy dokument.');
      const rows=await selectRows(env.DB,
        'SELECT p.sap_number,p.part_number,p.name,l.quantity,'+
        'COALESCE(l.shortage_quantity,0) AS shortage_quantity '+
        'FROM pl_warehouse_sessions s JOIN pl_warehouse_session_lines l ON l.session_id=s.id '+
        'JOIN parts p ON p.id=l.part_id '+
        'WHERE s.id=? AND s.warehouse_id=? AND l.direction=? '+
        'ORDER BY p.name COLLATE NOCASE',[id,warehouseId,direction]);
      return workerJson({ok:true,lines:rows});
    }
    if(view==='inventories'){
      if(!await tableExists(env.DB,'pl_warehouse_inventories'))return workerJson({ok:true,inventories:[]});
      const rows=await selectRows(env.DB,
        'SELECT i.id,i.committed_at AS date,COALESCE(u.name,i.actor_id) AS worker,'+
        'COUNT(l.part_id) AS positions FROM pl_warehouse_inventories i '+
        'LEFT JOIN pl_warehouse_inventory_lines l ON l.inventory_id=i.id '+
        'LEFT JOIN users u ON u.id=i.actor_id '+
        "WHERE i.warehouse_id=? AND i.status='COMMITTED' "+
        'GROUP BY i.id ORDER BY i.committed_at DESC,i.id DESC LIMIT 200',[warehouseId]);
      return workerJson({ok:true,inventories:rows});
    }
    if(view==='inventory'){
      const id=url.searchParams.get('id')||'';
      if(!INVENTORY.test(id))return error('Nieprawidłowa inwentaryzacja.');
      const rows=await selectRows(env.DB,
        'SELECT p.sap_number,p.part_number,p.name,c.quantity_before,c.quantity_after '+
        'FROM pl_warehouse_inventory_changes c JOIN parts p ON p.id=c.part_id '+
        'JOIN pl_warehouse_inventories i ON i.id=c.inventory_id '+
        "WHERE c.inventory_id=? AND c.warehouse_id=? AND i.status='COMMITTED' "+
        'ORDER BY p.name COLLATE NOCASE',[id,warehouseId]);
      return workerJson({ok:true,lines:rows});
    }
    return error('Nieznany widok.',400);
  }catch(err){
    console.error('Office API read failed',err?.name||'Error');
    return error('Nie udało się pobrać danych z D1.',503);
  }
}
