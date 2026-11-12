// French self-storage BOX catalogue for Office, sourced from the 78 distinct
// references in "Stock FR GPBS" -> Stock (rows 4..81).
// This module only READS. Warehouse balances always come from live D1,
// never from the historic spreadsheet snapshot or other warehouse balances.
import {BOX_CATALOG_SNAPSHOT} from './box-catalog-20261111.js';

const BOX_IDS=new Set(['FR-TOULOUSE','FR-PARIS']);

export async function readFrBoxOfficeParts(db,warehouseId=null){
  if(warehouseId!==null&&!BOX_IDS.has(warehouseId))
    throw new Error('Nieprawidłowy magazyn BOX.');
  const ids=BOX_CATALOG_SNAPSHOT.map(part=>part.part_id);
  const marks=ids.map(()=>'?').join(',');
  const indexTable=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
  ).first();
  const fields='SELECT p.id,p.name,p.part_number,p.sap_number,p.active'+
    (indexTable?',ix.new_index':'')+
    (warehouseId?',s.quantity':'')+' FROM parts p '+
    (indexTable?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
    (warehouseId?'LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? ':'')+
    'WHERE p.id IN ('+marks+')';
  const binds=warehouseId?[warehouseId,...ids]:ids;
  const rows=(await db.prepare(fields).bind(...binds).all()).results||[];
  const byId=new Map(rows.map(row=>[row.id,row]));
  return BOX_CATALOG_SNAPSHOT.map(item=>{
    const part=byId.get(item.part_id);
    return {
      id:item.part_id,
      name:part?.name||item.name,
      part_number:part?.new_index||part?.part_number||item.source_code,
      sap_number:part?.sap_number||item.sap||'',
      quantity:warehouseId&&part&&part.quantity!==undefined
        ?(part.quantity===null?null:Number(part.quantity))
        :null
    };
  });
}
