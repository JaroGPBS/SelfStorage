// GPBS Storage PL: one atomic receipt/issue session, worker PIN cookie only.
// Never calls the legacy French Apps Script API or accepts raw PINs.
import {verifyWorkerSession,workerJson,workerAuthReady} from '../../../lib/pl-worker-auth.js';

const ROLES=new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
const ID=/^PL-SES-[a-f0-9-]{36}$/;
const WH=/^[A-Z0-9-]{2,50}$/;
const PART=/^[A-Za-z0-9_-]{1,100}$/;
const MAX_LINES=80;
const MAX_QUANTITY=100000;
const MAX_COMMENT_CHARS=500;
const MIGRATION='db/13-pl-confirmed-overissues.sql';

function fail(message,status=400){return workerJson({ok:false,error:message},status);}

async function authorized(request,env,warehouseId){
  if(!workerAuthReady(env))return {error:fail('Brak konfiguracji sesji pracownika.',503)};
  if(!WH.test(warehouseId))return {error:fail('Nieprawidłowy magazyn.',400)};
  const user=await verifyWorkerSession(request,env);
  if(!user)return {error:fail('Sesja wygasła. Zaloguj się ponownie.',401)};
  if(!ROLES.has(user.role))return {error:fail('Brak uprawnień do operacji magazynowych.',403)};
  if(!user.warehouses.some(w=>w.id===warehouseId))
    return {error:fail('Brak dostępu do wybranego magazynu.',403)};
  const warehouse=await env.DB.prepare(
    "SELECT id,name FROM warehouses WHERE id=? AND active=1 AND country_code='PL'"
  ).bind(warehouseId).first();
  if(!warehouse)return {error:fail('Magazyn jest niedostępny.',404)};
  return {user,warehouse};
}

async function schemaReady(db){
  const r=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master "+
    "WHERE type='table' AND name IN ('pl_warehouse_sessions','pl_warehouse_session_lines')").first();
  if(Number(r?.n)!==2)return false;
  const columns=await db.prepare('PRAGMA table_info(pl_warehouse_session_lines)').all();
  return ['before_unknown','shortage_quantity'].every(name=>
    (columns.results||[]).some(c=>c.name===name));
}

function normalizeLines(value,description){
  if(!Array.isArray(value))throw Error('Nieprawidłowa lista '+description+'.');
  const used=new Set();
  return value.map(row=>{
    const partId=String(row?.partId||'');
    const quantity=row?.quantity;
    const nok=row?.nok===true;
    const key=partId+':'+(nok?'NOK':'OK');
    if(!PART.test(partId)||!Number.isSafeInteger(quantity)||
      quantity<1||quantity>MAX_QUANTITY||
      (row?.nok!==undefined&&typeof row.nok!=='boolean')||used.has(key))
      throw Error('Sprawdź części i ilości na liście '+description+'.');
    used.add(key);
    return {partId,quantity,nok};
  });
}

function normalizeComment(value,side){
  const text=String(value??'').replace(/\r\n?/g,'\n').trim();
  if(text.length>MAX_COMMENT_CHARS||/[\u0000-\u0008\u000B-\u001F\u007F]/.test(text))
    throw Error('Komentarz '+side+' może zawierać maksymalnie 500 znaków.');
  return text;
}

function legacyCounterparty(input){
  return input.registrationPlate
    ?input.counterparty+' | REJ: '+input.registrationPlate
    :input.counterparty;
}

async function hasRegistrationColumn(db){
  const columns=await db.prepare('PRAGMA table_info(pl_warehouse_sessions)').all();
  return (columns.results||[]).some(row=>row.name==='registration_plate');
}

async function nokTablesExist(db){
  const result=await db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' "+
    "AND name IN ('pl_nok_stock','pl_nok_session_lines')"
  ).first();
  return Number(result?.n)===2;
}

