// Shared D1 catalogue data for the Belleville CMR.
// Part weights are stored by existing part ID; no duplicate parts catalogue.
const TYPE_RE=/^[A-Z0-9][A-Z0-9 _.-]{0,39}$/;
const ID_RE=/^[A-Za-z0-9_-]{1,100}$/;
// Explicit module family avoids mixing similarly named CU/DUO units from
// Indoor, Bloq.it and NewGen. Existing plain-type D1 weights remain intact.
export const CMR_MODULE_GROUPS=[
  {name:'OUTDOOR',types:['FM','LQ','RQ','XS','ODL','ODR']},
  {name:'INDOOR',types:['CU','DUO','HICU','HIDUO','HI UNO','CU RJ45','HICU RJ45']},
  {name:'BLOQ.IT',types:['CU','DUO','CU OUT','DUO OUT']},
  {name:'NEWGEN',types:['CU','DUO L','DUO R']},
  {name:'INNE',types:['CUIND','EXTIND']}
];
export const CMR_MODULE_TYPES=CMR_MODULE_GROUPS.flatMap(group=>
  group.types.map(type=>group.name+' - '+type));
export function cmrWeight(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(String(value).trim().replace(',','.'));
  if(!Number.isFinite(n)||n<0||n>100000||Math.abs(Math.round(n*1000)-n*1000)>0.000001)
    throw Error('Waga musi być liczbą od 0 do 100 000 kg (maks. 3 miejsca po przecinku).');
  return n;
}
export async function ensureCmrWeights(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS cmr_part_weights ('+
    'part_id TEXT PRIMARY KEY REFERENCES parts(id),'+
    'weight_kg REAL NOT NULL CHECK(weight_kg>=0),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS cmr_module_weights ('+
    'module_type TEXT PRIMARY KEY,'+
    'weight_kg REAL NOT NULL CHECK(weight_kg>=0),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
}
export async function listCmrModuleWeights(db){
  await ensureCmrWeights(db);
  const rows=await db.prepare(
    'SELECT module_type AS moduleType,weight_kg AS weightKg '+
    'FROM cmr_module_weights ORDER BY module_type').all();
  return {types:CMR_MODULE_TYPES,weights:rows.results||[]};
}
export async function listCmrPartWeights(db){
  await ensureCmrWeights(db);
  const rows=await db.prepare('SELECT p.id,p.name,p.sap_number AS sap,'+
    'w.weight_kg AS weightKg FROM parts p '+
    'LEFT JOIN cmr_part_weights w ON w.part_id=p.id '+
    'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE LIMIT 4000').all();
  return rows.results||[];
}
export async function saveCmrModuleWeight(db,type,value){
  const t=String(type||'').trim().replace(/\s+/g,' ').toUpperCase();
  if(!TYPE_RE.test(t))throw Error('Nieprawidłowy typ modułu.');
  const kg=cmrWeight(value);
  if(kg===null){
    await ensureCmrWeights(db);
    await db.prepare('DELETE FROM cmr_module_weights WHERE module_type=?').bind(t).run();
  }else{
    await ensureCmrWeights(db);
    await db.prepare('INSERT INTO cmr_module_weights(module_type,weight_kg) VALUES(?,?) '+
      'ON CONFLICT(module_type) DO UPDATE SET weight_kg=excluded.weight_kg,'+
      'updated_at=CURRENT_TIMESTAMP').bind(t,kg).run();
  }
  return {moduleType:t,weightKg:kg};
}
export function partWeightStatement(db,partId,value){
  if(!ID_RE.test(String(partId)))throw Error('Nieprawidłowa część.');
  const kg=cmrWeight(value);
  return kg===null
    ?db.prepare('DELETE FROM cmr_part_weights WHERE part_id=?').bind(partId)
    :db.prepare('INSERT INTO cmr_part_weights(part_id,weight_kg) VALUES(?,?) '+
      'ON CONFLICT(part_id) DO UPDATE SET weight_kg=excluded.weight_kg,'+
      'updated_at=CURRENT_TIMESTAMP').bind(partId,kg);
}
export async function ensureCmrCarriers(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS cmr_belleville_carriers ('+
    'id TEXT PRIMARY KEY,'+
    'name TEXT NOT NULL COLLATE NOCASE UNIQUE,'+
    'address TEXT NOT NULL DEFAULT \'\','+
    'stamp_png_base64 TEXT,'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
}
export async function listCmrCarriers(db,includeStamp=false){
  await ensureCmrCarriers(db);
  const rows=await db.prepare(
    'SELECT id,name,address'+(includeStamp?',stamp_png_base64 AS stampBase64':'')+' '+
    'FROM cmr_belleville_carriers ORDER BY name COLLATE NOCASE').all();
  return rows.results||[];
}
export async function upsertCmrCarrier(db,body){
  await ensureCmrCarriers(db);
  const id=String(body?.id||'');
  const name=String(body?.name||'').trim();
  const address=String(body?.address||'').trim();
  const stamp=body?.stampBase64;
  if(name.length<2||name.length>120||/[\r\n<>]/.test(name)||
    address.length>1600||/[<>]/.test(address))
    throw Error('Sprawdź nazwę i adres przewoźnika.');
  if(stamp!==null&&stamp!==undefined&&stamp!==''&&
    (typeof stamp!=='string'||stamp.length>240000||
     !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(stamp)))
    throw Error('Pieczątka musi być poprawnym PNG, maksymalnie około 175 KB.');
  if(id&&!/^[0-9a-f-]{36}$/.test(id))throw Error('Nieprawidłowy przewoźnik.');
  const key=id||crypto.randomUUID();
  if(id){
    const old=await db.prepare('SELECT id FROM cmr_belleville_carriers WHERE id=?').bind(id).first();
    if(!old)throw Error('Przewoźnik został usunięty. Odśwież listę.');
    await db.prepare('UPDATE cmr_belleville_carriers SET name=?,address=?,'+
      'stamp_png_base64=COALESCE(?,stamp_png_base64),'+
      'updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,address,stamp===undefined?null:stamp,key).run();
    // A separate explicit empty value removes the stamp.
    if(stamp==='')await db.prepare('UPDATE cmr_belleville_carriers '+
      'SET stamp_png_base64=NULL WHERE id=?').bind(key).run();
  }else{
    await db.prepare('INSERT INTO cmr_belleville_carriers(id,name,address,stamp_png_base64) '+
      'VALUES(?,?,?,?)').bind(key,name,address,stamp||null).run();
  }
  return {id:key,name,address};
}
export async function deleteCmrCarrier(db,id){
  if(!/^[0-9a-f-]{36}$/.test(String(id)))throw Error('Nieprawidłowy przewoźnik.');
  await ensureCmrCarriers(db);
  await db.prepare('DELETE FROM cmr_belleville_carriers WHERE id=?').bind(id).run();
}
