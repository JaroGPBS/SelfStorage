// Admin warehouse management: market/type metadata, activation and reversible archive.
// No warehouse stock, serial number, movement or QR data is deleted on archive.
import {BOX_CATALOG_SNAPSHOT} from './box-catalog-20261111.js';

const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
async function ensureState(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS warehouse_admin_state ('+
    'warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),'+
    "kind TEXT NOT NULL CHECK(kind IN ('GPBS','BOX','BOVIS')),"+
    'archived_at TEXT, archived_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}
const kindFor=row=>{
  if(row?.kind)return row.kind;
  const id=String(row?.id||''),name=String(row?.name||'');
  return id==='FR-TOULOUSE'||id==='FR-PARIS'||id.startsWith('FR-BOX-')
    ?'BOX':id.startsWith('FR-BOVIS-')||/^bovis\s/i.test(name)?'BOVIS':'GPBS';
};
const slugOf=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[łŁ]/g,'L').toUpperCase().replace(/[^A-Z0-9]+/g,'-')
  .replace(/^-|-$/g,'').slice(0,35);
const audit=(db,actor,action,id,details)=>db.prepare(
  'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
).bind(crypto.randomUUID(),actor,action,'WAREHOUSE',id,JSON.stringify(details));
function freshCode(){
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  return 'BOX-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
}
export async function listAdminWarehouses(db,archived=false){
  await ensureState(db);
  const qrExists=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_warehouse_qr'"
  ).first();
  const qrJoin=qrExists?'LEFT JOIN fr_warehouse_qr q ON q.warehouse_id=w.id ':'';
  const qrExpr=qrExists?'q.code':'NULL';
  const rows=(await db.prepare(
    'SELECT w.id,w.name,w.country_code,w.active,a.kind,a.archived_at,'+
    'COALESCE('+qrExpr+",CASE w.id WHEN 'FR-TOULOUSE' THEN 'MAG-TL7A2Q' "+
    "WHEN 'FR-PARIS' THEN 'MAG-PA5A4B' ELSE NULL END) AS qr_code "+
    'FROM warehouses w LEFT JOIN warehouse_admin_state a ON a.warehouse_id=w.id '+
    qrJoin+
    "WHERE w.country_code IN ('PL','FR') AND "+
    (archived?'a.archived_at IS NOT NULL ':'a.archived_at IS NULL ')+
    "ORDER BY CASE WHEN w.country_code='PL' THEN 0 ELSE 1 END,w.name COLLATE NOCASE"
  ).all()).results||[];
  const result=rows.map(w=>({
    ...w,kind:kindFor(w),name:w.id==='FR-TOULOUSE'?'Box Toulouse':
      w.id==='FR-PARIS'?'Box Paryż':w.name
  }));
  if(!archived&&!result.some(w=>w.country_code==='FR'&&/belleville/i.test(w.id+' '+w.name))){
    result.push({id:'FR-BELLEVILLE',name:'Belleville',country_code:'FR',
      active:0,qr_code:null,kind:'GPBS',not_configured:true});
  }
  return result;
}
export async function createManagedWarehouse(env,body,actor,ownerId){
  const market=String(body?.market||'').toUpperCase();
  const kind=String(body?.kind||'').toUpperCase();
  let name=String(body?.name||'').trim().replace(/\s+/g,' ');
  if(!['PL','FR'].includes(market)||!['GPBS','BOX','BOVIS'].includes(kind)||
     (market==='PL'&&kind!=='GPBS'))
    throw invalid('Wybierz prawidłowy rynek i typ magazynu.');
  if(name.length<3||name.length>70)throw invalid('Nazwa magazynu musi mieć 3–70 znaków.');
  if(kind==='BOX'&&!/^box\s/i.test(name))name='Box '+name;
  if(kind==='BOVIS'&&!/^bovis\s/i.test(name))name='Bovis '+name;
  const location=kind==='BOX'?name.replace(/^box\s+/i,''):
    kind==='BOVIS'?name.replace(/^bovis\s+/i,''):name;
  const slug=slugOf(location);
  const prefix=market==='PL'?'PL-':kind==='BOX'?'FR-BOX-':kind==='BOVIS'?'FR-BOVIS-':'FR-';
  const id=prefix+slug;
  if(!slug||id.length>50)throw invalid('Nazwa magazynu jest za długa lub nieprawidłowa.');
  const db=env.DB;
  await ensureState(db);
  const duplicate=await db.prepare(
    "SELECT id FROM warehouses WHERE id=? OR (name=? COLLATE NOCASE AND country_code=?) LIMIT 1"
  ).bind(id,name,market).first();
  if(duplicate)throw invalid('Magazyn o tej nazwie lub identyfikatorze już istnieje.',409);
  if(kind==='BOX')await db.prepare(
    'CREATE TABLE IF NOT EXISTS fr_warehouse_qr ('+
      'warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),code TEXT NOT NULL UNIQUE)'
  ).run();
  const code=kind==='BOX'?freshCode():null;
  const statements=[
    db.prepare('INSERT INTO warehouses(id,name,country_code,active) VALUES(?,?,?,1)').bind(id,name,market),
    db.prepare('INSERT INTO warehouse_admin_state(warehouse_id,kind) VALUES(?,?)').bind(id,kind)
  ];
  if(code){
    statements.push(db.prepare(
      'INSERT INTO fr_warehouse_qr(warehouse_id,code) VALUES(?,?)'
    ).bind(id,code));
    // Copy permitted BOX positions only, each with zero initial quantity.
    const ids=BOX_CATALOG_SNAPSHOT.map(p=>p.part_id);
    statements.push(db.prepare(
      'INSERT OR IGNORE INTO warehouse_stock(warehouse_id,part_id,quantity,updated_at) '+
      "SELECT ?,p.id,0,CURRENT_TIMESTAMP FROM parts p JOIN json_each(?) j "+
      "ON p.id=json_extract(j.value,'$') WHERE p.active=1"
    ).bind(id,JSON.stringify(ids)));
  }
  if(ownerId)statements.push(db.prepare(
    'INSERT OR IGNORE INTO user_warehouse_access(user_id,warehouse_id) VALUES(?,?)'
  ).bind(ownerId,id));
  statements.push(audit(db,actor,'WAREHOUSE_CREATE',id,{
    name,market,kind,template:market==='PL'?'Tychy':
      kind==='GPBS'?'Belleville':kind==='BOX'?'Box Toulouse':'Bovis Paryż'
  }));
  await db.batch(statements);
  return {id,name,country_code:market,kind,active:1,code};
}
export async function updateManagedWarehouse(env,body,actor,action){
  const db=env.DB,id=String(body?.warehouseId||'');
  if(!/^[A-Z0-9-]{3,50}$/.test(id))throw invalid('Nieprawidłowy identyfikator magazynu.');
  await ensureState(db);
  const row=await db.prepare(
    'SELECT w.id,w.name,w.country_code,w.active,a.kind,a.archived_at '+
    'FROM warehouses w LEFT JOIN warehouse_admin_state a ON a.warehouse_id=w.id WHERE w.id=?'
  ).bind(id).first();
  if(!row||!['FR','PL'].includes(row.country_code))
    throw invalid('Nie znaleziono magazynu.',404);
  if(action==='warehouseStatus'){
    if(row.archived_at)throw invalid('Najpierw przywróć magazyn z archiwum.',409);
    if(body.active!==true&&body.active!==false)throw invalid('Wybierz status magazynu.');
    await db.batch([
      db.prepare('UPDATE warehouses SET active=? WHERE id=?').bind(Number(body.active),id),
      audit(db,actor,'WAREHOUSE_STATUS',id,{active:body.active})
    ]);
    return {active:Number(body.active)};
  }
  if(action==='warehouseArchive'){
    if(row.archived_at)throw invalid('Magazyn jest już zarchiwizowany.',409);
    await db.batch([
      db.prepare('UPDATE warehouses SET active=0 WHERE id=?').bind(id),
      db.prepare('INSERT INTO warehouse_admin_state(warehouse_id,kind,archived_at,archived_by) '+
        'VALUES(?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(warehouse_id) DO UPDATE SET '+
        'archived_at=CURRENT_TIMESTAMP,archived_by=excluded.archived_by')
        .bind(id,kindFor(row),actor),
      audit(db,actor,'WAREHOUSE_ARCHIVE',id,{previousActive:Number(row.active)})
    ]);
    return {archived:true,active:0};
  }
  if(action==='warehouseRestore'){
    if(!row.archived_at)throw invalid('Ten magazyn nie jest w archiwum.',409);
    await db.batch([
      db.prepare('UPDATE warehouses SET active=0 WHERE id=?').bind(id),
      db.prepare('UPDATE warehouse_admin_state SET archived_at=NULL,archived_by=NULL WHERE warehouse_id=?').bind(id),
      audit(db,actor,'WAREHOUSE_RESTORE',id,{active:false})
    ]);
    return {archived:false,active:0};
  }
  throw invalid('Nieznana operacja magazynowa.');
}