async function ensureNokTables(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_nok_stock ('+
    'warehouse_id TEXT NOT NULL,part_id TEXT NOT NULL,'+
    'quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000000),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'PRIMARY KEY(warehouse_id,part_id),'+
    'FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),'+
    'FOREIGN KEY(part_id) REFERENCES parts(id))'
  ).run();
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_nok_session_lines ('+
    'session_id TEXT NOT NULL,'+
    "direction TEXT NOT NULL CHECK(direction IN ('PZ','WZ')),"+
    'part_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),'+
    'quantity_before INTEGER NOT NULL CHECK(quantity_before>=0),'+
    'quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),'+
    'before_unknown INTEGER NOT NULL DEFAULT 1 CHECK(before_unknown IN (0,1)),'+
    'shortage_quantity INTEGER NOT NULL DEFAULT 0 CHECK(shortage_quantity>=0),'+
    'PRIMARY KEY(session_id,direction,part_id),'+
    'FOREIGN KEY(session_id) REFERENCES pl_warehouse_sessions(id),'+
    'FOREIGN KEY(part_id) REFERENCES parts(id))'
  ).run();
}

async function commentsTableExists(db){
  const result=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_warehouse_session_comments'"
  ).first();
  return Boolean(result);
}

async function ensureCommentsTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_warehouse_session_comments ('+
    'session_id TEXT NOT NULL,'+
    "direction TEXT NOT NULL CHECK(direction IN ('PZ','WZ')),"+
    'comment TEXT NOT NULL CHECK(length(comment) BETWEEN 1 AND 500),'+
    'PRIMARY KEY(session_id,direction),'+
    'FOREIGN KEY(session_id) REFERENCES pl_warehouse_sessions(id))'
  ).run();
}

function normalize(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Nieprawidłowa sesja.');
  const id=String(body.id||'');
  const warehouseId=String(body.warehouseId||'');
  const counterparty=String(body.counterparty||'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pl-PL');
  // Optional only for retries from older clients; the new PL screen requires it.
  const registrationPlate=String(body.registrationPlate||'').trim()
    .replace(/\s+/g,' ').toUpperCase();
  if(!ID.test(id)||!WH.test(warehouseId))throw Error('Nieprawidłowy identyfikator sesji.');
  if(counterparty.length<2||counterparty.length>120||
    /[\u0000-\u001f\u007f]/.test(counterparty))
    throw Error('Podaj ekipę, dostawcę lub odbiorcę (2–120 znaków).');
  if(registrationPlate&&(!/^[A-Z0-9][A-Z0-9 -]{1,19}$/.test(registrationPlate)||
    !/[A-Z0-9]$/.test(registrationPlate)))
    throw Error('Nieprawidłowy numer rejestracyjny.');
  const pz=normalizeLines(body.pz,'PZ');
  const wz=normalizeLines(body.wz,'WZ');
  if(pz.length+wz.length<1||pz.length+wz.length>MAX_LINES)
    throw Error('Dodaj od 1 do '+MAX_LINES+' pozycji PZ/WZ w jednej sesji.');
  const pzComment=normalizeComment(body.pzComment,'PZ');
  const wzComment=normalizeComment(body.wzComment,'WZ');
  const action=body.action===undefined||body.action==='commit'?'commit':body.action;
  if(!['preview','commit'].includes(action))throw Error('Nieznana operacja.');
  const stockSnapshot=body.stockSnapshot;
  if(action==='commit'){
    const key=r=>r.partId+':'+(r.nok?'NOK':'OK');
    const parts=new Set([...pz,...wz].map(key));
    if(!Array.isArray(stockSnapshot)||stockSnapshot.length!==parts.size)
      throw Error('Stan magazynu musi być sprawdzony przed zatwierdzeniem. Wróć do podsumowania.');
    const ids=new Set();
    for(const row of stockSnapshot){
      if(!row||!PART.test(String(row.partId||''))||
         (row.nok!==undefined&&typeof row.nok!=='boolean')||
         !parts.has(key(row))||ids.has(key(row))||
         (row.quantity!==null&&(!Number.isSafeInteger(row.quantity)||row.quantity<0)))
        throw Error('Nieprawidłowe potwierdzenie stanów magazynowych.');
      ids.add(key(row));
    }
  }
  return {id,warehouseId,counterparty,registrationPlate,pz,wz,action,
    pzComment:pz.length?pzComment:'',wzComment:wz.length?wzComment:'',
    stockSnapshot,confirmedOverissue:body.confirmedOverissue===true};
}

