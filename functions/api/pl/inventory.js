// GPBS Storage PL — warehouse inventory draft and controlled adjustments.
// Isolated from legacy French /api. Applies only to authorized PL warehouses.
// PL_INVENTORY_PUBLISH_ENABLED=false can temporarily disable stock publishing.
import { verifyWorkerSession, workerJson, workerAuthReady } from '../../../lib/pl-worker-auth.js';

const ALLOWED_ROLES = new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
const MAX_LINES = 5000; // operational safety ceiling; 300+ parts per sheet are supported
const MAX_QUANTITY = 100000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const WAREHOUSE_PATTERN = /^[A-Z0-9-]{2,50}$/;
const MIGRATION = 'db/08-pl-warehouse-inventories.sql';

function fail(message,status=400) {return workerJson({ok:false,error:message},status);}

async function checkTables(db) {
  const rows = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN " +
    "('pl_warehouse_inventories','pl_warehouse_inventory_lines','pl_warehouse_inventory_changes')"
  ).all();
  return (rows.results||[]).length===3;
}

async function allowed(request,env,warehouseId) {
  if(!workerAuthReady(env))
    return {error:fail('Brak konfiguracji logowania pracownika.',503)};
  if(!WAREHOUSE_PATTERN.test(warehouseId))
    return {error:fail('Nieprawidłowy magazyn.',400)};
  const user = await verifyWorkerSession(request,env);
  if(!user)return {error:fail('Sesja wygasła. Zaloguj się ponownie.',401)};
  if(!ALLOWED_ROLES.has(user.role))
    return {error:fail('Ta rola nie może prowadzić inwentaryzacji.',403)};
  if(!user.warehouses.some(w=>w.id===warehouseId))
    return {error:fail('Brak uprawnień do tego magazynu.',403)};
  return {user};
}

async function draftFor(db,warehouseId,userId) {
  return db.prepare(
    "SELECT id,revision,created_at,updated_at FROM pl_warehouse_inventories " +
    "WHERE warehouse_id=? AND actor_id=? AND status='DRAFT' LIMIT 1"
  ).bind(warehouseId,userId).first();
}

async function readDraft(db,warehouseId,userId) {
  const draft=await draftFor(db,warehouseId,userId);
  if(!draft)return {id:null,revision:0,lines:[],count:0};
  const result=await db.prepare(
    'SELECT l.part_id,l.counted_quantity,l.base_quantity,p.name,p.part_number,p.sap_number '+
    'FROM pl_warehouse_inventory_lines l LEFT JOIN parts p ON p.id=l.part_id '+
    'WHERE l.inventory_id=? ORDER BY l.updated_at DESC,l.part_id'
  ).bind(draft.id).all();
  const lines=(result.results||[]).map(r=>({
    partId:r.part_id, name:r.name||'Pozycja niedostępna',
    number:r.part_number||r.part_id,sap:r.sap_number||null,
    quantity:Number(r.counted_quantity),
    baseQuantity:r.base_quantity===null?null:Number(r.base_quantity)
  }));
  return {id:draft.id,revision:draft.revision,createdAt:draft.created_at,lines,count:lines.length};
}

async function getWarehouse(db,warehouseId) {
  return db.prepare(
    "SELECT id,name FROM warehouses WHERE id=? AND country_code='PL' AND active=1"
  ).bind(warehouseId).first();
}

