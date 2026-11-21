// PL route-only parts catalogue. Independent of the warehouse catalogue and stock.
export const normalizeRoutePart = value => String(value||'').trim()
  .replace(/\s+/g,' ')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[łŁ]/g,'l').toLocaleLowerCase('pl-PL');

export function routePartFields(value){
  const name=String(value?.partName??value?.name??'').trim().replace(/\s+/g,' ');
  const code=String(value?.partCode??value?.code??'').trim().replace(/\s+/g,' ').toUpperCase();
  const id=String(value?.catalogPartId||'').trim();
  if((!name&&!code)||name.length>180||code.length>100||
     (id&&!/^PL-RPART-[a-f0-9-]{36}$/.test(id)))return null;
  return {name,code,id,key:'n:'+normalizeRoutePart(name||code)};
}

export async function routePartsTableExists(db){
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_route_part_catalog'"
  ).first());
}

export async function routePartsLineColumnExists(db){
  const table=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_route_lines'"
  ).first();
  if(!table)return false;
  const info=(await db.prepare('PRAGMA table_info(pl_route_lines)').all()).results||[];
  return info.some(row=>row.name==='catalog_part_id');
}

export async function ensureRoutePartsSchema(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_part_catalog ('+
      'id TEXT PRIMARY KEY,part_name TEXT NOT NULL,part_code TEXT NOT NULL DEFAULT \'\','+
      'name_key TEXT NOT NULL UNIQUE,merged_into TEXT,'+
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  if(await routePartsLineColumnExists(db))return;
  const table=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_route_lines'"
  ).first();
  if(!table)return;
  try{
    await db.prepare('ALTER TABLE pl_route_lines ADD COLUMN catalog_part_id TEXT').run();
  }catch(error){
    if(!await routePartsLineColumnExists(db))throw error;
  }
}

export async function listRouteParts(db,query='',limit=40){
  if(!await routePartsTableExists(db))return [];
  const term=normalizeRoutePart(query);
  if(term.length>100)return [];
  const safe=term.replace(/[!%_]/g,'!$&');
  const max=Math.max(1,Math.min(3000,Number(limit)||40));
  const statement=term
    ?db.prepare(
      "SELECT id,part_name AS name,part_code AS code FROM pl_route_part_catalog "+
      "WHERE merged_into IS NULL AND (name_key LIKE ? ESCAPE '!' OR lower(part_code) LIKE ? ESCAPE '!') "+
      'ORDER BY part_name COLLATE NOCASE LIMIT ?'
    ).bind('%'+safe+'%','%'+safe+'%',max)
    :db.prepare(
      'SELECT id,part_name AS name,part_code AS code FROM pl_route_part_catalog '+
      'WHERE merged_into IS NULL ORDER BY part_name COLLATE NOCASE LIMIT ?'
    ).bind(max);
  return (await statement.all()).results||[];
}

// Resolve a chosen catalogue ID, or register new free text once.
// The canonical ID (not the visible spelling) is persisted with each route line.
export async function resolveRouteParts(db,lines){
  await ensureRoutePartsSchema(db);
  const resolved=[];
  for(const item of lines){
    const fields=routePartFields(item);
    if(!fields)throw Error('Nieprawidłowa nazwa lub indeks części.');
    let part=null;
    if(fields.id){
      part=await db.prepare(
        'SELECT id,part_name AS name,part_code AS code,merged_into AS mergedInto '+
        'FROM pl_route_part_catalog WHERE id=?'
      ).bind(fields.id).first();
      if(!part)throw Error('Wybrana część nie istnieje już w katalogu. Wybierz ponownie.');
      if(part.mergedInto){
        part=await db.prepare(
          'SELECT id,part_name AS name,part_code AS code FROM pl_route_part_catalog '+
          'WHERE id=? AND merged_into IS NULL'
        ).bind(part.mergedInto).first();
      }
      if(!part)throw Error('Część została scalona. Odśwież formularz.');
    }else{
      // Deduplicate regardless of case, Polish accents or surplus spaces.
      await db.prepare(
        'INSERT OR IGNORE INTO pl_route_part_catalog(id,part_name,part_code,name_key) '+
        'VALUES(?,?,?,?)'
      ).bind('PL-RPART-'+crypto.randomUUID(),fields.name||fields.code,fields.code,fields.key).run();
      part=await db.prepare(
        'SELECT id,part_name AS name,part_code AS code FROM pl_route_part_catalog '+
        'WHERE name_key=? AND merged_into IS NULL'
      ).bind(fields.key).first();
      if(!part)throw Error('Nie udało się dopasować części do katalogu.');
      // An existing canonical part may not yet have had an index recorded.
      // Do not silently overwrite an Admin-maintained index with free text.
    }
    resolved.push({catalogPartId:part.id,partName:part.name,
      partCode:part.code,quantity:item.quantity});
  }
  return resolved;
}