async function duplicate(db,input,actorId,hasPlate){
  const existing=await db.prepare(
    'SELECT id,warehouse_id,actor_id,counterparty,committed_at'+
    (hasPlate?',registration_plate':'')+
    ' FROM pl_warehouse_sessions WHERE id=?'
  ).bind(input.id).first();
  if(!existing)return null;
  const hasNok=await nokTablesExist(db);
  const saved=await db.prepare(
    "SELECT direction,part_id,quantity,0 AS nok FROM pl_warehouse_session_lines WHERE session_id=?"+
    (hasNok?" UNION ALL SELECT direction,part_id,quantity,1 AS nok "+
      "FROM pl_nok_session_lines WHERE session_id=?":'')
  ).bind(input.id,...(hasNok?[input.id]:[])).all();
  const expected=new Map();
  for(const direction of ['pz','wz']){
    for(const line of input[direction])
      expected.set(direction.toUpperCase()+':'+line.partId+':'+(line.nok?'NOK':'OK'),line.quantity);
  }
  const rows=saved.results||[];
  let sameComments=!input.pzComment&&!input.wzComment;
  if(await commentsTableExists(db)){
    const stored=await db.prepare(
      'SELECT direction,comment FROM pl_warehouse_session_comments WHERE session_id=?'
    ).bind(input.id).all();
    const notes=new Map((stored.results||[]).map(r=>[r.direction,r.comment]));
    sameComments=(notes.get('PZ')||'')===input.pzComment&&
      (notes.get('WZ')||'')===input.wzComment;
  }
  const name=String(existing.counterparty||'').toLocaleUpperCase('pl-PL');
  const plate=String(existing.registration_plate||'');
  // Also recognize visits stored in legacy combined form before the migration.
  const sameIdentity=(name===input.counterparty&&(!hasPlate||plate===input.registrationPlate))||
    (name===legacyCounterparty(input)&&(!hasPlate||!plate));
  const same=existing.warehouse_id===input.warehouseId&&
    existing.actor_id===actorId&&sameIdentity&&sameComments&&
    rows.length===expected.size&&rows.every(row=>
      expected.get(row.direction+':'+row.part_id+':'+(row.nok?'NOK':'OK'))===Number(row.quantity));
  if(!same)return fail('Identyfikator sesji został już użyty dla innych danych.',409);
  return workerJson({ok:true,id:input.id,alreadySaved:true,
    committedAt:existing.committed_at,pzItems:input.pz.length,wzItems:input.wz.length});
}

async function preview(db,input){
  const combined=new Map();
  const key=r=>r.partId+':'+(r.nok?'NOK':'OK');
  for(const line of input.pz)combined.set(key(line),{
    partId:line.partId,nok:line.nok,pz:line.quantity,wz:0
  });
  for(const line of input.wz){
    const row=combined.get(key(line))||{partId:line.partId,nok:line.nok,pz:0,wz:0};
    row.wz=line.quantity;
    combined.set(key(line),row);
  }
  const parts=[...combined.values()];
  const usesNok=parts.some(p=>p.nok);
  const result=await db.prepare(
    "SELECT json_extract(j.value,'$.partId') AS part_id,"+
    "json_extract(j.value,'$.nok') AS nok,"+
    'p.id AS valid_id,p.name AS name,p.active AS active,'+
    (usesNok?"CASE WHEN json_extract(j.value,'$.nok')=1 THEN n.quantity ELSE s.quantity END":
      's.quantity')+' AS quantity '+
    "FROM json_each(?) j LEFT JOIN parts p ON p.id=json_extract(j.value,'$.partId') "+
    'LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
    (usesNok?'LEFT JOIN pl_nok_stock n ON n.part_id=p.id AND n.warehouse_id=?':'')
  ).bind(JSON.stringify(parts),input.warehouseId,...(usesNok?[input.warehouseId]:[])).all();
  const rows=new Map((result.results||[]).map(r=>[
    r.part_id+':'+(r.nok?'NOK':'OK'),r
  ]));
  if(rows.size!==parts.length||parts.some(p=>!rows.get(key(p))?.valid_id||
    Number(rows.get(key(p)).active)!==1))
    return fail('Część została wyłączona lub nie istnieje w katalogu. Odśwież listę.',409);
  const stockSnapshot=[];
  const warnings=[];
  for(const p of parts){
    const row=rows.get(key(p));
    const stock=row.quantity===null||row.quantity===undefined?null:Number(row.quantity);
    stockSnapshot.push({partId:p.partId,nok:p.nok,quantity:stock});
    if(p.wz===0)continue;
    const available=(stock??0)+p.pz;
    const shortfall=Math.max(0,p.wz-available);
    if(shortfall>0)warnings.push({
      partId:p.partId,nok:p.nok,name:(row.name||p.partId)+(p.nok?' (NOK)':''),
      unknown:stock===null,available:stock===null?null:available,
      received:p.pz,issued:p.wz,shortfall
    });
  }
  return workerJson({ok:true,stockSnapshot,warnings,requiresConfirmation:warnings.length>0});
}