export async function onRequestGet({request,env}) {
  try {
    const warehouseId=new URL(request.url).searchParams.get('warehouse')||'';
    const auth=await allowed(request,env,warehouseId);
    if(auth.error)return auth.error;
    if(!await checkTables(env.DB))
      return fail('Najpierw wykonaj migrację D1: '+MIGRATION,503);
    const warehouse=await getWarehouse(env.DB,warehouseId);
    if(!warehouse)return fail('Magazyn jest nieaktywny lub niedostępny.',404);
    const draft=await readDraft(env.DB,warehouseId,auth.user.id);
    const catalog=await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM parts WHERE active=1'
    ).first();
    const pending= draft.id ? await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pl_warehouse_inventory_lines l "+
      "JOIN pl_part_verifications v ON v.part_id=l.part_id "+
      "WHERE l.inventory_id=? AND v.status='PENDING'"
    ).bind(draft.id).first() : {n:0};
    const catalogCount=Number(catalog?.n||0);
    return workerJson({
      ok:true,warehouse,draft,maxLines:MAX_LINES,
      summary:{
        countedParts:draft.count,
        catalogParts:catalogCount,
        notCountedParts:Math.max(0,catalogCount-draft.count),
        pendingVerification:Number(pending?.n||0)
      },
      // Publishing applies only to a live authorized Polish warehouse.
      // Can be explicitly disabled again for maintenance.
      publishingEnabled:env.PL_INVENTORY_PUBLISH_ENABLED!=='false'
    });
  }catch(error){
    console.error('GPBS PL inventory get failed',error?.name||'Error');
    return fail('Nie można odczytać arkusza inwentaryzacji.',503);
  }
}

async function createOrLoadDraft(db,warehouseId,actorId) {
  const draft=await draftFor(db,warehouseId,actorId);
  if(draft)return draft;
  // Unique partial index ensures one open sheet even across tabs.
  await db.prepare(
    "INSERT OR IGNORE INTO pl_warehouse_inventories (id,warehouse_id,actor_id) "+
    "VALUES (?,?,?)"
  ).bind('PL-INV-'+crypto.randomUUID(),warehouseId,actorId).run();
  return draftFor(db,warehouseId,actorId);
}

async function saveLine(db,warehouseId,actorId,partId,quantity) {
  const part=await db.prepare(
    'SELECT id FROM parts WHERE id=? AND active=1'
  ).bind(partId).first();
  if(!part)return fail('Ta część nie istnieje lub jest nieaktywna.',404);

  const draft=await createOrLoadDraft(db,warehouseId,actorId);
  if(!draft)return fail('Nie można utworzyć arkusza.',503);
  // Only the first count freezes the stock baseline. Recounting a line
  // changes its quantity but not that baseline.
  const save=db.prepare(
    'INSERT INTO pl_warehouse_inventory_lines '+
    '(inventory_id,part_id,counted_quantity,base_quantity) '+
    'SELECT ?,p.id,?,(SELECT quantity FROM warehouse_stock WHERE warehouse_id=? AND part_id=p.id) '+
    'FROM parts p WHERE p.id=? AND p.active=1 AND '+
    '((SELECT COUNT(*) FROM pl_warehouse_inventory_lines WHERE inventory_id=?)<? '+
    'OR EXISTS(SELECT 1 FROM pl_warehouse_inventory_lines WHERE inventory_id=? AND part_id=?)) '+
    'AND EXISTS(SELECT 1 FROM pl_warehouse_inventories WHERE id=? AND status=\'DRAFT\') '+
    'ON CONFLICT(inventory_id,part_id) DO UPDATE SET '+
    'counted_quantity=excluded.counted_quantity,updated_at=CURRENT_TIMESTAMP'
  ).bind(draft.id,quantity,warehouseId,partId,draft.id,MAX_LINES,
    draft.id,partId,draft.id);

  const update=db.prepare(
    "UPDATE pl_warehouse_inventories SET revision=revision+1,updated_at=CURRENT_TIMESTAMP "+
    "WHERE id=? AND status='DRAFT' AND "+
    "(SELECT COUNT(*) FROM pl_warehouse_inventory_lines WHERE inventory_id=?)<=?"
  ).bind(draft.id,draft.id,MAX_LINES);
  const results=await db.batch([save,update]);
  if(Number(results[0]?.meta?.changes||0)!==1 ||
     Number(results[1]?.meta?.changes||0)!==1)
    return fail('Arkusz osiągnął techniczny limit '+MAX_LINES+' części. Zatwierdź go przed dodaniem następnych.',409);
  return workerJson({ok:true,draft:await readDraft(db,warehouseId,actorId)});
}

