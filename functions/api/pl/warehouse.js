// GPBS Storage — read-only warehouse data for Polish mobile warehouse workers.
// Only ADMIN, KIEROWNIK and MAGAZYNIER can use this route.
// Every request verifies the signed session, live role, active account and
// warehouse grants in D1. The legacy French /api gateway is not involved.
import { verifyWorkerSession, workerJson, workerAuthReady } from '../../../lib/pl-worker-auth.js';

const STOCK_ROLES = new Set(['ADMIN', 'KIEROWNIK', 'MAGAZYNIER']);
const PAGE_SIZE = 60;
const MAX_PAGE = 100;

function failure(error, status=400) {
  return workerJson({ok:false,error},status);
}

export async function onRequestGet({request,env}) {
  if(!workerAuthReady(env)) return failure('Moduł magazynu nie jest skonfigurowany.',503);

  let user;
  try {
    user=await verifyWorkerSession(request,env);
  } catch(error) {
    console.error('GPBS PL warehouse session validation failed',error?.name||'Error');
    return failure('Nie można zweryfikować dostępu.',503);
  }
  if(!user)return failure('Sesja wygasła. Zaloguj się ponownie.',401);
  if(!STOCK_ROLES.has(user.role))return failure('Ta rola nie ma dostępu do modułu magazynowego.',403);

  const url=new URL(request.url);
  const warehouseId=url.searchParams.get('warehouse')||'';
  const query=(url.searchParams.get('q')||'').trim();
  const pageValue=url.searchParams.get('page')||'0';
  const view=url.searchParams.get('view')||'parts';
  if(!['parts','summary'].includes(view)||
    !/^[A-Z0-9-]{2,50}$/.test(warehouseId)||query.length>80||
    !/^(0|[1-9][0-9]{0,2})$/.test(pageValue)||Number(pageValue)>MAX_PAGE) {
    return failure('Nieprawidłowe parametry.',400);
  }

  // This guard uses the latest server-side grants returned by verification;
  // a user cannot change their warehouse by editing URL parameters.
  if(!user.warehouses.some(w=>w.id===warehouseId)) {
    return failure('Nie masz dostępu do tego magazynu.',403);
  }
  try {
    const warehouse=await env.DB.prepare(
      "SELECT id,name FROM warehouses WHERE id=? AND country_code='PL' AND active=1"
    ).bind(warehouseId).first();
    if(!warehouse)return failure('Magazyn jest niedostępny.',404);

    // Explicitly missing warehouse_stock row is UNKNOWN, never zero.
    // A recorded quantity=0 is different from no inventory data.
    const count=await env.DB.prepare(
      'SELECT COUNT(*) AS catalog_items,COUNT(s.part_id) AS known_items '+
      'FROM parts p LEFT JOIN warehouse_stock s '+
      'ON s.part_id=p.id AND s.warehouse_id=? WHERE p.active=1'
    ).bind(warehouseId).first();

    if(view==='summary') {
      return workerJson({
        ok:true,
        warehouse:{id:warehouse.id,name:warehouse.name},
        stock:{knownItems:Number(count?.known_items||0),catalogItems:Number(count?.catalog_items||0)}
      });
    }

    const filters=['p.active=1'];
    const params=[warehouseId];
    if(query) {
      filters.push("(p.part_number LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' "+
        "OR p.sap_number LIKE ? ESCAPE '\\')");
      const q='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
      params.push(q,q,q);
    }
    const sql='SELECT p.id,p.part_number,p.name,p.sap_number,s.quantity '+
      'FROM parts p LEFT JOIN warehouse_stock s '+
      'ON s.part_id=p.id AND s.warehouse_id=? '+
      'WHERE '+filters.join(' AND ')+' '+
      'ORDER BY p.name COLLATE NOCASE,p.id LIMIT ? OFFSET ?';
    params.push(PAGE_SIZE+1,Number(pageValue)*PAGE_SIZE);
    const result=await env.DB.prepare(sql).bind(...params).all();
    const rows=result.results||[];
    return workerJson({
      ok:true,
      warehouse:{id:warehouse.id,name:warehouse.name},
      stock:{
        items:rows.slice(0,PAGE_SIZE).map(p=>({
          id:p.id,
          number:p.part_number,
          name:p.name,
          sap:p.sap_number||null,
          quantity:p.quantity===null||p.quantity===undefined?null:Number(p.quantity)
        })),
        page:Number(pageValue),
        hasMore:rows.length>PAGE_SIZE,
        knownItems:Number(count?.known_items||0),
        catalogItems:Number(count?.catalog_items||0)
      }
    });
  }catch(error) {
    console.error('GPBS PL stock read failed',error?.name||'Error');
    return failure('Nie udało się pobrać stanów magazynowych.',503);
  }
}

export function onRequestPost() {
  return failure('Ten moduł jest tylko do odczytu.',405);
}
