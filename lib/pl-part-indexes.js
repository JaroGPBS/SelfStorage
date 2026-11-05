// GPBS: stable migration of existing warehouse labels to the new MG-000-000 series.
// Never re-number a mapped part. The old code remains usable until the admin retires it.
export const NEW_MG_FORMAT=/^MG-[0-9]{3}-[0-9]{3}$/;
export function formatMG(value){
  if(!Number.isSafeInteger(value)||value<1||value>999999)
    throw Error('Wyczerpano pulę numerów magazynowych MG.');
  const digits=String(value).padStart(6,'0');
  return 'MG-'+digits.slice(0,3)+'-'+digits.slice(3);
}
export async function ensurePartIndexTables(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_part_index_migrations ('+
    'part_id TEXT PRIMARY KEY REFERENCES parts(id),'+
    'old_index TEXT NOT NULL COLLATE NOCASE UNIQUE,'+
    'new_index TEXT NOT NULL COLLATE NOCASE UNIQUE,'+
    'toulouse_done INTEGER NOT NULL DEFAULT 0 CHECK(toulouse_done IN (0,1)),'+
    'paris_done INTEGER NOT NULL DEFAULT 0 CHECK(paris_done IN (0,1)),'+
    'old_active INTEGER NOT NULL DEFAULT 1 CHECK(old_active IN (0,1)),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  // A new sequence ID avoids mixing old MG-000001 numbers with MG-000-001.
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_part_number_sequence ('+
    'id TEXT PRIMARY KEY,last_number INTEGER NOT NULL)'
  ).run();
}
export async function ensurePartIndexes(db){
  await ensurePartIndexTables(db);
  // Transactional backfill with deterministic order, only once per part.
  // Existing 199 (or the actual current count) are mapped in one SQL statement.
  await db.batch([
    db.prepare(
      "INSERT INTO pl_part_number_sequence(id,last_number) "+
      "SELECT 'MG2',MAX("+ 
        "COALESCE((SELECT MAX(CAST(SUBSTR(part_number,4,3)||SUBSTR(part_number,8,3) AS INTEGER)) "+
          "FROM parts WHERE part_number GLOB 'MG-[0-9][0-9][0-9]-[0-9][0-9][0-9]'),0),"+
        "COALESCE((SELECT MAX(CAST(SUBSTR(new_index,4,3)||SUBSTR(new_index,8,3) AS INTEGER)) "+
          "FROM pl_part_index_migrations),0)) "+
      "ON CONFLICT(id) DO UPDATE SET last_number=MAX(last_number,excluded.last_number)"
    ),
    db.prepare(
      'INSERT OR IGNORE INTO pl_part_index_migrations (part_id,old_index,new_index) '+
      "SELECT id,part_number,printf('MG-%03d-%03d',"+
        'CAST((base+n)/1000 AS INTEGER),(base+n)%1000) FROM ('+
      'SELECT p.id,p.part_number,ROW_NUMBER() OVER(ORDER BY p.id) AS n,'+
        'seq.last_number AS base '+
      'FROM parts p CROSS JOIN pl_part_number_sequence seq '+
      "WHERE seq.id='MG2' AND p.active=1 AND "+
      "p.part_number NOT GLOB 'MG-[0-9][0-9][0-9]-[0-9][0-9][0-9]' "+
      'AND NOT EXISTS(SELECT 1 FROM pl_part_index_migrations m WHERE m.part_id=p.id))'
    ),
    db.prepare(
      'UPDATE pl_part_number_sequence SET last_number=MAX(last_number,'+
      'COALESCE((SELECT MAX(CAST(SUBSTR(new_index,4,3)||SUBSTR(new_index,8,3) AS INTEGER)) '+
      'FROM pl_part_index_migrations),0)) '+
      "WHERE id='MG2'"
    )
  ]);
}
export async function allocateMGIndex(db){
  // Always assign a new code AFTER backfilling legacy parts.
  await ensurePartIndexes(db);
  const result=await db.prepare(
    "INSERT INTO pl_part_number_sequence(id,last_number) VALUES ('MG2',1) "+
    'ON CONFLICT(id) DO UPDATE SET last_number=last_number+1 RETURNING last_number'
  ).first();
  return formatMG(Number(result?.last_number));
}
