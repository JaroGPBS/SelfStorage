// Idempotent repair of the two established French BOX warehouses.
// Never changes existing warehouse_stock quantities or QR values.
import {BOX_CATALOG_SNAPSHOT} from './box-catalog-20261111.js';
import {excludedBoxPartIds} from './fr-box-office-stock.js';

const BOXES=[
  {id:'FR-TOULOUSE',name:'Box Toulouse',source:'toulouse',qr:'MAG-TL7A2Q'},
  {id:'FR-PARIS',name:'Box Paryż',source:'paris',qr:'MAG-PA5A4B'}
];

export async function ensureFrenchBoxSetup(db){
  const excluded=await excludedBoxPartIds(db);
  const allowed=BOX_CATALOG_SNAPSHOT.filter(p=>!excluded.has(p.part_id));
  const rows=(await db.prepare(
    "SELECT w.id,w.active,COUNT(s.part_id) AS positions "+
    "FROM warehouses w LEFT JOIN warehouse_stock s ON s.warehouse_id=w.id "+
    "WHERE w.id IN ('FR-TOULOUSE','FR-PARIS') AND w.country_code='FR' "+
    "GROUP BY w.id,w.active"
  ).all()).results||[];
  const qrExists=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_warehouse_qr'"
  ).first();
  const qrRows=qrExists?(await db.prepare(
    "SELECT warehouse_id,code FROM fr_warehouse_qr WHERE warehouse_id IN ('FR-TOULOUSE','FR-PARIS')"
  ).all()).results||[]:[];
  const allReady=BOXES.every(box=>rows.some(r=>
    r.id===box.id&&Number(r.positions)>=allowed.length
  ));
  const allQr=BOXES.every(box=>qrRows.some(r=>r.warehouse_id===box.id));
  if(allReady&&allQr)return;

  // Create this table before preparing INSERT statements that reference it.
  if(!qrExists)await db.prepare(
    'CREATE TABLE IF NOT EXISTS fr_warehouse_qr ('+
    'warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),'+
    'code TEXT NOT NULL UNIQUE)'
  ).run();
  const commands=[];
  for(const box of BOXES){
    commands.push(
      db.prepare(
        "INSERT OR IGNORE INTO warehouses(id,name,country_code,active) VALUES(?,?,'FR',1)"
      ).bind(box.id,box.name),
      db.prepare(
        'INSERT OR IGNORE INTO fr_warehouse_qr(warehouse_id,code) VALUES(?,?)'
      ).bind(box.id,box.qr)
    );
    // The Google-sheet snapshot is used only to fill MISSING D1 rows.
    // Existing, possibly updated real stock values always win.
    const source=allowed.map(p=>({
      id:p.part_id,qty:Number(p[box.source])
    }));
    // Inactive or archived boxes must never be modified/reactivated by setup.
    const existing=rows.find(row=>row.id===box.id);
    if(!existing||Number(existing.active)===1)commands.push(db.prepare(
      "INSERT OR IGNORE INTO warehouse_stock(warehouse_id,part_id,quantity,updated_at) "+
      "SELECT ?,json_extract(j.value,'$.id'),"+
      "CAST(json_extract(j.value,'$.qty') AS INTEGER),CURRENT_TIMESTAMP "+
      "FROM json_each(?) j JOIN parts p ON p.id=json_extract(j.value,'$.id') "+
      "WHERE 1=1"
    ).bind(box.id,JSON.stringify(source)));
  }
  await db.batch(commands);
  const after=(await db.prepare(
    "SELECT id,active FROM warehouses WHERE id IN ('FR-TOULOUSE','FR-PARIS') "+
    "AND country_code='FR'"
  ).all()).results||[];
  if(!BOXES.every(b=>after.some(r=>r.id===b.id)))
    throw Error('Nie udało się znaleźć istniejących Boxów w D1.');
}
