// Shared France BOX catalogue used by Admin and Office.
// 78 references originate in "Stock FR GPBS" -> Stock, rows 4..81.
// Current D1 balance wins for each part. The preserved sheet snapshot fills
// display-only gaps. Never write a snapshot figure to production D1 from here.
import {BOX_CATALOG_SNAPSHOT} from './box-catalog-20261111.js';

const BOX_IDS={toulouse:'FR-TOULOUSE',paris:'FR-PARIS'};

// A removed BOX item is deactivated only in the BOX catalogue. Do not delete
// it from parts, warehouse_stock, past sessions, photographs or other markets.
export async function excludedBoxPartIds(db){
  const exists=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_box_catalog_exclusions'"
  ).first();
  if(!exists)return new Set();
  const rows=(await db.prepare('SELECT part_id FROM fr_box_catalog_exclusions').all()).results||[];
  return new Set(rows.map(row=>row.part_id));
}

export async function removeBoxCataloguePart(db,partId,actorId){
  const item=BOX_CATALOG_SNAPSHOT.find(p=>p.part_id===partId);
  if(!item)throw Object.assign(new Error('Ta część nie należy do katalogu BOX.'),{status:404});
  const excluded=await excludedBoxPartIds(db);
  if(excluded.has(partId))
    return {removed:true,alreadyRemoved:true,partId};

  // Hiding an item that is still physically stocked would conceal a real
  // balance and prevent crews from accounting for it in WZ/PZ. Require zero.
  const stock=await db.prepare(
    "SELECT w.name,s.quantity FROM warehouse_stock s JOIN warehouses w ON w.id=s.warehouse_id "+
    "WHERE s.part_id=? AND w.country_code='FR' "+
    "AND (w.id IN ('FR-TOULOUSE','FR-PARIS') OR w.id LIKE 'FR-BOX-%') "+
    'AND (s.quantity IS NULL OR s.quantity<>0) LIMIT 1'
  ).bind(partId).first();
  if(stock)throw Object.assign(new Error(
    'Nie można wycofać części: magazyn '+stock.name+' ma stan '+
    (stock.quantity==null?'nieustalony':stock.quantity)+' szt. Najpierw rozlicz stan do zera.'
  ),{status:409});

  // If a fixed BOX has no D1 balance for a snapshot item, a nonzero
  // preserved source amount is still a reason not to hide stock silently.
  const present=(await db.prepare(
    "SELECT warehouse_id FROM warehouse_stock WHERE part_id=? "+
    "AND warehouse_id IN ('FR-TOULOUSE','FR-PARIS')"
  ).bind(partId).all()).results||[];
  const has=new Set(present.map(row=>row.warehouse_id));
  for(const [place,id] of Object.entries(BOX_IDS)){
    if(!has.has(id)&&Number(item[place])!==0)
      throw Object.assign(new Error(
        'Brak potwierdzonego stanu D1 dla '+(place==='toulouse'?'Box Toulouse':'Box Paryż')+
        '. Nie można bezpiecznie wycofać części przed sprawdzeniem stanu.'
      ),{status:409});
  }

  await db.prepare(
    'CREATE TABLE IF NOT EXISTS fr_box_catalog_exclusions ('+
    'part_id TEXT PRIMARY KEY REFERENCES parts(id),'+
    'excluded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'excluded_by TEXT)'
  ).run();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO fr_box_catalog_exclusions(part_id,excluded_by) VALUES(?,?)')
      .bind(partId,actorId),
    db.prepare(
      'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
      'VALUES(?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(),actorId,'BOX_CATALOG_PART_EXCLUDED','PART',partId,
      JSON.stringify({scope:'FR_BOX_ONLY',name:item.name}))
  ]);
  return {removed:true,partId};
}

export async function readFrBoxSharedCatalog(db){
  const excluded=await excludedBoxPartIds(db);
  const enabledItems=BOX_CATALOG_SNAPSHOT.filter(p=>!excluded.has(p.part_id));
  const ids=enabledItems.map(p=>p.part_id);
  if(!ids.length)return {parts:[],fromD1:{toulouse:true,paris:true},
    d1Positions:{toulouse:0,paris:0},matchedParts:0,expectedParts:0,snapshotDate:'11.11.2026'};
  const placeholders=ids.map(()=>'?').join(',');
  const indexMap=Boolean(await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
  ).first());
  const query='SELECT p.id,p.name,p.part_number,p.sap_number'+
    (indexMap?',ix.new_index':'')+' FROM parts p '+
    (indexMap?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
    'WHERE p.id IN ('+placeholders+') AND p.active=1';
  const details=(await db.prepare(query).bind(...ids).all()).results||[];
  const byId=new Map(details.map(part=>[part.id,part]));
  const stocks=(await db.prepare(
    "SELECT warehouse_id,part_id,quantity FROM warehouse_stock "+
    "WHERE warehouse_id IN ('FR-TOULOUSE','FR-PARIS') AND part_id IN ("+
    placeholders+")"
  ).bind(...ids).all()).results||[];
  const balances=new Map(stocks.map(row=>[
    row.warehouse_id+'|'+row.part_id,Number(row.quantity)
  ]));
  const sourceCounts={toulouse:0,paris:0};
  const parts=enabledItems.map(item=>{
    const stored=byId.get(item.part_id);
    const output={
      id:item.part_id,
      name:stored?.name||item.name,
      part_number:stored?.new_index||stored?.part_number||item.source_code,
      source_code:item.source_code,
      legacy_index:item.legacy_index,
      sap_number:stored?.sap_number||item.sap||'',
      part_found:Boolean(stored)
    };
    for(const [key,id] of Object.entries(BOX_IDS)){
      const mapKey=id+'|'+item.part_id;
      const available=balances.has(mapKey);
      if(available)sourceCounts[key]++;
      output[key]=available?balances.get(mapKey):Number(item[key]||0);
      output[key+'_source']=available?'D1':'arkusz';
    }
    return output;
  });
  return {
    parts,
    fromD1:Object.fromEntries(Object.keys(BOX_IDS).map(k=>[k,sourceCounts[k]===ids.length])),
    d1Positions:sourceCounts,
    matchedParts:byId.size,
    expectedParts:enabledItems.length,
    snapshotDate:'11.11.2026'
  };
}

export async function readFrBoxOfficeParts(db,warehouseId=null){
  const place=Object.keys(BOX_IDS).find(k=>BOX_IDS[k]===warehouseId);
  if(warehouseId!==null&&!place)throw Error('Nieprawidłowy magazyn BOX.');
  const catalogue=await readFrBoxSharedCatalog(db);
  return {
    parts:catalogue.parts.map(item=>({
      id:item.id,name:item.name,part_number:item.part_number,
      sap_number:item.sap_number,
      quantity:place?item[place]:null,
      stock_source:place?item[place+'_source']:null
    })),
    fromD1:place?catalogue.fromD1[place]:false,
    d1Positions:place?catalogue.d1Positions[place]:0,
    expectedParts:catalogue.expectedParts,
    snapshotDate:catalogue.snapshotDate
  };
}
