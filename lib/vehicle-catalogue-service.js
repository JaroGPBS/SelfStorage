// Canonical car-equipment category: source references + optional D1 membership
// overrides. Names, SAP and MG codes always come from the shared parts table.
// This function never creates vehicle stocks, audits or transfers.
import {VEHICLE_CATALOG_SNAPSHOT} from './vehicle-catalog-20261111.js';
import {ensurePartIndexes} from './pl-part-indexes.js';

const normalizeName=value=>String(value||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pl')
  .replace(/ł/g,'l').replace(/[^a-z0-9]/g,'');

export async function getVehicleCatalogue(db){
  await ensurePartIndexes(db);
  const tables=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN "+
    "('pl_part_photos','pl_part_photo_objects',"+
    "'vehicle_catalog_requirements','vehicle_catalog_links')"
  ).all();
  const tableNames=new Set((tables.results||[]).map(row=>row.name));
  const photoChecks=[
    tableNames.has('pl_part_photo_objects')
      ?'EXISTS(SELECT 1 FROM pl_part_photo_objects a WHERE a.part_id=p.id)':null,
    tableNames.has('pl_part_photos')
      ?'EXISTS(SELECT 1 FROM pl_part_photos a WHERE a.part_id=p.id)':null
  ].filter(Boolean);
  const all=(await db.prepare(
    'SELECT p.id,p.name,p.part_number,p.sap_number,ix.old_index,ix.new_index,'+
    (photoChecks.length?'('+photoChecks.join(' OR ')+')':'0')+' AS has_photo '+
    'FROM parts p LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id '+
    'WHERE p.active=1 ORDER BY p.id LIMIT 3000'
  ).all()).results||[];
  const byId=new Map(all.map(part=>[part.id,part]));
  const byLegacy=new Map(),byName=new Map();
  for(const part of all){
    for(const value of [part.old_index,part.part_number,part.new_index]){
      const index=String(value||'').trim().toUpperCase();
      if(!index)continue;
      const list=byLegacy.get(index)||[];
      if(!list.some(item=>item.id===part.id))list.push(part);
      byLegacy.set(index,list);
    }
    const label=normalizeName(part.name);
    if(label){
      const list=byName.get(label)||[];
      list.push(part);
      byName.set(label,list);
    }
  }
  const links=new Map();
  if(tableNames.has('vehicle_catalog_links')){
    const linked=await db.prepare(
      'SELECT source_row,part_id,excluded FROM vehicle_catalog_links'
    ).all();
    for(const row of linked.results||[])links.set(Number(row.source_row),row);
  }
  const requirements=new Map();
  if(tableNames.has('vehicle_catalog_requirements')){
    const saved=await db.prepare(
      'SELECT source_row,required_quantity FROM vehicle_catalog_requirements'
    ).all();
    for(const row of saved.results||[])
      requirements.set(Number(row.source_row),row.required_quantity);
  }
  const originals=VEHICLE_CATALOG_SNAPSHOT.map(item=>({...item}));
  for(const row of links.values()){
    if(Number(row.source_row)<10000)continue;
    originals.push({source_row:Number(row.source_row),part_id:row.part_id,
      source_name:'',old_index:'',source_sap:'',required_quantity:null});
  }
  const parts=originals.filter(item=>!Number(links.get(item.source_row)?.excluded||0))
    .map(item=>{
      const link=links.get(item.source_row);
      const assigned=link?.part_id||item.part_id;
      let part=assigned?byId.get(assigned):null;
      if(!part&&item.old_index){
        const matches=byLegacy.get(item.old_index.toUpperCase())||[];
        if(matches.length===1)part=matches[0];
      }
      if(!part&&item.source_name){
        const matches=byName.get(normalizeName(item.source_name))||[];
        if(matches.length===1)part=matches[0];
      }
      const index=part?.new_index||
        (/^MG-[0-9]{3}-[0-9]{3}$/.test(part?.part_number||'')?part.part_number:'');
      return {
        source_row:item.source_row,
        id:part?.id||null,
        name:part?.name||item.source_name||'Do dopasowania',
        source_name:item.source_name||part?.name||'',
        source_code:item.old_index||'',
        source_sap:item.source_sap||'',
        sap_number:part?.sap_number||'',
        part_number:index,
        old_index:part?.old_index||item.old_index||'',
        required_quantity:requirements.has(item.source_row)
          ?requirements.get(item.source_row):item.required_quantity,
        has_photo:part?.has_photo||0,
        part_found:Boolean(part),
        index_assigned:Boolean(index)
      };
    });
  return {parts,matchedParts:parts.filter(x=>x.part_found).length,
    unresolved:parts.filter(x=>!x.part_found).length,
    expectedParts:parts.length,snapshotDate:'11.11.2026'};
}
