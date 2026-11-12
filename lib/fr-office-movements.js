// French self-storage BOX movements for Office. Read-only: one mobile session
// may contain both POBRANIE (warehouse WZ) and ZWROT (warehouse PZ).
// No migration, duplicated movements or change to stock accounting.
const officeToMobile={PZ:'ZWROT',WZ:'POBRANIE'};
const safeIdentifier=id=>/^[A-Za-z0-9_-]{8,120}$/.test(id);
const rows=async(db,sql,args)=>((await db.prepare(sql).bind(...args).all()).results||[]);
const exists=async(db,name)=>Boolean(await db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
).bind(name).first());

export async function frenchBoxDocuments(db,warehouseId,direction,term='',focus=''){
  const mobile=officeToMobile[direction];
  if(!mobile)throw Error('Nieprawidłowy typ operacji.');
  if(focus&&!safeIdentifier(focus))throw Error('Nieprawidłowy numer operacji.');
  if(!await exists(db,'fr_sessions')||!await exists(db,'fr_session_lines'))
    return {ok:true,documents:[],total:0,matched:0};
  const opposite=mobile==='ZWROT'?'POBRANIE':'ZWROT';
  const from=' FROM fr_sessions s '+
    'JOIN fr_session_lines l ON l.session_id=s.id '+
    'LEFT JOIN users u ON u.id=s.user_id '+
    'LEFT JOIN vehicles v ON v.id=s.vehicle_id ';
  const where=' WHERE s.warehouse_id=? AND l.direction=? ';
  const filter=" AND (?='' OR "+
    "LOWER(COALESCE(u.name,s.user_id)) LIKE '%'||LOWER(?)||'%' OR "+
    "LOWER(COALESCE(v.registration_number,'')) LIKE '%'||LOWER(?)||'%' OR "+
    "s.saved_at LIKE '%'||?||'%' OR "+
    "LOWER(COALESCE(s.comment,'')) LIKE '%'||LOWER(?)||'%' OR "+
    "EXISTS(SELECT 1 FROM fr_session_lines ml JOIN parts p ON p.id=ml.part_id "+
    "WHERE ml.session_id=s.id AND ml.direction=? AND ("+
    "LOWER(p.name) LIKE '%'||LOWER(?)||'%' OR "+
    "LOWER(COALESCE(p.sap_number,'')) LIKE '%'||LOWER(?)||'%' OR "+
    "LOWER(COALESCE(p.part_number,'')) LIKE '%'||LOWER(?)||'%')))";
  const q=String(term||'').trim().slice(0,100);
  const base=[warehouseId,mobile];
  const filtered=[...base,q,q,q,q,q,mobile,q,q,q];
  const count=await db.prepare('SELECT COUNT(DISTINCT s.id) AS n'+from+where)
    .bind(...base).first();
  const matched=await db.prepare('SELECT COUNT(DISTINCT s.id) AS n'+from+where+filter)
    .bind(...filtered).first();
  const fields='SELECT s.id,s.saved_at AS date,'+
    'COALESCE(u.name,s.user_id) AS counterparty,'+
    'COALESCE(v.registration_number,\'\') AS registration_plate,'+
    'COALESCE(u.name,s.user_id) AS worker,'+
    'COUNT(l.part_id) AS positions,COALESCE(SUM(l.quantity),0) AS units,'+
    '0 AS shortage,COALESCE(s.comment,\'\') AS comment,'+
    'EXISTS(SELECT 1 FROM fr_session_lines rel '+
    'WHERE rel.session_id=s.id AND rel.direction=?) AS has_related ';
  const tail=' GROUP BY s.id ORDER BY s.saved_at DESC,s.id DESC LIMIT 200';
  const documents=await rows(db,fields+from+where+filter+tail,
    [opposite,...filtered]);
  // The same mobile session can have a PZ and WZ half. Show the linked half
  // even when it is older than the 200 newest rows, as in the Polish Office.
  if(focus&&!documents.some(item=>item.id===focus)){
    const focused=await rows(db,fields+from+where+' AND s.id=? GROUP BY s.id LIMIT 1',
      [opposite,...base,focus]);
    if(focused.length)documents.unshift(focused[0]);
  }
  return {ok:true,documents,total:Number(count?.n||0),matched:Number(matched?.n||0)};
}

export async function frenchBoxDocumentLines(db,warehouseId,direction,id){
  const mobile=officeToMobile[direction];
  if(!mobile||!safeIdentifier(id))throw Error('Nieprawidłowy dokument.');
  if(!await exists(db,'fr_sessions')||!await exists(db,'fr_session_lines'))
    return {ok:true,lines:[]};
  const hasIndexMap=await exists(db,'pl_part_index_migrations');
  const indexed=hasIndexMap?'COALESCE(ix.new_index,p.part_number)':'p.part_number';
  const lines=await rows(db,
    'SELECT p.sap_number,'+indexed+' AS part_number,p.name,l.quantity,'+
    '0 AS nok,0 AS shortage_quantity FROM fr_sessions s '+
    'JOIN fr_session_lines l ON l.session_id=s.id '+
    'JOIN parts p ON p.id=l.part_id '+
    (hasIndexMap?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
    'WHERE s.id=? AND s.warehouse_id=? AND l.direction=? '+
    'ORDER BY p.name COLLATE NOCASE,p.id',
    [id,warehouseId,mobile]);
  return {ok:true,lines};
}