async function commit(db,input,actorId){
  const hasPlate=await hasRegistrationColumn(db);
  const storedCounterparty=hasPlate?input.counterparty:legacyCounterparty(input);
  if(storedCounterparty.length>120)
    return fail('Nazwa ekipy wraz z rejestracją jest za długa (maks. 120 znaków).',400);
  const prior=await duplicate(db,input,actorId,hasPlate);
  if(prior)return prior;
  // Additive table, created only for visits carrying a comment.
  // If this fails, do not commit PZ/WZ without their notes.
  if(input.pzComment||input.wzComment)await ensureCommentsTable(db);

  const combined=new Map();
  const key=r=>r.partId+':'+(r.nok?'NOK':'OK');
  for(const line of input.pz){
    combined.set(key(line),{id:line.partId,nok:line.nok,pz:line.quantity,wz:0});
  }
  for(const line of input.wz){
    const x=combined.get(key(line))||{id:line.partId,nok:line.nok,pz:0,wz:0};
    x.wz=line.quantity;
    combined.set(key(line),x);
  }
  const parts=[...combined.values()];
  const usesNok=parts.some(p=>p.nok);
  // Guard the exact snapshot of EACH stock class. Concurrent normal/NOK changes
  // cannot silently overwrite another worker's operation.
  const snapshot=new Map(input.stockSnapshot.map(r=>[
    r.partId+':'+(r.nok?'NOK':'OK'),r.quantity
  ]));
  if(parts.some(p=>!snapshot.has(p.id+':'+(p.nok?'NOK':'OK'))))
    return fail('Sprawdź ponownie stany części.',409);
  const snapshotJson=JSON.stringify(parts.map(p=>({
    partId:p.id,nok:p.nok,stock:snapshot.get(p.id+':'+(p.nok?'NOK':'OK')),
    pz:p.pz,wz:p.wz
  })));
  const stockColumn=usesNok
    ?"(CASE WHEN json_extract(e.value,'$.nok')=1 THEN n.quantity ELSE s.quantity END)"
    :"s.quantity";
  const partGuards=
    "NOT EXISTS(SELECT 1 FROM json_each(?) AS e "+
    "LEFT JOIN parts p ON p.id=json_extract(e.value,'$.partId') "+
    "LEFT JOIN warehouse_stock s ON s.warehouse_id=? AND s.part_id=p.id "+
    (usesNok?"LEFT JOIN pl_nok_stock n ON n.warehouse_id=? AND n.part_id=p.id ":'')+
    "WHERE p.id IS NULL OR p.active IS NOT 1 "+
    "OR "+stockColumn+" IS NOT json_extract(e.value,'$.stock') "+
    "OR (COALESCE("+stockColumn+",0)+CAST(json_extract(e.value,'$.pz') AS INTEGER)>100000000) "+
    "OR (?=0 AND CAST(json_extract(e.value,'$.wz') AS INTEGER)>"+
    "COALESCE("+stockColumn+",0)+CAST(json_extract(e.value,'$.pz') AS INTEGER)))";
  const guardSql=
    'INSERT INTO pl_warehouse_sessions '+
    '(id,warehouse_id,actor_id,counterparty,'+(hasPlate?'registration_plate,':'')+
    'commit_guard) VALUES ('+(hasPlate?'?,?,?,?,?, ':'?,?,?,?, ')+
    'CASE WHEN EXISTS(SELECT 1 FROM users u LEFT JOIN user_archives a ON a.user_id=u.id '+
    "WHERE u.id=? AND u.active=1 AND a.user_id IS NULL AND "+
    "u.role_code IN ('ADMIN','KIEROWNIK','MAGAZYNIER')) "+
    'AND EXISTS(SELECT 1 FROM user_warehouse_access g JOIN warehouses w '+
    "ON w.id=g.warehouse_id WHERE g.user_id=? AND g.warehouse_id=? "+
    "AND w.active=1 AND w.country_code='PL') AND "+
    partGuards+' THEN 1 ELSE 0 END)';
  const guardArgs=[input.id,input.warehouseId,actorId,storedCounterparty,
    ...(hasPlate?[input.registrationPlate||null]:[]),
    actorId,actorId,input.warehouseId,
    snapshotJson,input.warehouseId,...(usesNok?[input.warehouseId]:[]),
    input.confirmedOverissue?1:0];
  const statements=[db.prepare(guardSql).bind(...guardArgs)];
  for(const part of parts){
    if(part.nok){
      // NOK entries are never added to warehouse_stock (complete goods).
      // Their complete audit trail and stock live in separate D1 tables.
      if(part.pz){
        statements.push(db.prepare(
          'INSERT INTO pl_nok_session_lines '+
          '(session_id,direction,part_id,quantity,quantity_before,quantity_after,before_unknown) '+
          "SELECT ?,'PZ',?,?,COALESCE(n.quantity,0),COALESCE(n.quantity,0)+?,"+
          'CASE WHEN n.part_id IS NULL THEN 1 ELSE 0 END '+
          'FROM parts p LEFT JOIN pl_nok_stock n ON n.part_id=p.id AND n.warehouse_id=? '+
          'WHERE p.id=?'
        ).bind(input.id,part.id,part.pz,part.pz,input.warehouseId,part.id));
        statements.push(db.prepare(
          'INSERT OR IGNORE INTO pl_nok_stock '+
          '(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,0,CURRENT_TIMESTAMP)'
        ).bind(input.warehouseId,part.id));
      }
      if(part.wz){
        statements.push(db.prepare(
          'INSERT INTO pl_nok_session_lines '+
          '(session_id,direction,part_id,quantity,quantity_before,quantity_after,'+
          'before_unknown,shortage_quantity) '+
          "SELECT ?,'WZ',?,?,COALESCE(n.quantity,0)+?,"+
          'MAX(0,COALESCE(n.quantity,0)+?-?),'+
          "CASE WHEN n.part_id IS NULL OR EXISTS(SELECT 1 FROM pl_nok_session_lines l "+
          "WHERE l.session_id=? AND l.part_id=? AND l.direction='PZ' AND l.before_unknown=1) "+
          'THEN 1 ELSE 0 END,'+
          'MAX(0,?-COALESCE(n.quantity,0)-?) '+
          'FROM parts p LEFT JOIN pl_nok_stock n ON n.part_id=p.id AND n.warehouse_id=? '+
          'WHERE p.id=?'
        ).bind(input.id,part.id,part.wz,part.pz,part.pz,part.wz,input.id,part.id,
          part.wz,part.pz,input.warehouseId,part.id));
        statements.push(db.prepare(
          'INSERT OR IGNORE INTO pl_nok_stock '+
          '(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,0,CURRENT_TIMESTAMP)'
        ).bind(input.warehouseId,part.id));
      }
      statements.push(db.prepare(
        'UPDATE pl_nok_stock SET quantity=MAX(0,quantity+?),updated_at=CURRENT_TIMESTAMP '+
        'WHERE warehouse_id=? AND part_id=?'
      ).bind(part.pz-part.wz,input.warehouseId,part.id));
      continue;
    }
    // Record an accurate before/after snapshot BEFORE updating the stock.
    // If a part is both received and issued, PZ logically precedes WZ.
    if(part.pz){
      // Snapshot BEFORE initializing a missing stock row. Unknown stays
      // explicitly distinguishable from a verified count of zero.
      statements.push(db.prepare(
        'INSERT INTO pl_warehouse_session_lines '+
        '(session_id,direction,part_id,quantity,quantity_before,quantity_after,before_unknown) '+
        "SELECT ?,'PZ',?,?,COALESCE(s.quantity,0),COALESCE(s.quantity,0)+?, "+
        'CASE WHEN s.part_id IS NULL THEN 1 ELSE 0 END '+
        'FROM parts p LEFT JOIN warehouse_stock s '+
        'ON s.part_id=p.id AND s.warehouse_id=? WHERE p.id=?'
      ).bind(input.id,part.id,part.pz,part.pz,input.warehouseId,part.id));
      // Initialize only parts that are being RECEIVED; a WZ-only session
      // must never implicitly invent a zero baseline.
      statements.push(db.prepare(
        'INSERT OR IGNORE INTO warehouse_stock '+
        '(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,0,CURRENT_TIMESTAMP)'
      ).bind(input.warehouseId,part.id));
    }
    if(part.wz){
      // Always preserve the *issued* quantity. Store recorded deficit on
      // the WZ line; keep warehouse_stock nonnegative as required by D1.
      statements.push(db.prepare(
        'INSERT INTO pl_warehouse_session_lines '+
        '(session_id,direction,part_id,quantity,quantity_before,quantity_after,'+
        'before_unknown,shortage_quantity) '+
        "SELECT ?,'WZ',?,?,COALESCE(s.quantity,0)+?, "+
        'MAX(0,COALESCE(s.quantity,0)+?-?), '+
        "CASE WHEN s.part_id IS NULL OR EXISTS(SELECT 1 FROM "+
        "pl_warehouse_session_lines l WHERE l.session_id=? AND "+
        "l.part_id=? AND l.direction='PZ' AND l.before_unknown=1) "+
        'THEN 1 ELSE 0 END, '+
        'MAX(0,?-COALESCE(s.quantity,0)-?) '+
        'FROM parts p LEFT JOIN warehouse_stock s '+
        'ON s.part_id=p.id AND s.warehouse_id=? WHERE p.id=?'
      ).bind(input.id,part.id,part.wz,part.pz,part.pz,part.wz,
        input.id,part.id,part.wz,part.pz,input.warehouseId,part.id));
      statements.push(db.prepare(
        'INSERT OR IGNORE INTO warehouse_stock '+
        '(warehouse_id,part_id,quantity,updated_at) VALUES (?,?,0,CURRENT_TIMESTAMP)'
      ).bind(input.warehouseId,part.id));
    }
    statements.push(db.prepare(
      'UPDATE warehouse_stock SET quantity=MAX(0,quantity+?),updated_at=CURRENT_TIMESTAMP '+
      'WHERE warehouse_id=? AND part_id=?'
    ).bind(part.pz-part.wz,input.warehouseId,part.id));
  }
  // Insert notes in the same atomic D1 batch as PZ/WZ and stock changes.
  for(const [direction,comment] of [['PZ',input.pzComment],['WZ',input.wzComment]]){
    if(comment)statements.push(db.prepare(
      'INSERT INTO pl_warehouse_session_comments(session_id,direction,comment) VALUES(?,?,?)'
    ).bind(input.id,direction,comment));
  }
  try{
    await db.batch(statements);
    const row=await db.prepare(
      'SELECT committed_at FROM pl_warehouse_sessions WHERE id=?'
    ).bind(input.id).first();
    return workerJson({ok:true,id:input.id,alreadySaved:false,
      committedAt:row?.committed_at||null,
      pzItems:input.pz.length,wzItems:input.wz.length});
  }catch(error){
    // A lost HTTP response MUST NOT create another document on retry.
    const saved=await duplicate(db,input,actorId,hasPlate).catch(()=>null);
    if(saved)return saved;
    if(/constraint|foreign key|unique/i.test(String(error?.message||'')))
      return fail('Stan części lub uprawnienia zmieniły się. Nie zapisano sesji. '+
        'Sprawdź ponownie podsumowanie i potwierdź ilości.',409);
    console.error('PL warehouse session commit failed',error?.name||'Error');
    return fail('Nie udało się zapisać sesji. Ponów bez zmieniania danych.',503);
  }
}

