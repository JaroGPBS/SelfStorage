// Shared, read-only vehicle parts catalogue query used by Admin and Office.
// Catalogue names and MG codes come from D1. Source-specific required quantity
// comes from its vehicle category entry or a D1 override; NO stock is inferred.
import {VEHICLE_CATALOG_SNAPSHOT} from './vehicle-catalog-20261111.js';
import {ensurePartIndexes} from './pl-part-indexes.js';

export async function getVehicleCatalogue(db) {
    // Single shared catalogue: never duplicate D1 parts or create car balances.
    await ensurePartIndexes(db);
    const existing=await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN "+
      "('pl_part_photos','pl_part_photo_objects','vehicle_catalog_requirements')"
    ).all();
    const names=new Set((existing.results||[]).map(row=>row.name));
    const photos=[
      names.has('pl_part_photo_objects')
        ?'EXISTS(SELECT 1 FROM pl_part_photo_objects o WHERE o.part_id=p.id)':null,
      names.has('pl_part_photos')
        ?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
    ].filter(Boolean);
    const all=(await db.prepare(
      'SELECT p.id,p.name,p.part_number,p.sap_number,ix.old_index,ix.new_index,'+
      (photos.length?'('+photos.join(' OR ')+')':'0')+' AS has_photo '+
      'FROM parts p LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id '+
      'WHERE p.active=1 ORDER BY p.id LIMIT 3000'
    ).all()).results||[];
    const byId=new Map(all.map(part=>[part.id,part]));
    const byLegacy=new Map(),byName=new Map();
    for(const part of all){
      for(const old of [part.part_number,part.old_index]){
        const code=String(old||'').trim().toUpperCase();
        if(!code)continue;
        const list=byLegacy.get(code)||[];list.push(part);byLegacy.set(code,list);
      }
      const label=String(part.name||'').trim().toLocaleLowerCase('pl');
      if(label){const list=byName.get(label)||[];list.push(part);byName.set(label,list);}
    }
    let overrides=new Map();
    if(names.has('vehicle_catalog_requirements')){
      const rows=await db.prepare(
        'SELECT source_row,required_quantity FROM vehicle_catalog_requirements'
      ).all();
      overrides=new Map((rows.results||[]).map(row=>[
        Number(row.source_row),row.required_quantity
      ]));
    }
    const parts=VEHICLE_CATALOG_SNAPSHOT.map(item=>{
      let part=item.part_id?byId.get(item.part_id):null;
      if(!part&&item.old_index){
        const list=byLegacy.get(item.old_index.toUpperCase())||[];
        if(list.length===1)part=list[0];
      }
      if(!part){
        const list=byName.get(item.source_name.toLocaleLowerCase('pl'))||[];
        if(list.length===1)part=list[0];
      }
      const code=part?.new_index||
        (/^MG-[0-9]{3}-[0-9]{3}$/.test(part?.part_number||'')?part.part_number:'');
      return {
        source_row:item.source_row,id:part?.id||null,
        name:part?.name||item.source_name,
        source_name:item.source_name,source_code:item.old_index,
        source_sap:item.source_sap,sap_number:part?.sap_number||'',
        part_number:code,old_index:part?.old_index||item.old_index||'',
        required_quantity:overrides.has(item.source_row)
          ?overrides.get(item.source_row):item.required_quantity,
        has_photo:part?.has_photo||0,
        part_found:Boolean(part),index_assigned:Boolean(code)
      };
    });
    return {parts,matchedParts:parts.filter(x=>x.part_found).length,
      unresolved:parts.filter(x=>!x.part_found).length,
      expectedParts:VEHICLE_CATALOG_SNAPSHOT.length,snapshotDate:'11.11.2026'};
  }
