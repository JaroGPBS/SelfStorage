// Central module catalogue. V2 stores multiple type assignments per prefix; V1 retained as migration backup.
import {ensureModulePrefixRegistry} from './module-prefix-registry.js';
const seed=[
 ['outdoor','OUTDOOR',['FM','LQ','RQ','XS','ODL','ODR']],
 ['indoor','INDOOR',['CU','DUO','HICU','HIDUO','HIUNO','CU RJ45','HICU RJ45']],
 ['bq','BLOQ.IT',['CU','DUO','CU OUT','DUO OUT']],
 ['newgen','NEW GEN',['CU','DUO L','DUO R']]
];
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toUpperCase();
const compact=v=>norm(v).replace(/[\s._-]/g,'');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const validName=v=>/^[A-Z0-9][A-Z0-9 ._-]{0,29}$/.test(v);
const validPrefix=v=>/^[A-Z0-9]{2,15}$/.test(v);
const rows=async(db,sql,...args)=>{const stmt=db.prepare(sql);return (await (args.length?stmt.bind(...args):stmt).all()).results||[];}
const audit=(db,actor,action,id,details)=>db.prepare('INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,'MODULE_CATALOG',id,JSON.stringify(details));
async function ensure(db){
 await ensureModulePrefixRegistry(db);
 await db.batch([
 db.prepare('CREATE TABLE IF NOT EXISTS module_catalog_groups (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,sort_order INTEGER NOT NULL DEFAULT 0)'),
 db.prepare('CREATE TABLE IF NOT EXISTS module_catalog_types (id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES module_catalog_groups(id),name TEXT NOT NULL,scanner_label TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,UNIQUE(group_id,name))'),
 db.prepare('CREATE TABLE IF NOT EXISTS module_catalog_prefix_links (prefix TEXT PRIMARY KEY REFERENCES module_serial_prefixes(prefix) ON DELETE CASCADE ON UPDATE CASCADE,type_id TEXT NOT NULL REFERENCES module_catalog_types(id))'),
 db.prepare('CREATE TABLE IF NOT EXISTS module_catalog_meta (id TEXT PRIMARY KEY)'),
 db.prepare("CREATE TABLE IF NOT EXISTS module_catalog_prefix_assignments (prefix TEXT NOT NULL,type_id TEXT NOT NULL DEFAULT '',legacy_label TEXT NOT NULL DEFAULT '',PRIMARY KEY(prefix,type_id))")
 ]);
 if(await db.prepare("SELECT id FROM module_catalog_meta WHERE id='seed-v1'").first())return;
 const inserts=[];
 seed.forEach(([id,name,types],i)=>{
  inserts.push(db.prepare('INSERT OR IGNORE INTO module_catalog_groups(id,name,sort_order) VALUES(?,?,?)').bind(id,name,i));
  types.forEach((type,j)=>{
   const label=id==='bq'?'BQ '+type:id==='newgen'?'NEW GEN '+type:id==='indoor'&&['CU','DUO'].includes(type)?'INDOOR '+type:type;
   inserts.push(db.prepare('INSERT OR IGNORE INTO module_catalog_types(id,group_id,name,scanner_label,sort_order) VALUES(?,?,?,?,?)').bind(id+':'+type.toLowerCase().replace(/ /g,'-'),id,type,label,j));
  });
 });
 inserts.push(db.prepare("INSERT OR IGNORE INTO module_catalog_meta(id) VALUES('seed-v1')"));
 await db.batch(inserts);
}
function inferType(prefix,types){
 const key=compact(prefix.moduleType);
 const exact=types.filter(t=>compact(t.scannerLabel)===key||
  (t.groupId==='bq'&&compact('BLOQ.IT '+t.name)===key)||
  (t.groupId==='newgen'&&compact('NG '+t.name)===key));
 if(exact.length===1)return exact[0].id;
 if(exact.length>1)return null;
 const bare=types.filter(t=>compact(t.name)===key);
 return bare.length===1?bare[0].id:null;
}
const markerSql="SELECT id FROM module_catalog_meta WHERE id='prefix-assignments-v2'";
const assignmentSql="SELECT a.prefix,COALESCE(t.scanner_label,a.legacy_label) AS moduleType,NULLIF(a.type_id,'') AS typeId,t.name AS typeName,g.name AS groupName FROM module_catalog_prefix_assignments a LEFT JOIN module_catalog_types t ON t.id=a.type_id LEFT JOIN module_catalog_groups g ON g.id=t.group_id ORDER BY length(a.prefix) DESC,a.prefix,t.scanner_label";
async function catalogueTypes(db){return rows(db,'SELECT t.id,t.group_id AS groupId,t.name,t.scanner_label AS scannerLabel,t.active,t.sort_order AS sortOrder,g.name AS groupName FROM module_catalog_types t JOIN module_catalog_groups g ON g.id=t.group_id ORDER BY g.sort_order,t.sort_order,t.name');}
export async function listModuleCatalog(db){
 await ensure(db);
 const [groups,types]=await Promise.all([
 rows(db,'SELECT id,name,sort_order AS sortOrder FROM module_catalog_groups ORDER BY sort_order,name'),
 catalogueTypes(db)
 ]);
 if(!await db.prepare(markerSql).first()){
  const legacy=await rows(db,'SELECT p.prefix,p.module_type AS moduleType,l.type_id AS typeId FROM module_serial_prefixes p LEFT JOIN module_catalog_prefix_links l ON l.prefix=p.prefix ORDER BY p.prefix');
  const batch=legacy.map(p=>db.prepare("INSERT OR IGNORE INTO module_catalog_prefix_assignments(prefix,type_id,legacy_label) SELECT ?,?,? WHERE NOT EXISTS ("+markerSql+")").bind(p.prefix,p.typeId||inferType(p,types)||'',p.moduleType));
  // Marker and assignments commit atomically. Retain the old tables unchanged.
  batch.push(db.prepare("INSERT OR IGNORE INTO module_catalog_meta(id) VALUES('prefix-assignments-v2')"));
  await db.batch(batch);
 }
 return {groups,types,prefixes:await rows(db,assignmentSql)};
}
// Mobile only reads the catalogue. Until Admin initializes v2, use the old mapping.
export async function readModuleScannerCatalog(db){
 const meta=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='module_catalog_meta'").first();
 if(meta&&await db.prepare(markerSql).first()){
  const [candidates,types]=await Promise.all([rows(db,assignmentSql),catalogueTypes(db)]);
  // Old mobile clients cannot display choices. Never send an ambiguous mapping or a
  // shorter mapping that could mask it to those clients.
  const labels=new Map();
  for(const p of candidates){if(!labels.has(p.prefix))labels.set(p.prefix,new Set());labels.get(p.prefix).add(p.moduleType);}
  const ambiguous=[...labels].filter(([,v])=>v.size>1).map(([p])=>p);
  const modulePrefixes=candidates.filter(p=>!ambiguous.some(a=>a.startsWith(p.prefix)));
  return {modulePrefixes,modulePrefixCandidates:candidates,moduleCatalogTypes:types.filter(t=>Number(t.active))};
 }
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='module_serial_prefixes'").first();
 const legacy=exists?await rows(db,'SELECT prefix,module_type AS moduleType FROM module_serial_prefixes ORDER BY length(prefix) DESC'):[];
 return {modulePrefixes:legacy,modulePrefixCandidates:legacy,moduleCatalogTypes:[]};
}
export async function mutateModuleCatalog(db,body,actor){
 const data=await listModuleCatalog(db),action=body.action;
 const group=data.groups.find(g=>g.id===body.groupId),type=data.types.find(t=>t.id===body.typeId);
 const name=norm(body.name);
 if(action==='moduleCatalogGroupSave'){
  if(!validName(name))throw bad('Podaj nazwę grupy (1–30 znaków).');
  if(body.groupId&&!group)throw bad('Grupa nie istnieje.',404);
  if(data.groups.some(g=>g.name===name&&g.id!==group?.id))throw bad('Taka grupa już istnieje.',409);
  const id=group?.id||crypto.randomUUID();
  await db.batch([group?db.prepare('UPDATE module_catalog_groups SET name=? WHERE id=?').bind(name,id):
   db.prepare('INSERT INTO module_catalog_groups(id,name,sort_order) VALUES(?,?,?)').bind(id,name,data.groups.length),
   audit(db,actor,action,id,{name})]);
  return {id};
 }
 if(action==='moduleCatalogTypeSave'){
  if(!group)throw bad('Wybierz grupę.',404);
  if(body.typeId&&(!type||type.groupId!==group.id))throw bad('Typ nie istnieje w tej grupie.',404);
  if(!validName(name))throw bad('Podaj nazwę typu (1–30 znaków).');
  if(data.types.some(t=>t.groupId===group.id&&t.name===name&&t.id!==type?.id))throw bad('Taki typ już istnieje w tej grupie.',409);
  const id=type?.id||crypto.randomUUID(),other=data.types.filter(t=>t.id!==id);
  let label=type?.name===name?type.scannerLabel:name;
  if(type?.name!==name&&other.some(t=>t.name===name||t.scannerLabel===label))label=group.name+' '+name;
  if(other.some(t=>t.scannerLabel===label))throw bad('Nazwa identyfikacyjna jest już używana.',409);
  const batch=[type?db.prepare('UPDATE module_catalog_types SET name=?,scanner_label=? WHERE id=?').bind(name,label,id):
   db.prepare('INSERT INTO module_catalog_types(id,group_id,name,scanner_label,sort_order) VALUES(?,?,?,?,?)').bind(id,group.id,name,label,data.types.filter(t=>t.groupId===group.id).length)];
  batch.push(audit(db,actor,action,id,{groupId:group.id,name,label}));
  await db.batch(batch);return {id};
 }
 if(action==='moduleCatalogTypeArchive'){
  if(!type)throw bad('Typ nie istnieje.',404);
  const active=body.active===true?1:0;
  await db.batch([db.prepare('UPDATE module_catalog_types SET active=? WHERE id=?').bind(active,type.id),audit(db,actor,action,type.id,{active})]);
  return {id:type.id};
 }
 if(action==='moduleCatalogPrefixDelete'){
  const prefix=norm(body.prefix),typeId=String(body.typeId||'');
  const existing=data.prefixes.find(p=>p.prefix===prefix&&String(p.typeId||'')===typeId);
  if(!existing)throw bad('Przypisanie prefiksu nie istnieje.',404);
  await db.batch([db.prepare('DELETE FROM module_catalog_prefix_assignments WHERE prefix=? AND type_id=?').bind(prefix,typeId),audit(db,actor,action,prefix,{typeId})]);return {prefix};
 }
 if(action==='moduleCatalogPrefixSave'){
  if(!type||!Number(type.active))throw bad('Wybierz aktywny typ modułu.');
  const prefix=norm(body.prefix),oldPrefix=norm(body.oldPrefix),oldTypeId=String(body.oldTypeId??type.id);
  if(!validPrefix(prefix))throw bad('Prefiks musi mieć 2–15 liter lub cyfr.');
  const old=oldPrefix?data.prefixes.find(p=>p.prefix===oldPrefix&&String(p.typeId||'')===oldTypeId):null;
  if(oldPrefix&&!old)throw bad('Przypisanie prefiksu nie istnieje. Odśwież panel.',404);
  if(old?.typeId&&old.typeId!==type.id)throw bad('Nie można zmienić przypisania istniejącego prefiksu do innego typu.',409);
  if(data.prefixes.some(p=>p.prefix===prefix&&p.typeId===type.id&&!(oldPrefix===prefix&&oldTypeId===type.id)))throw bad('Ten prefiks jest już przypisany do tego typu.',409);
  const batch=[];
  if(old)batch.push(db.prepare('DELETE FROM module_catalog_prefix_assignments WHERE prefix=? AND type_id=?').bind(oldPrefix,oldTypeId));
  batch.push(db.prepare('INSERT INTO module_catalog_prefix_assignments(prefix,type_id,legacy_label) VALUES(?,?,?)').bind(prefix,type.id,type.scannerLabel),audit(db,actor,action,prefix,{oldPrefix,oldTypeId,typeId:type.id}));
  await db.batch(batch);return {prefix};
 }
 throw bad('Nieznana operacja.');
}
