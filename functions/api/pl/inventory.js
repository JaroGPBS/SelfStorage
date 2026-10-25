// GPBS Storage PL — warehouse inventory draft and controlled adjustments.
// Isolated from legacy French /api. Publishing is OFF until explicitly
// enabled with PL_INVENTORY_PUBLISH_ENABLED=true in Cloudflare Production.
import { verifyWorkerSession, workerJson, workerAuthReady } from '../../../lib/pl-worker-auth.js';

const ALLOWED_ROLES = new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
const MAX_LINES = 30;
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
    return workerJson({
      ok:true,warehouse,draft,maxLines:MAX_LINES,
      publishingEnabled:env.PL_INVENTORY_PUBLISH_ENABLED==='true'
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
    return fail('Arkusz ma maksymalnie '+MAX_LINES+' pozycji. Zatwierdź obecny przed dodaniem kolejnych.',409);
  return workerJson({ok:true,draft:await readDraft(db,warehouseId,actorId)});
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
  if(env.PL_INVENTORY_PUBLISH_ENABLED!=='true')
    return fail('Zatwierdzanie stanów jest wyłączone do czasu uruchomienia inwentaryzacji.',403);
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

  const data=await db.prepare(
    'SELECT l.part_id,l.counted_quantity,l.base_quantity FROM pl_warehouse_inventory_lines l '+
    'JOIN parts p ON p.id=l.part_id AND p.active=1 WHERE l.inventory_id=? '+
    'ORDER BY l.part_id'
  ).bind(inventoryId).all();
  const lines=data.results||[];
  if(lines.length<1||lines.length>MAX_LINES)
    return fail('Arkusz musi zawierać od 1 do '+MAX_LINES+' aktywnych pozycji.',409);
  const allCount=await db.prepare(
    'SELECT COUNT(*) AS n FROM pl_warehouse_inventory_lines WHERE inventory_id=?'
  ).bind(inventoryId).first();
  if(Number(allCount?.n)!==lines.length)
    return fail('Arkusz zawiera część usuniętą z katalogu. Usuń ją przed zatwierdzeniem.',409);

  // Every draft mutation increments revision inside an atomic D1 batch.
  // The first statement fails its CHECK if another tab edited the draft.
  // Each adjustment independently fails its CHECK if stock changed since
  // the count was added. All statements roll back together on failure.
  const stmts=[
    db.prepare(
      "UPDATE pl_warehouse_inventories SET status='COMMITTED',committed_at=CURRENT_TIMESTAMP, "+
      "updated_at=CURRENT_TIMESTAMP,commit_guard=CASE WHEN status='DRAFT' AND revision=? "+
      "THEN 1 ELSE 0 END WHERE id=?"
    ).bind(revision,inventoryId)
  ];
  for(const line of lines) {
    const base=line.base_quantity===null?null:Number(line.base_quantity);
    const counted=Number(line.counted_quantity);
    if(!Number.isSafeInteger(counted)||counted<0||counted>MAX_QUANTITY)
      return fail('Nieprawidłowa policzona ilość w arkuszu.',409);

    stmts.push(db.prepare(
      'INSERT INTO pl_warehouse_inventory_changes '+
      '(id,inventory_id,warehouse_id,part_id,actor_id,quantity_before,quantity_after,assertion) '+
      'VALUES (?,?,?,?,?,?,?,CASE WHEN '+
      '(? IS NULL AND NOT EXISTS(SELECT 1 FROM warehouse_stock WHERE warehouse_id=? AND part_id=?)) '+
      'OR (? IS NOT NULL AND EXISTS(SELECT 1 FROM warehouse_stock WHERE warehouse_id=? AND part_id=? AND quantity=?)) '+
      'THEN 1 ELSE 0 END)'
    ).bind(
      'PL-ADJ-'+crypto.randomUUID(),inventoryId,warehouseId,line.part_id,
      actorId,base,counted,base,warehouseId,line.part_id,
      base,warehouseId,line.part_id,base
    ));
    stmts.push(db.prepare(
      'INSERT INTO warehouse_stock (warehouse_id,part_id,quantity,updated_at) '+
      'VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(warehouse_id,part_id) '+
      'DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP'
    ).bind(warehouseId,line.part_id,counted));
  }

  try {
    await db.batch(stmts);
    return workerJson({
      ok:true,inventoryId,alreadyCommitted:false,committedLines:lines.length
    });
  }catch(error) {
    const existing=await db.prepare(
      'SELECT status FROM pl_warehouse_inventories WHERE id=? AND actor_id=?'
    ).bind(inventoryId,actorId).first().catch(()=>null);
    if(existing?.status==='COMMITTED')
      return workerJson({ok:true,inventoryId,alreadyCommitted:true});
    const message=String(error?.message||'').toLowerCase();
    if(message.includes('constraint'))
      return fail('Stan części albo arkusz zmienił się w międzyczasie. '+
        'Nie zapisano żadnych ilości. Odśwież arkusz i sprawdź dane.',409);
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