export async function createRoutePart(db,value){
  const fields=routePartFields(value);
  if(!fields||fields.id)return {error:'Podaj prawidłową nazwę lub indeks części.'};
  await ensureRoutePartsSchema(db);
  const exists=await db.prepare(
    'SELECT id FROM pl_route_part_catalog WHERE name_key=?'
  ).bind(fields.key).first();
  if(exists)return {error:'Część o tej nazwie już istnieje. Wybierz ją z katalogu.',conflict:true};
  const id='PL-RPART-'+crypto.randomUUID();
  await db.prepare(
    'INSERT INTO pl_route_part_catalog(id,part_name,part_code,name_key) VALUES(?,?,?,?)'
  ).bind(id,fields.name||fields.code,fields.code,fields.key).run();
  return {part:{id,name:fields.name||fields.code,code:fields.code}};
}

export async function updateRoutePart(db,id,value){
  if(!/^PL-RPART-[a-f0-9-]{36}$/.test(String(id||'')))
    return {error:'Nieprawidłowy identyfikator części.'};
  const fields=routePartFields(value);
  if(!fields||fields.id)return {error:'Podaj prawidłowe dane części.'};
  if(!await routePartsTableExists(db))return {error:'Nie ma jeszcze katalogu części.'};
  const current=await db.prepare(
    'SELECT id FROM pl_route_part_catalog WHERE id=? AND merged_into IS NULL'
  ).bind(id).first();
  if(!current)return {error:'Część nie istnieje lub została scalona.'};
  const duplicate=await db.prepare(
    'SELECT id FROM pl_route_part_catalog WHERE name_key=? AND id<>?'
  ).bind(fields.key,id).first();
  if(duplicate)return {error:'Taka nazwa istnieje. Użyj opcji scalania części.',conflict:true};
  await db.prepare(
    'UPDATE pl_route_part_catalog SET part_name=?,part_code=?,name_key=?,'+
    'updated_at=CURRENT_TIMESTAMP WHERE id=? AND merged_into IS NULL'
  ).bind(fields.name||fields.code,fields.code,fields.key,id).run();
  return {part:{id,name:fields.name||fields.code,code:fields.code}};
}

export async function mergeRouteParts(db,sourceId,targetId){
  const valid=id=>/^PL-RPART-[a-f0-9-]{36}$/.test(String(id||''));
  if(!valid(sourceId)||!valid(targetId)||sourceId===targetId)
    return {error:'Wybierz dwie różne części z katalogu.'};
  if(!await routePartsTableExists(db))return {error:'Nie ma jeszcze katalogu części.'};
  const rows=(await db.prepare(
    'SELECT id,merged_into AS mergedInto FROM pl_route_part_catalog WHERE id IN (?,?)'
  ).bind(sourceId,targetId).all()).results||[];
  if(rows.length!==2||rows.some(row=>row.mergedInto))
    return {error:'Wybrane części muszą być aktywne i niescalone.'};
  const statements=[];
  if(await routePartsLineColumnExists(db)){
    statements.push(db.prepare(
      'UPDATE pl_route_lines SET catalog_part_id=? WHERE catalog_part_id=?'
    ).bind(targetId,sourceId));
  }
  statements.push(db.prepare(
    'UPDATE pl_route_part_catalog SET merged_into=?,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=? AND merged_into IS NULL'
  ).bind(targetId,sourceId));
  const results=await db.batch(statements);
  if(Number(results[results.length-1]?.meta?.changes||0)!==1)
    return {error:'Nie udało się scalić części. Odśwież katalog.'};
  return {merged:true,remapped:Number(results[0]?.meta?.changes||0)};
}

export async function importPreviousRouteParts(db,limit=100){
  await ensureRoutePartsSchema(db);
  const hasPresentation=(await db.prepare('PRAGMA table_info(pl_routes)').all())
    .results?.some(row=>row.name==='is_presentation');
  const onlyReal=hasPresentation?'AND COALESCE(r.is_presentation,0)=0 ':'';
  const sql='SELECT l.route_id AS routeId,l.position,l.part_code AS partCode,'+
    'l.part_name AS partName,l.quantity FROM pl_route_lines l '+
    'JOIN pl_routes r ON r.id=l.route_id WHERE l.catalog_part_id IS NULL '+
    onlyReal+'ORDER BY r.route_date DESC,l.route_id,l.position LIMIT ?';
  const rows=(await db.prepare(sql).bind(Math.max(1,Math.min(100,limit))).all()).results||[];
  if(!rows.length)return {imported:0,remaining:0};
  const parts=await resolveRouteParts(db,rows);
  const stmts=rows.map((line,i)=>db.prepare(
    'UPDATE pl_route_lines SET catalog_part_id=? WHERE route_id=? '+
    'AND position=? AND catalog_part_id IS NULL'
  ).bind(parts[i].catalogPartId,line.routeId,line.position));
  const result=await db.batch(stmts);
  const imported=result.reduce((s,r)=>s+Number(r?.meta?.changes||0),0);
  const remaining=await db.prepare(
    'SELECT COUNT(*) AS n FROM pl_route_lines l JOIN pl_routes r ON r.id=l.route_id '+
    'WHERE l.catalog_part_id IS NULL '+onlyReal
  ).first();
  return {imported,remaining:Number(remaining?.n||0)};
}
