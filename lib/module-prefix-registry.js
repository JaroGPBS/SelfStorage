// Admin-managed mapping from a serial-number prefix to a module type.
// Source of truth for future scanner integration; no stock or serial mutations.
const PREFIX_PATTERN=/^[A-Z0-9]{2,15}$/;
const TYPE_PATTERN=/^[A-Z0-9][A-Z0-9 _-]{0,29}$/;
const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase();

export async function ensureModulePrefixRegistry(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS module_serial_prefixes ('+
      'prefix TEXT PRIMARY KEY,'+
      'module_type TEXT NOT NULL,'+
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}

export async function listModulePrefixes(db){
  await ensureModulePrefixRegistry(db);
  const rows=await db.prepare(
    'SELECT prefix,module_type AS moduleType,created_at AS createdAt,'+
      'updated_at AS updatedAt FROM module_serial_prefixes '+
      'ORDER BY module_type COLLATE NOCASE, length(prefix) DESC, prefix ASC'
  ).all();
  return rows.results||[];
}

function formFields(body){
  const prefix=normalize(body?.prefix);
  const moduleType=normalize(body?.moduleType);
  const oldPrefix=normalize(body?.oldPrefix);
  if(!PREFIX_PATTERN.test(prefix))
    return {error:'Prefiks musi mieć 2–15 znaków: litery A–Z lub cyfry.',status:400};
  if(!TYPE_PATTERN.test(moduleType))
    return {error:'Podaj typ modułu (maksymalnie 30 znaków).',status:400};
  if(oldPrefix&&!PREFIX_PATTERN.test(oldPrefix))
    return {error:'Nieprawidłowy prefiks do edycji.',status:400};
  return {prefix,moduleType,oldPrefix};
}

function auditStatement(db,actor,action,prefix,details){
  return db.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
    'VALUES(?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),actor,action,'MODULE_PREFIX',prefix,JSON.stringify(details));
}

export async function saveModulePrefix(db,body,actor){
  const fields=formFields(body);
  if(fields.error)return fields;
  const {prefix,moduleType,oldPrefix}=fields;
  await ensureModulePrefixRegistry(db);
  const rows=(await db.prepare(
    'SELECT prefix,module_type AS moduleType FROM module_serial_prefixes'
  ).all()).results||[];
  const old=oldPrefix?rows.find(row=>row.prefix===oldPrefix):null;
  if(oldPrefix&&!old)return {error:'Ten prefiks został już usunięty. Odśwież listę.',status:404};
  if(rows.some(row=>row.prefix===prefix&&row.prefix!==oldPrefix))
    return {error:'Ten prefiks jest już przypisany do innego wpisu.',status:409};
  // Prefix matching is based on startsWith. Overlapping prefixes for two
  // different types would make scanner identification ambiguous.
  const ambiguous=rows.find(row=>row.prefix!==oldPrefix&&
    row.moduleType!==moduleType&&
    (prefix.startsWith(row.prefix)||row.prefix.startsWith(prefix)));
  if(ambiguous)
    return {error:'Konflikt z prefiksem '+ambiguous.prefix+
      ' ('+ambiguous.moduleType+'). Prefiksy różnych modułów nie mogą się pokrywać.',status:409};
  const statement=oldPrefix
    ?db.prepare('UPDATE module_serial_prefixes SET prefix=?,module_type=?,'+
      'updated_at=CURRENT_TIMESTAMP WHERE prefix=?').bind(prefix,moduleType,oldPrefix)
    :db.prepare('INSERT INTO module_serial_prefixes(prefix,module_type) VALUES(?,?)')
      .bind(prefix,moduleType);
  await db.batch([statement,auditStatement(db,actor,oldPrefix?'MODULE_PREFIX_UPDATE':'MODULE_PREFIX_CREATE',
    prefix,{oldPrefix:oldPrefix||null,moduleType,previousType:old?.moduleType||null})]);
  return {ok:true,prefix,moduleType};
}

export async function deleteModulePrefix(db,body,actor){
  const prefix=normalize(body?.prefix);
  if(!PREFIX_PATTERN.test(prefix))
    return {error:'Nieprawidłowy prefiks.',status:400};
  await ensureModulePrefixRegistry(db);
  const old=await db.prepare(
    'SELECT module_type AS moduleType FROM module_serial_prefixes WHERE prefix=?'
  ).bind(prefix).first();
  if(!old)return {error:'Prefiks nie istnieje. Odśwież listę.',status:404};
  await db.batch([
    db.prepare('DELETE FROM module_serial_prefixes WHERE prefix=?').bind(prefix),
    auditStatement(db,actor,'MODULE_PREFIX_DELETE',prefix,{moduleType:old.moduleType})
  ]);
  return {ok:true,prefix};
}