export async function onRequestGet({request,env}){
  try{
    const url=new URL(request.url);
    const wh=url.searchParams.get('warehouse')||'';
    const auth=await authorized(request,env,wh);
    if(auth.error)return auth.error;
    const ready=await schemaReady(env.DB);
    const view=url.searchParams.get('view')||'status';
    if(view==='status')return workerJson({ok:true,ready,warehouse:auth.warehouse});
    if(view!=='recent')return fail('Nieprawidłowy widok.',400);
    if(!ready)return workerJson({ok:true,ready,history:[]});
    const hasPlate=await hasRegistrationColumn(env.DB);
    const hasNok=await nokTablesExist(env.DB);
    const historyLines=
      '(SELECT session_id,direction,part_id,quantity,quantity_before,quantity_after,'+
      'before_unknown,shortage_quantity,0 AS nok FROM pl_warehouse_session_lines'+
      (hasNok?' UNION ALL SELECT session_id,direction,part_id,quantity,quantity_before,'+
        'quantity_after,before_unknown,shortage_quantity,1 AS nok FROM pl_nok_session_lines':'')+
      ')';
    const rows=await env.DB.prepare(
      'SELECT s.id,s.counterparty,'+
      (hasPlate?'s.registration_plate,':'NULL AS registration_plate,')+
      's.committed_at,s.actor_id,u.name AS operator_name,'+
      "SUM(CASE WHEN l.direction='PZ' THEN 1 ELSE 0 END) AS pz_items,"+
      "SUM(CASE WHEN l.direction='WZ' THEN 1 ELSE 0 END) AS wz_items "+
      'FROM pl_warehouse_sessions s LEFT JOIN '+historyLines+' l '+
      'ON l.session_id=s.id LEFT JOIN users u ON u.id=s.actor_id '+
      'WHERE s.warehouse_id=? GROUP BY s.id ORDER BY s.committed_at DESC,s.id DESC LIMIT 15'
    ).bind(wh).all();
    const sessions=rows.results||[];
    if(!sessions.length)return workerJson({ok:true,ready,history:[]});
    const ids=sessions.map(r=>r.id);
    const parts=await env.DB.prepare(
      'SELECT l.session_id,l.direction,l.part_id,l.quantity,l.nok,'+
      'CASE WHEN l.before_unknown=1 THEN NULL ELSE l.quantity_before END AS quantity_before,'+
      'l.quantity_after,l.shortage_quantity,p.name AS part_name,p.part_number '+
      'FROM '+historyLines+' l LEFT JOIN parts p ON p.id=l.part_id '+
      'WHERE l.session_id IN ('+ids.map(()=>'?').join(',')+') '+
      "ORDER BY CASE l.direction WHEN 'PZ' THEN 0 ELSE 1 END, l.part_id,l.nok"
    ).bind(...ids).all();
    const bySession=new Map(ids.map(id=>[id,[]]));
    for(const line of (parts.results||[]))
      bySession.get(line.session_id)?.push({
        direction:line.direction,partId:line.part_id,nok:Boolean(line.nok),
        name:line.part_name||line.part_number||line.part_id,
        number:line.part_number||null,quantity:Number(line.quantity),
        before:line.quantity_before===null?null:Number(line.quantity_before),
        after:Number(line.quantity_after),shortage:Number(line.shortage_quantity||0)
      });
    return workerJson({ok:true,ready,history:sessions.map(r=>{
      const combined=/^(.*) \| REJ: ([A-Z0-9][A-Z0-9 -]{1,19})$/.exec(r.counterparty||'');
      return {
        id:r.id,counterparty:combined?combined[1]:r.counterparty,
        registrationPlate:r.registration_plate||combined?.[2]||null,
        committedAt:r.committed_at,operator:r.operator_name||r.actor_id,
        pzItems:Number(r.pz_items||0),wzItems:Number(r.wz_items||0),
        lines:bySession.get(r.id)||[]
      };
    })});
  }catch(error){
    console.error('PL session GET failed',error?.name||'Error');
    return fail('Nie można pobrać danych sesji.',503);
  }
}

export async function onRequestPost({request,env}){
  if(!workerAuthReady(env))return fail('Brak konfiguracji.',503);
  if(request.headers.get('Origin')!==new URL(request.url).origin)
    return fail('Niedozwolone pochodzenie żądania.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany JSON.',415);
  let input;
  try{
    const raw=await request.text();
    if(raw.length>16000)return fail('Zbyt duża sesja.',413);
    input=normalize(JSON.parse(raw));
  }catch(error){return fail(error?.message||'Nieprawidłowe dane.',400);}
  try{
    const auth=await authorized(request,env,input.warehouseId);
    if(auth.error)return auth.error;
    if(!await schemaReady(env.DB))
      return fail('Najpierw wykonaj migrację '+MIGRATION+'.',503);
    if([...input.pz,...input.wz].some(row=>row.nok))
      await ensureNokTables(env.DB);
    if(input.action==='preview')return await preview(env.DB,input);
    return await commit(env.DB,input,auth.user.id);
  }catch(error){
    console.error('PL session POST failed',error?.name||'Error');
    return fail('Nie można zweryfikować operacji magazynowej.',503);
  }
}
