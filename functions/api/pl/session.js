// GPBS Storage PL: one atomic receipt/issue session, worker PIN cookie only.
// Never calls the legacy French Apps Script API or accepts raw PINs.
import {verifyWorkerSession,workerJson,workerAuthReady} from '../../../lib/pl-worker-auth.js';

const ROLES=new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
const ID=/^PL-SES-[a-f0-9-]{36}$/;
const WH=/^[A-Z0-9-]{2,50}$/;
const PART=/^[A-Za-z0-9_-]{1,100}$/;
const MAX_LINES=80;
const MAX_QUANTITY=100000;
const MIGRATION='db/13-pl-confirmed-overissues.sql';

function fail(message,status=400){return workerJson({ok:false,error:message},status);}

async function authorized(request,env,warehouseId){
  if(!workerAuthReady(env))return {error:fail('Brak konfiguracji sesji pracownika.',503)};
  if(!WH.test(warehouseId))return {error:fail('Nieprawidłowy magazyn.',400)};
  const user=await verifyWorkerSession(request,env);
  if(!user)return {error:fail('Sesja wygasła. Zaloguj się ponownie.',401)};
  if(!ROLES.has(user.role))return {error:fail('Brak uprawnień do operacji magazynowych.',403)};
  if(!user.warehouses.some(w=>w.id===warehouseId))
    return {error:fail('Brak dostępu do wybranego magazynu.',403)};
  const warehouse=await env.DB.prepare(
    "SELECT id,name FROM warehouses WHERE id=? AND active=1 AND country_code='PL'"
  ).bind(warehouseId).first();
  if(!warehouse)return {error:fail('Magazyn jest niedostępny.',404)};
  return {user,warehouse};
}

async function schemaReady(db){
  const r=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master "+
    "WHERE type='table' AND name IN ('pl_warehouse_sessions','pl_warehouse_session_lines')").first();
  if(Number(r?.n)!==2)return false;
  const columns=await db.prepare('PRAGMA table_info(pl_warehouse_session_lines)').all();
  return ['before_unknown','shortage_quantity'].every(name=>
    (columns.results||[]).some(c=>c.name===name));
}

function normalizeLines(value,description){
  if(!Array.isArray(value))throw Error('Nieprawidłowa lista '+description+'.');
  const used=new Set();
  return value.map(row=>{
    const partId=String(row?.partId||'');
    const quantity=row?.quantity;
    if(!PART.test(partId)||!Number.isSafeInteger(quantity)||
      quantity<1||quantity>MAX_QUANTITY||used.has(partId))
      throw Error('Sprawdź części i ilości na liście '+description+'.');
    used.add(partId);
    return {partId,quantity};
  });
}

function normalize(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Nieprawidłowa sesja.');
  const id=String(body.id||'');
  const warehouseId=String(body.warehouseId||'');
  const counterparty=String(body.counterparty||'').trim().replace(/\s+/g,' ');
  if(!ID.test(id)||!WH.test(warehouseId))throw Error('Nieprawidłowy identyfikator sesji.');
  if(counterparty.length<2||counterparty.length>120||
    /[\u0000-\u001f\u007f]/.test(counterparty))
    throw Error('Podaj ekipę, dostawcę lub odbiorcę (2–120 znaków).');
  const pz=normalizeLines(body.pz,'PZ');
  const wz=normalizeLines(body.wz,'WZ');
  if(pz.length+wz.length<1||pz.length+wz.length>MAX_LINES)
    throw Error('Dodaj od 1 do '+MAX_LINES+' pozycji PZ/WZ w jednej sesji.');
  const action=body.action===undefined||body.action==='commit'?'commit':body.action;
  if(!['preview','commit'].includes(action))throw Error('Nieznana operacja.');
  const stockSnapshot=body.stockSnapshot;
  if(action==='commit'){
    const parts=new Set([...pz,...wz].map(r=>r.partId));
    if(!Array.isArray(stockSnapshot)||stockSnapshot.length!==parts.size)
      throw Error('Stan magazynu musi być sprawdzony przed zatwierdzeniem. Wróć do podsumowania.');
    const ids=new Set();
    for(const row of stockSnapshot){
      if(!row||!parts.has(row.partId)||ids.has(row.partId)||
         (row.quantity!==null&&(!Number.isSafeInteger(row.quantity)||row.quantity<0)))
        throw Error('Nieprawidłowe potwierdzenie stanów magazynowych.');
      ids.add(row.partId);
    }
  }
  return {id,warehouseId,counterparty,pz,wz,action,
    stockSnapshot,confirmedOverissue:body.confirmedOverissue===true};
}