// ADD is incremental (5 then 8 = 13); SET is an explicit correction
// of the total. Each client event is unique and cannot be applied twice.
async function countEvent(db,warehouseId,actorId,body) {
  const partId=String(body.partId||'');
  const quantity=body.quantity;
  const eventId=String(body.eventId||'');
  const type=body.action==='set'?'SET':'ADD';
  if(!ID_PATTERN.test(partId)||!Number.isSafeInteger(quantity)||
    quantity<0||quantity>MAX_QUANTITY||
    !/^PL-EVT-[a-f0-9-]{36}$/.test(eventId))
    return fail('Nieprawidłowy kod, ilość lub identyfikator dodania.',400);

  const part=await db.prepare('SELECT id FROM parts WHERE id=? AND active=1')
    .bind(partId).first();
  if(!part)return fail('Nie znaleziono aktywnej części.',404);
  const draft=await createOrLoadDraft(db,warehouseId,actorId);
  if(!draft)return fail('Nie można przygotować arkusza.',503);
  const previous=await db.prepare(
    'SELECT inventory_id,warehouse_id,part_id,actor_id,event_type,quantity '+
    'FROM pl_warehouse_inventory_events WHERE id=?'
  ).bind(eventId).first();
  if(previous) {
    if(previous.inventory_id===draft.id && previous.warehouse_id===warehouseId &&
      previous.part_id===partId && previous.actor_id===actorId &&
      previous.event_type===type && Number(previous.quantity)===quantity)
      return workerJson({ok:true,alreadySaved:true,
        draft:await readDraft(db,warehouseId,actorId)});
    return fail('To dodanie już istnieje z innymi danymi.',409);
  }

  const stmts=[
    db.prepare(
      'INSERT INTO pl_warehouse_inventory_events '+
      '(id,inventory_id,warehouse_id,part_id,actor_id,event_type,quantity) '+
      'VALUES (?,?,?,?,?,?,?)'
    ).bind(eventId,draft.id,warehouseId,partId,actorId,type,quantity),
    db.prepare(
      'INSERT INTO pl_warehouse_inventory_lines '+
      '(inventory_id,part_id,counted_quantity,base_quantity) '+
      'SELECT ?,p.id,?,(SELECT quantity FROM warehouse_stock WHERE warehouse_id=? AND part_id=p.id) '+
      'FROM parts p WHERE p.id=? AND p.active=1 AND '+
      '((SELECT COUNT(*) FROM pl_warehouse_inventory_lines WHERE inventory_id=?)<? '+
      'OR EXISTS(SELECT 1 FROM pl_warehouse_inventory_lines WHERE inventory_id=? AND part_id=?)) '+
      "AND EXISTS(SELECT 1 FROM pl_warehouse_inventories WHERE id=? AND status='DRAFT') "+
      'ON CONFLICT(inventory_id,part_id) DO UPDATE SET '+
      'counted_quantity='+(
        type==='ADD'
          ? 'pl_warehouse_inventory_lines.counted_quantity+excluded.counted_quantity'
          : 'excluded.counted_quantity'
      )+',updated_at=CURRENT_TIMESTAMP'
    ).bind(draft.id,quantity,warehouseId,partId,draft.id,MAX_LINES,
      draft.id,partId,draft.id),
    db.prepare(
      'UPDATE pl_warehouse_inventories SET revision=revision+1,updated_at=CURRENT_TIMESTAMP, '+
      'commit_guard=CASE WHEN status=\'DRAFT\' AND '+
      'EXISTS(SELECT 1 FROM pl_warehouse_inventory_lines WHERE inventory_id=? AND part_id=?) '+
      'THEN 1 ELSE 0 END WHERE id=?'
    ).bind(draft.id,partId,draft.id)
  ];
  try {
    await db.batch(stmts);
    return workerJson({ok:true,alreadySaved:false,
      draft:await readDraft(db,warehouseId,actorId)});
  }catch(error) {
    // A lost response must not cause a double count when the worker retries.
    const event=await db.prepare(
      'SELECT inventory_id,warehouse_id,part_id,actor_id,event_type,quantity '+
      'FROM pl_warehouse_inventory_events WHERE id=?'
    ).bind(eventId).first().catch(()=>null);
    if(event && event.inventory_id===draft.id && event.warehouse_id===warehouseId &&
      event.part_id===partId && event.actor_id===actorId &&
      event.event_type===type && Number(event.quantity)===quantity)
      return workerJson({ok:true,alreadySaved:true,
        draft:await readDraft(db,warehouseId,actorId)});
    if(String(error?.message||'').toLowerCase().includes('constraint'))
      return fail('Nie można dodać kolejnych sztuk: limit 100000 szt. na część '+
        'lub techniczny limit '+MAX_LINES+' części. Sprawdź policzone ilości.',409);
    throw error;
  }
}

