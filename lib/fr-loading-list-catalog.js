// Belleville loading checklist: aliases from carrier Excel -> existing GPBS part IDs.
// Configuration only. This module NEVER changes stock, issues, receipts or WZ.
const ID=/^[0-9a-f-]{36}$/i;
const PART_ID=/^[A-Za-z0-9_-]{1,100}$/;

export async function ensureFrLoadingListCatalog(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS fr_loading_list_aliases ('+
    'id TEXT PRIMARY KEY,'+
    'excel_name TEXT NOT NULL COLLATE NOCASE UNIQUE,'+
    'display_name TEXT NOT NULL,'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS fr_loading_list_part_links ('+
    'alias_id TEXT NOT NULL REFERENCES fr_loading_list_aliases(id) ON DELETE CASCADE,'+
    'part_id TEXT NOT NULL REFERENCES parts(id),'+
    'PRIMARY KEY(alias_id,part_id))').run();
}

async function indexJoin(db){
  const present=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
  ).first();
  return {
    join:present?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'',
    index:present?'COALESCE(NULLIF(ix.new_index,\'\'),p.part_number)':'p.part_number'
  };
}

export async function listFrLoadingListCatalog(db){
  await ensureFrLoadingListCatalog(db);
  const {join,index}=await indexJoin(db);
  const [aliases,links,parts]=await Promise.all([
    db.prepare('SELECT id,excel_name AS excelName,display_name AS displayName '+
      'FROM fr_loading_list_aliases ORDER BY excel_name COLLATE NOCASE').all(),
    db.prepare('SELECT l.alias_id AS aliasId,p.id AS partId,p.name AS partName,'+
      index+' AS warehouseIndex FROM fr_loading_list_part_links l '+
      'JOIN parts p ON p.id=l.part_id '+join+
      'ORDER BY l.alias_id,warehouseIndex').all(),
    db.prepare('SELECT p.id,p.name,'+index+' AS warehouseIndex '+
      'FROM parts p '+join+
      'WHERE p.active=1 ORDER BY warehouseIndex COLLATE NOCASE LIMIT 4000').all()
  ]);
  const byAlias=new Map();
  for(const part of links.results||[]){
    if(!byAlias.has(part.aliasId))byAlias.set(part.aliasId,[]);
    byAlias.get(part.aliasId).push({
      id:part.partId,index:part.warehouseIndex,name:part.partName
    });
  }
  return {
    entries:(aliases.results||[]).map(item=>({
      ...item,parts:byAlias.get(item.id)||[]
    })),
    catalogue:(parts.results||[]).map(part=>({
      id:part.id,index:part.warehouseIndex,name:part.name
    }))
  };
}

export async function saveFrLoadingListAlias(db,body){
  const id=String(body?.id||'').trim();
  const excelName=String(body?.excelName||'').trim().replace(/\s+/g,' ');
  const displayName=String(body?.displayName||'').trim().replace(/\s+/g,' ');
  const partIds=body?.partIds;
  if(id&&!ID.test(id))throw Error('Nieprawidłowy wpis słownika.');
  if(excelName.length<2||excelName.length>240||/[<>\r\n]/.test(excelName))
    throw Error('Nazwa z Excela musi mieć od 2 do 240 znaków.');
  if(displayName.length<2||displayName.length>160||/[<>\r\n]/.test(displayName))
    throw Error('Nazwa na liście kontrolnej musi mieć od 2 do 160 znaków.');
  if(!Array.isArray(partIds)||partIds.length<1||partIds.length>50||
     new Set(partIds).size!==partIds.length||
     !partIds.every(value=>typeof value==='string'&&PART_ID.test(value)))
    throw Error('Wybierz od 1 do 50 unikalnych indeksów magazynowych.');
  await ensureFrLoadingListCatalog(db);
  const existing=id?await db.prepare('SELECT id FROM fr_loading_list_aliases WHERE id=?').bind(id).first():null;
  if(id&&!existing)throw Error('Wpis został usunięty. Odśwież listę.');
  const found=await db.prepare('SELECT id FROM parts WHERE active=1 AND id IN ('+
    partIds.map(()=>'?').join(',')+')').bind(...partIds).all();
  if((found.results||[]).length!==partIds.length)
    throw Error('Co najmniej jeden indeks nie należy już do aktywnego katalogu.');
  const key=id||crypto.randomUUID();
  const statements=[
    id?db.prepare('UPDATE fr_loading_list_aliases SET excel_name=?,display_name=?,'+
      'updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(excelName,displayName,key):
      db.prepare('INSERT INTO fr_loading_list_aliases(id,excel_name,display_name) '+
      'VALUES(?,?,?)').bind(key,excelName,displayName),
    db.prepare('DELETE FROM fr_loading_list_part_links WHERE alias_id=?').bind(key),
    ...partIds.map(partId=>db.prepare('INSERT INTO fr_loading_list_part_links(alias_id,part_id) '+
      'VALUES(?,?)').bind(key,partId))
  ];
  await db.batch(statements);
  return {id:key};
}

export async function deleteFrLoadingListAlias(db,id){
  if(!ID.test(String(id||'')))throw Error('Nieprawidłowy wpis słownika.');
  await ensureFrLoadingListCatalog(db);
  await db.batch([
    db.prepare('DELETE FROM fr_loading_list_part_links WHERE alias_id=?').bind(id),
    db.prepare('DELETE FROM fr_loading_list_aliases WHERE id=?').bind(id)
  ]);
}