async function duplicate(db,input,actorId){
  const existing=await db.prepare(
    'SELECT id,warehouse_id,actor_id,counterparty,committed_at '+
    'FROM pl_warehouse_sessions WHERE id=?'
  ).bind(input.id).first();
  if(!existing)return null;
  const saved=await db.prepare(
    'SELECT direction,part_id,quantity FROM pl_warehouse_session_lines WHERE session_id=?'
  ).bind(input.id).all();
  const expected=new Map();
  for(const direction of ['pz','wz']){
    for(const line of input[direction])
      expected.set(direction.toUpperCase()+':'+line.partId,line.quantity);
  }
  const rows=saved.results||[];
  const same=existing.warehouse_id===input.warehouseId&&
    existing.actor_id===actorId&&existing.counterparty===input.counterparty&&
    rows.length===expected.size&&rows.every(row=>
      expected.get(row.direction+':'+row.part_id)===Number(row.quantity));
  if(!same)return fail('Identyfikator sesji został już użyty dla innych danych.',409);
  return workerJson({ok:true,id:input.id,alreadySaved:true,
    committedAt:existing.committed_at,pzItems:input.pz.length,wzItems:input.wz.length});
}

async function preview(db,input){
  const combined=new Map();
  for(const line of input.pz)combined.set(line.partId,{partId:line.partId,pz:line.quantity,wz:0});
  for(const line of input.wz){
    const row=combined.get(line.partId)||{partId:line.partId,pz:0,wz:0};
    row.wz=line.quantity;
    combined.set(line.partId,row);
  }
  const parts=[...combined.values()];
  const result=await db.prepare(
    "SELECT json_extract(j.value,'$.partId') AS part_id,"+
    'p.id AS valid_id,p.name AS name,p.active AS active,s.quantity AS quantity '+
    "FROM json_each(?) j LEFT JOIN parts p ON p.id=json_extract(j.value,'$.partId') "+
    'LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=?'
  ).bind(JSON.stringify(parts),input.warehouseId).all();
  const rows=new Map((result.results||[]).map(r=>[r.part_id,r]));
  if(rows.size!==parts.length||parts.some(p=>!rows.get(p.partId)?.valid_id||
    Number(rows.get(p.partId).active)!==1))
    return fail('Część została wyłączona lub nie istnieje w katalogu. Odśwież listę.',409);
  const stockSnapshot=[];
  const warnings=[];
  for(const p of parts){
    const row=rows.get(p.partId);
    const stock=row.quantity===null||row.quantity===undefined?null:Number(row.quantity);
    stockSnapshot.push({partId:p.partId,quantity:stock});
    if(p.wz===0)continue;
    const available=(stock??0)+p.pz;
    const shortfall=Math.max(0,p.wz-available);
    if(shortfall>0)warnings.push({partId:p.partId,name:row.name||p.partId,
      unknown:stock===null,available:stock===null?null:available,
      received:p.pz,issued:p.wz,shortfall});
  }
  return workerJson({ok:true,stockSnapshot,warnings,requiresConfirmation:warnings.length>0});
}