async function createUnverifiedPart(db,warehouseId,actorId,body) {
  const name=String(body.name||'').trim().replace(/\s+/g,' ');
  const rawCode=String(body.code||'').replace(/\u0000/g,'').trim().toUpperCase();
  if(name.length<2||name.length>120)
    return fail('Wpisz nazwę części (od 2 do 120 znaków).',400);
  if(rawCode.length>120||/[\u0000-\u001f\u007f]/.test(rawCode))
    return fail('Niepoprawny kod części.',400);
  const number=/^[A-Z0-9._\/-]{2,80}$/.test(rawCode)
    ?rawCode
    :'NOWA-PL-'+crypto.randomUUID().slice(0,12).toUpperCase();
  if(rawCode) {
    const existing=await db.prepare(
      'SELECT id FROM parts WHERE UPPER(part_number)=? OR UPPER(sap_number)=? '+
      'UNION SELECT part_id AS id FROM pl_part_verifications WHERE raw_code=? LIMIT 1'
    ).bind(rawCode,rawCode,rawCode).first();
    if(existing)return fail('Część o tym kodzie już istnieje. Wyszukaj ją w katalogu.',409);
  }
  const id='GPBS-P-'+crypto.randomUUID();
  try {
    await db.batch([
      db.prepare('INSERT INTO parts (id,part_number,name,active) VALUES (?,?,?,1)')
        .bind(id,number,name),
      db.prepare(
        'INSERT INTO pl_part_verifications '+
        '(part_id,warehouse_id,raw_code,created_by,status) VALUES (?,?,?,?,\'PENDING\')'
      ).bind(id,warehouseId,rawCode||null,actorId)
    ]);
    return workerJson({ok:true,part:{id,name,number,sap:null,needsVerification:true},
      message:'Część dodana do katalogu. Wymaga weryfikacji w panelu.'});
  }catch(error) {
    if(String(error?.message||'').toLowerCase().includes('constraint'))
      return fail('Istnieje już część o tym numerze. Wyszukaj ją.',409);
    throw error;
  }
}

async function removeLine(db,warehouseId,actorId,partId) {
  const draft=await draftFor(db,warehouseId,actorId);
  if(!draft)return fail('Brak otwartego arkusza.',404);
  const results=await db.batch([
    db.prepare(
      "DELETE FROM pl_warehouse_inventory_lines WHERE inventory_id=? AND part_id=? "+
      "AND EXISTS(SELECT 1 FROM pl_warehouse_inventories WHERE id=? AND status='DRAFT')"
    ).bind(draft.id,partId,draft.id),
    db.prepare(
      "UPDATE pl_warehouse_inventories SET revision=revision+1,updated_at=CURRENT_TIMESTAMP "+
      "WHERE id=? AND status='DRAFT'"
    ).bind(draft.id)
  ]);
  if(Number(results[1]?.meta?.changes||0)!==1)
    return fail('Arkusz został już zatwierdzony. Odśwież dane.',409);
  return workerJson({ok:true,draft:await readDraft(db,warehouseId,actorId)});
}