// Hard delete is allowed only for a warehouse with NO operational history.
// Empty BOX catalogue positions (quantity 0), its own QR, owner grant and
// administrative metadata are setup records, not warehouse activity.
const PROTECTED_WAREHOUSE_IDS=new Set([
  'PL-TYCHY','FR-TOULOUSE','FR-PARIS','FR-BELLEVILLE'
]);
const DELETE_CONTROL_TABLES=new Set([
  'warehouses','warehouse_stock','warehouse_admin_state',
  'fr_warehouse_qr','user_warehouse_access','panel_audit_log'
]);
const quoteSqlId=value=>'"'+String(value).replace(/"/g,'""')+'"';

async function inspectWarehouseDeletion(db,id,ownerId){
  if(PROTECTED_WAREHOUSE_IDS.has(id))
    throw invalid('Ten magazyn jest podstawową lokalizacją systemu i nie można go usunąć. Możesz zmienić jego status lub przenieść go do archiwum.',409);
  const stock=await db.prepare(
    'SELECT 1 FROM warehouse_stock WHERE warehouse_id=? '+
    'AND (quantity IS NULL OR quantity<>0) LIMIT 1'
  ).bind(id).first();
  if(stock)throw invalid('Magazyn ma zapisane stany części. Możesz go zarchiwizować, ale nie usunąć.',409);

  // Preserve any non-owner warehouse grants until they are deliberately revoked.
  const otherUser=await db.prepare(
    'SELECT 1 FROM user_warehouse_access WHERE warehouse_id=? AND user_id<>? LIMIT 1'
  ).bind(id,ownerId||'').first();
  if(otherUser)throw invalid('Magazyn jest przypisany do użytkowników. Najpierw usuń ich przypisania.',409);

  // Check every live table, including tables added by later migrations,
  // instead of relying on one hardcoded list of movements/inventories/modules.
  const tables=(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all()).results||[];
  for(const {name} of tables){
    if(DELETE_CONTROL_TABLES.has(name)||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))continue;
    const pragma=quoteSqlId(name);
    const columns=(await db.prepare('PRAGMA table_info('+pragma+')').all()).results||[];
    const foreign=(await db.prepare('PRAGMA foreign_key_list('+pragma+')').all()).results||[];
    const candidates=new Set([
      ...columns.filter(c=>/warehouse|^(?:from_|to_|source_|target_|origin_|destination_)?location_id$/i.test(c.name)).map(c=>c.name),
      ...foreign.filter(f=>String(f.table).toLowerCase()==='warehouses').map(f=>f.from)
    ]);
    const names=new Set(columns.map(c=>c.name));
    for(const candidate of candidates){
      if(!names.has(candidate))continue;
      const isLocation=/(^|_)location_id$/i.test(candidate);
      const typed=isLocation&&names.has('location_type')
        ?' AND location_type=\'WAREHOUSE\'':'';
      const found=await db.prepare(
        'SELECT 1 FROM '+pragma+' WHERE '+quoteSqlId(candidate)+'=?'+typed+' LIMIT 1'
      ).bind(id).first();
      if(found)throw invalid('Magazyn ma zapisane operacje, inwentaryzacje lub inne powiązane dane. Możesz przenieść go do archiwum.',409);
    }
  }
}