async function commit(db,input,actorId){
  const prior=await duplicate(db,input,actorId);
  if(prior)return prior;

  const combined=new Map();
  for(const line of input.pz){
    combined.set(line.partId,{id:line.partId,pz:line.quantity,wz:0});
  }
  for(const line of input.wz){
    const x=combined.get(line.partId)||{id:line.partId,pz:0,wz:0};
    x.wz=line.quantity;
    combined.set(line.partId,x);
  }
  const parts=[...combined.values()];
  // New, previously uncounted part: PZ establishes known stock, never fake
  // a historical "zero" as an inventory result. before_unknown=1 audits it.
  // WZ-only on an unknown part remains blocked; PZ+WZ can work together if
  // the newly received quantity covers the issue.
  // One JSON bind for all parts respects D1's 100 binds per query limit.
  const partGuards=
    "NOT EXISTS(SELECT 1 FROM json_each(?) AS e "+
    "LEFT JOIN parts p ON p.id=json_extract(e.value,'$.partId') "+
    "LEFT JOIN warehouse_stock s ON s.warehouse_id=? AND s.part_id=p.id "+
    "WHERE p.id IS NULL OR p.active IS NOT 1 "+
    "OR (s.part_id IS NULL AND "+
    "(CAST(json_extract(e.value,'$.pz') AS INTEGER)=0 "+
    "OR CAST(json_extract(e.value,'$.delta') AS INTEGER)<0)) "+
    "OR (s.part_id IS NOT NULL AND "+
    "s.quantity+CAST(json_extract(e.value,'$.delta') AS INTEGER) NOT BETWEEN 0 AND 100000000))";
  const guardSql=
    'INSERT INTO pl_warehouse_sessions '+
    '(id,warehouse_id,actor_id,counterparty,commit_guard) VALUES (?,?,?,?, '+
    'CASE WHEN EXISTS(SELECT 1 FROM users u LEFT JOIN user_archives a ON a.user_id=u.id '+
    "WHERE u.id=? AND u.active=1 AND a.user_id IS NULL AND "+
    "u.role_code IN ('ADMIN','KIEROWNIK','MAGAZYNIER')) "+
    'AND EXISTS(SELECT 1 FROM user_warehouse_access g JOIN warehouses w '+
    "ON w.id=g.warehouse_id WHERE g.user_id=? AND g.warehouse_id=? "+
    "AND w.active=1 AND w.country_code='PL') AND "+
    partGuards+' THEN 1 ELSE 0 END)';
  const guardArgs=[input.id,input.warehouseId,actorId,input.counterparty,
    actorId,actorId,input.warehouseId,
    JSON.stringify(parts.map(p=>({partId:p.id,pz:p.pz,delta:p.pz-p.wz}))),input.warehouseId];
  const statements=[db.prepare(guardSql).bind(...guardArgs)];
  for(const part of parts){
    // Record an accurate before/after snapshot BEFORE updating the stock.
    // If a part is both received and issued, PZ logically precedes WZ.
    if(part.pz){
      // Snapshot BEFORE initializing a missing stock row. Unknown stays
      // explicitly distinguishable from a verified count of zero.
      statements.push(db.prepare(
        'INSERT INTO pl_warehouse_session_lines '+
        '(session_id,direction,part_id,quantity,quantity_before,quantity_after,before_unknown) '+
        "SELECT ?,'PZ',?,?,COALESCE(s.quantity,0),COALESCE(s.quantity,0)+?, "+
        'CASE WHEN s.part_id IS NULL THEN 1 ELSE 0 END '+
        'FROM parts p LEFT JOIN warehouse_stock s '+
        'ON s.part_id=p.id AND s.warehouse_id=? WHERE p.id=?'
      ).bind(input.id,part.id,part.pz,part.pz,input.warehouseId,part.id));
      // Initialize only parts that are being RECEIVED; a WZ-only session
      // must never implicitly invent a zero baseline.
      statements.push(db.prepare(
        'INSERT OR IGNORE INTO warehouse_stock '+
        '(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,0,CURRENT_TIMESTAMP)'
      ).bind(input.warehouseId,part.id));
    }
    if(part.wz){
      statements.push(db.prepare(
        'INSERT INTO pl_warehouse_session_lines '+
        '(session_id,direction,part_id,quantity,quantity_before,quantity_after,before_unknown) '+
        "SELECT ?,'WZ',?,?,s.quantity+?,s.quantity+?-?,0 FROM warehouse_stock s "+
        'WHERE s.warehouse_id=? AND s.part_id=?'
      ).bind(input.id,part.id,part.wz,part.pz,part.pz,part.wz,
        input.warehouseId,part.id));
    }
    statements.push(db.prepare(
      'UPDATE warehouse_stock SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP '+
      'WHERE warehouse_id=? AND part_id=?'
    ).bind(part.pz-part.wz,input.warehouseId,part.id));
  }
  try{
    await db.batch(statements);
    const row=await db.prepare(
      'SELECT committed_at FROM pl_warehouse_sessions WHERE id=?'
    ).bind(input.id).first();
    return workerJson({ok:true,id:input.id,alreadySaved:false,
      committedAt:row?.committed_at||null,
      pzItems:input.pz.length,wzItems:input.wz.length});
  }catch(error){
    // A lost HTTP response MUST NOT create another document on retry.
    const saved=await duplicate(db,input,actorId).catch(()=>null);
    if(saved)return saved;
    if(/constraint|foreign key|unique/i.test(String(error?.message||'')))
      return fail('Nie zapisano sesji. Sprawdź dostępne ilości dla WZ '+
        'oraz uprawnienia do magazynu. Przyjęcie PZ nie wymaga inwentaryzacji.',409);
    console.error('PL warehouse session commit failed',error?.name||'Error');
    return fail('Nie udało się zapisać sesji. Ponów bez zmieniania danych.',503);
  }
}