async function commitDraft(db,warehouseId,actorId,body,env) {
  if(env.PL_INVENTORY_PUBLISH_ENABLED==='false')
    return fail('Zatwierdzanie inwentaryzacji zostało tymczasowo wyłączone.',403);
  if(body.confirm!==true)
    return fail('Wymagane potwierdzenie zatwierdzenia inwentaryzacji.',400);
  const inventoryId=body.inventoryId;
  const revision=body.revision;
  if(typeof inventoryId!=='string'||!/^PL-INV-[a-f0-9-]{36}$/.test(inventoryId)||
     !Number.isSafeInteger(revision)||revision<0)
    return fail('Nieprawidłowy identyfikator lub wersja arkusza.',400);

  const record=await db.prepare(
    'SELECT id,status,revision FROM pl_warehouse_inventories '+
    'WHERE id=? AND warehouse_id=? AND actor_id=?'
  ).bind(inventoryId,warehouseId,actorId).first();
  if(!record)return fail('Nie znaleziono arkusza.',404);
  if(record.status==='COMMITTED')
    return workerJson({ok:true,alreadyCommitted:true,inventoryId});
  if(record.status!=='DRAFT'||record.revision!==revision)
    return fail('Arkusz został zmieniony. Odśwież dane i zatwierdź ponownie.',409);

  // One bulk transaction for the WHOLE draft, regardless of whether it has
  // 30, 300 or 3000 positions. No per-line statements / partial commits.
  // The first statement atomically checks account/grants, draft revision,
  // part activity, and every frozen stock baseline before changing status.
  // Its CHECK(commit_guard=1) aborts/rolls back the batch on ANY mismatch.
  const guard=db.prepare(
    "UPDATE pl_warehouse_inventories SET "+
    "status='COMMITTED',committed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP, "+
    "commit_guard=CASE WHEN status='DRAFT' AND revision=? "+
    "AND warehouse_id=? AND actor_id=? "+
    "AND EXISTS(SELECT 1 FROM users u LEFT JOIN user_archives ar ON ar.user_id=u.id "+
    "WHERE u.id=? AND u.active=1 AND ar.user_id IS NULL "+
    "AND u.role_code IN ('ADMIN','KIEROWNIK','MAGAZYNIER')) "+
    "AND EXISTS(SELECT 1 FROM user_warehouse_access a "+
    "JOIN warehouses w ON w.id=a.warehouse_id "+
    "WHERE a.user_id=? AND a.warehouse_id=? AND w.country_code='PL' AND w.active=1) "+
    "AND EXISTS(SELECT 1 FROM pl_warehouse_inventory_lines WHERE inventory_id=?) "+
    "AND (SELECT COUNT(*) FROM pl_warehouse_inventory_lines WHERE inventory_id=?)<=? "+
    "AND NOT EXISTS(SELECT 1 FROM pl_warehouse_inventory_lines l "+
    "LEFT JOIN parts p ON p.id=l.part_id "+
    "LEFT JOIN warehouse_stock s ON s.part_id=l.part_id AND s.warehouse_id=? "+
    "WHERE l.inventory_id=? AND "+
    "(p.id IS NULL OR p.active<>1 OR "+
    "l.counted_quantity<0 OR l.counted_quantity>? OR "+
    "s.quantity IS NOT l.base_quantity)) "+
    "THEN 1 ELSE 0 END WHERE id=?"
  ).bind(
    revision,warehouseId,actorId,
    actorId,actorId,warehouseId,
    inventoryId,inventoryId,MAX_LINES,
    warehouseId,inventoryId,MAX_QUANTITY,inventoryId
  );

  // Snapshot recorded before the update; all lines get an audit row.
  // 'IS' deliberately treats NULL (unestablished) differently from 0.
  const audit=db.prepare(
    'INSERT INTO pl_warehouse_inventory_changes '+
    '(id,inventory_id,warehouse_id,part_id,actor_id,quantity_before,quantity_after,assertion) '+
    "SELECT 'PL-ADJ-'||lower(hex(randomblob(16))),?,?,l.part_id,?,s.quantity,l.counted_quantity, "+
    'CASE WHEN s.quantity IS l.base_quantity THEN 1 ELSE 0 END '+
    'FROM pl_warehouse_inventory_lines l '+
    'LEFT JOIN warehouse_stock s ON s.warehouse_id=? AND s.part_id=l.part_id '+
    'WHERE l.inventory_id=?'
  ).bind(inventoryId,warehouseId,actorId,warehouseId,inventoryId);

  // Only explicitly counted parts are written. Every uncounted part retains
  // its prior quantity or remains unknown. SQLite needs the WHERE 1 disambiguator
  // to parse ON CONFLICT after INSERT ... SELECT.
  const stock=db.prepare(
    'INSERT INTO warehouse_stock (warehouse_id,part_id,quantity,updated_at) '+
    'SELECT ?,l.part_id,l.counted_quantity,CURRENT_TIMESTAMP '+
    'FROM pl_warehouse_inventory_lines l WHERE l.inventory_id=? AND 1 '+
    'ON CONFLICT(warehouse_id,part_id) DO UPDATE SET '+
    'quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP'
  ).bind(warehouseId,inventoryId);

  try {
    await db.batch([guard,audit,stock]);
    const count=await db.prepare(
      'SELECT COUNT(*) AS n FROM pl_warehouse_inventory_lines WHERE inventory_id=?'
    ).bind(inventoryId).first();
    return workerJson({
      ok:true,inventoryId,alreadyCommitted:false,committedLines:Number(count?.n||0)
    });
  }catch(error) {
    const existing=await db.prepare(
      'SELECT status FROM pl_warehouse_inventories WHERE id=? AND actor_id=?'
    ).bind(inventoryId,actorId).first().catch(()=>null);
    if(existing?.status==='COMMITTED')
      return workerJson({ok:true,inventoryId,alreadyCommitted:true});
    const message=String(error?.message||'').toLowerCase();
    if(message.includes('constraint'))
      return fail('Inwentaryzacja, uprawnienia lub stan części zmieniły się. '+
        'Nie zapisano żadnych ilości. Odśwież dane i przelicz sporne części.',409);
    throw error;
  }
}