export async function deleteEmptyWarehouse(env,body,actor,ownerId){
  const db=env.DB,id=String(body?.warehouseId||'');
  if(!/^[A-Z0-9-]{3,50}$/.test(id))throw invalid('Nieprawidłowy identyfikator magazynu.');
  await ensureState(db);
  const warehouse=await db.prepare(
    "SELECT id,name,country_code FROM warehouses WHERE id=? AND country_code IN ('PL','FR')"
  ).bind(id).first();
  if(!warehouse)throw invalid('Nie znaleziono magazynu.',404);
  await inspectWarehouseDeletion(db,id,ownerId);

  // D1 batch is atomic. A late FK dependency aborts all changes.
  const qrExists=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_warehouse_qr'"
  ).first();
  const steps=[
    db.prepare('DELETE FROM warehouse_stock WHERE warehouse_id=? AND quantity=0').bind(id)
  ];
  if(qrExists)steps.push(db.prepare('DELETE FROM fr_warehouse_qr WHERE warehouse_id=?').bind(id));
  steps.push(
    db.prepare('DELETE FROM user_warehouse_access WHERE warehouse_id=? AND user_id=?')
      .bind(id,ownerId||''),
    db.prepare('DELETE FROM warehouse_admin_state WHERE warehouse_id=?').bind(id),
    db.prepare('DELETE FROM warehouses WHERE id=? AND NOT EXISTS ('+
      'SELECT 1 FROM warehouse_stock WHERE warehouse_id=?)').bind(id,id),
    audit(db,actor,'WAREHOUSE_DELETE',id,{
      name:warehouse.name,market:warehouse.country_code,reason:'EMPTY_WAREHOUSE'
    })
  );
  await db.batch(steps);
  const stillThere=await db.prepare('SELECT 1 FROM warehouses WHERE id=?').bind(id).first();
  if(stillThere)throw invalid('Magazyn nie został usunięty. Sprawdź, czy nie dodano nowych danych.',409);
  return {deleted:true,warehouseId:id,name:warehouse.name};
}