export async function onRequestGet({request,env}){
  try{
    const url=new URL(request.url);
    const wh=url.searchParams.get('warehouse')||'';
    const auth=await authorized(request,env,wh);
    if(auth.error)return auth.error;
    const ready=await schemaReady(env.DB);
    const view=url.searchParams.get('view')||'status';
    if(view==='status')return workerJson({ok:true,ready,warehouse:auth.warehouse});
    if(view!=='recent')return fail('Nieprawidłowy widok.',400);
    if(!ready)return workerJson({ok:true,ready,history:[]});
    const rows=await env.DB.prepare(
      'SELECT s.id,s.counterparty,s.committed_at,s.actor_id,u.name AS operator_name,'+
      "SUM(CASE WHEN l.direction='PZ' THEN 1 ELSE 0 END) AS pz_items,"+
      "SUM(CASE WHEN l.direction='WZ' THEN 1 ELSE 0 END) AS wz_items "+
      'FROM pl_warehouse_sessions s LEFT JOIN pl_warehouse_session_lines l '+
      'ON l.session_id=s.id LEFT JOIN users u ON u.id=s.actor_id '+
      'WHERE s.warehouse_id=? GROUP BY s.id ORDER BY s.committed_at DESC,s.id DESC LIMIT 15'
    ).bind(wh).all();
    const sessions=rows.results||[];
    if(!sessions.length)return workerJson({ok:true,ready,history:[]});
    const ids=sessions.map(r=>r.id);
    const parts=await env.DB.prepare(
      'SELECT l.session_id,l.direction,l.part_id,l.quantity,'+
      'CASE WHEN l.before_unknown=1 THEN NULL ELSE l.quantity_before END AS quantity_before,'+
      'l.quantity_after,p.name AS part_name,p.part_number '+
      'FROM pl_warehouse_session_lines l LEFT JOIN parts p ON p.id=l.part_id '+
      'WHERE l.session_id IN ('+ids.map(()=>'?').join(',')+') '+
      'ORDER BY CASE l.direction WHEN \'PZ\' THEN 0 ELSE 1 END, l.part_id'
    ).bind(...ids).all();
    const bySession=new Map(ids.map(id=>[id,[]]));
    for(const line of (parts.results||[]))
      bySession.get(line.session_id)?.push({
        direction:line.direction,partId:line.part_id,
        name:line.part_name||line.part_number||line.part_id,
        number:line.part_number||null,quantity:Number(line.quantity),
        before:line.quantity_before===null?null:Number(line.quantity_before),
        after:Number(line.quantity_after)
      });
    return workerJson({ok:true,ready,history:sessions.map(r=>({
      id:r.id,counterparty:r.counterparty,committedAt:r.committed_at,
      operator:r.operator_name||r.actor_id,
      pzItems:Number(r.pz_items||0),wzItems:Number(r.wz_items||0),
      lines:bySession.get(r.id)||[]
    }))});
  }catch(error){
    console.error('PL session GET failed',error?.name||'Error');
    return fail('Nie można pobrać danych sesji.',503);
  }
}

export async function onRequestPost({request,env}){
  if(!workerAuthReady(env))return fail('Brak konfiguracji.',503);
  if(request.headers.get('Origin')!==new URL(request.url).origin)
    return fail('Niedozwolone pochodzenie żądania.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany JSON.',415);
  let input;
  try{
    const raw=await request.text();
    if(raw.length>16000)return fail('Zbyt duża sesja.',413);
    input=normalize(JSON.parse(raw));
  }catch(error){return fail(error?.message||'Nieprawidłowe dane.',400);}
  try{
    const auth=await authorized(request,env,input.warehouseId);
    if(auth.error)return auth.error;
    if(!await schemaReady(env.DB))
      return fail('Najpierw wykonaj migrację '+MIGRATION+'.',503);
    return await commit(env.DB,input,auth.user.id);
  }catch(error){
    console.error('PL session POST failed',error?.name||'Error');
    return fail('Nie można zweryfikować operacji magazynowej.',503);
  }
}