export async function onRequestPost({request,env}) {
  if(!workerAuthReady(env))
    return fail('Brak konfiguracji logowania.',503);
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)
    return fail('Niedozwolone pochodzenie żądania.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);

  let body;
  try {
    const raw=await request.text();
    if(raw.length>5000)return fail('Zbyt duże żądanie.',413);
    body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))
      return fail('Nieprawidłowe żądanie.',400);
  }catch{return fail('Nieprawidłowy JSON.',400);}
  const warehouseId=String(body.warehouseId||'');
  try {
    const auth=await allowed(request,env,warehouseId);
    if(auth.error)return auth.error;
    if(!await checkTables(env.DB))
      return fail('Najpierw wykonaj migrację D1: '+MIGRATION,503);
    if(!await getWarehouse(env.DB,warehouseId))
      return fail('Magazyn nieaktywny.',404);

    if(['add','set','newPart'].includes(body.action)) {
      const ready=await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN "+
        "('pl_warehouse_inventory_events','pl_part_verifications')"
      ).first();
      if(Number(ready?.n)!==2)
        return fail('Najpierw wykonaj migrację D1: db/09-pl-inventory-scanning.sql',503);
      if(body.action==='newPart')
        return await createUnverifiedPart(env.DB,warehouseId,auth.user.id,body);
      return await countEvent(env.DB,warehouseId,auth.user.id,body);
    }
    if(body.action==='save'||body.action==='remove') {
      const partId=String(body.partId||'');
      if(!ID_PATTERN.test(partId))return fail('Nieprawidłowa część.',400);
      if(body.action==='remove')
        return await removeLine(env.DB,warehouseId,auth.user.id,partId);
      if(!Number.isSafeInteger(body.quantity)||body.quantity<0||
         body.quantity>MAX_QUANTITY)
        return fail('Ilość musi być liczbą całkowitą od 0 do '+MAX_QUANTITY+'.',400);
      return await saveLine(env.DB,warehouseId,auth.user.id,partId,body.quantity);
    }
    if(body.action==='commit')
      return await commitDraft(env.DB,warehouseId,auth.user.id,body,env);
    return fail('Nieznana operacja.',400);
  }catch(error) {
    console.error('GPBS PL inventory action failed',error?.name||'Error');
    return fail('Nie udało się wykonać operacji inwentaryzacji.',503);
  }
}
