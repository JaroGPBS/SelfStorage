// Shared France BOX catalogue used by Admin and Office.
// 78 references originate in "Stock FR GPBS" -> Stock, rows 4..81.
// Current D1 balance wins for each part. The preserved sheet snapshot fills
// display-only gaps. Never write a snapshot figure to production D1 from here.
import {BOX_CATALOG_SNAPSHOT} from './box-catalog-20261111.js';

const BOX_IDS={toulouse:'FR-TOULOUSE',paris:'FR-PARIS'};

export async function readFrBoxSharedCatalog(db){
  const ids=BOX_CATALOG_SNAPSHOT.map(p=>p.part_id);
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
  const parts=BOX_CATALOG_SNAPSHOT.map(item=>{
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
    expectedParts:BOX_CATALOG_SNAPSHOT.length,
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
