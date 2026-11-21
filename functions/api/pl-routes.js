// GPBS Storage — PL Office route creation. Does not mutate stock or vehicle balances.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {routeEditablePredicate,canEditRoute,ROUTE_SETTLEMENT_COLUMNS} from '../../lib/pl-route-editability.js';
import {ensureRouteAuditSchema,auditEntry} from '../../lib/pl-route-audit.js';

const CAN_CREATE=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
// TEMPORARY: true during initial presentation-data entry.
// After Admin uses "Wyczyść trasy", switch this ONE value to false.
// The route schema, form and normal D1 writes remain unchanged.
const ROUTE_PRESENTATION_MODE=true;
const send=(message,status=400)=>workerJson({ok:false,error:message},status);

const DEMO_WEEK48=[
  {no:'48PL-01',date:'2026-11-23',crew:'GW',status:'AWAITING_CONFIRMATION',
    parts:[['Słupek',4],['Separator',6],['Kotwa trójkątna',8],['Dach uniwersalny',2]]},
  {no:'48PL-02',date:'2026-11-24',crew:'AB',status:'CONFIRMED',
    parts:[['Dzielenie dołem',5],['Dzielenie górą',5],['Osłona przyłącza',3],['Rynna + uszczelka',4]]},
  {no:'48PL-03',date:'2026-11-25',crew:'MK',status:'REVIEW_REQUIRED',
    parts:[['Słupek',7],['Separator',8,7],['Kotwa trójkątna',12],['Osłona przyłącza',3,2]]},
  {no:'48PL-04',date:'2026-11-26',crew:'PW',status:'CONFIRMED',
    parts:[['Dach uniwersalny',3],['Dzielenie górą',6],['Dzielenie dołem',6],
      ['Rynna + uszczelka',3],['Kotwa trójkątna',10]]},
  {no:'48PL-05',date:'2026-11-27',crew:'KT',status:'COMPLETED',
    parts:[['Słupek',4],['Dach uniwersalny',2],['Osłona przyłącza',2],['Separator',5]]},
  {no:'48PL-06',date:'2026-11-28',crew:'DL',status:'AWAITING_CONFIRMATION',
    parts:[['Rynna + uszczelka',6],['Dzielenie dołem',4],['Słupek',6],['Kotwa trójkątna',12],
      ['Separator',8]]}
];
const demoWeek48Id=i=>'PL-ROUTE-48de0000-0000-4000-8000-'+
  String(i+1).padStart(12,'0');
const demoWeek48Ids=DEMO_WEEK48.map((_,i)=>demoWeek48Id(i));

// Send a shortened display label, never a full staff surname, to the route list.
function shortCreatorName(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0)return '—';
  if(parts.length===1)return parts[0];
  const initial=Array.from(parts[parts.length-1])[0]?.toLocaleUpperCase('pl-PL')||'';
  return parts[0]+' '+initial+'.';
}

async function authorize(request,env,write=false){
  if(!workerAuthReady(env)||!env.DB)return {response:send('Panel biurowy nie jest skonfigurowany.',503)};
  let user;
  try{
    user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  }catch(e){
    return {response:send('Nie można potwierdzić sesji.',503)};
  }
  if(!user)return {response:send('Zaloguj się ponownie.',401)};
  if(!user.apps?.office||!user.markets?.PL)
    return {response:send('Brak dostępu do tras w Polsce.',403)};
  if(write&&!CAN_CREATE.has(user.role))
    return {response:send('Brak uprawnień do tworzenia i edytowania tras.',403)};
  return {user};
}
async function exists(db,name){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(name).first();
  return Boolean(row);
}
async function ensureSchema(db){
  // Created on the first authorized save. Reading an empty module never writes D1.
  // crew_number stays as a legacy NOT NULL column for existing D1 schemas.
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_routes ('+
        'id TEXT PRIMARY KEY, route_number TEXT NOT NULL, route_date TEXT NOT NULL,'+
        'crew_number TEXT NOT NULL, crew_symbol TEXT NOT NULL, status TEXT NOT NULL,'+
        'is_presentation INTEGER NOT NULL DEFAULT 0 CHECK(is_presentation IN (0,1)),'+
        'created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
        'UNIQUE(route_number,route_date))'
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_route_lines ('+
        'route_id TEXT NOT NULL, position INTEGER NOT NULL,'+
        'part_code TEXT NOT NULL DEFAULT \'\', part_name TEXT NOT NULL DEFAULT \'\','+
        'quantity INTEGER NOT NULL CHECK(quantity>0),'+
        'confirmed_quantity INTEGER CHECK(confirmed_quantity>=0),'+
        'returned_quantity INTEGER CHECK(returned_quantity>=0),'+
        'return_location TEXT,'+
        'PRIMARY KEY(route_id,position),'+
        'FOREIGN KEY(route_id) REFERENCES pl_routes(id) ON DELETE CASCADE)'
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pl_routes_date ON pl_routes(route_date DESC,created_at DESC)')
  ]);
  // Existing route tables are upgraded in place; existing rows remain REAL (0).
  // A label/star in the UI is never used to decide which records to delete.
  if(!await hasPresentationFlag(db)){
    try{
      await db.prepare(
        'ALTER TABLE pl_routes ADD COLUMN is_presentation INTEGER NOT NULL DEFAULT 0 CHECK(is_presentation IN (0,1))'
      ).run();
    }catch(error){
      if(!await hasPresentationFlag(db))throw error;
    }
  }
  // Route settlement values live on the original route lines; completed routes
  // will be archived by status rather than duplicated to another table.
  for(const [column,definition] of [
    ['confirmed_quantity','INTEGER CHECK(confirmed_quantity>=0)'],
    ['returned_quantity','INTEGER CHECK(returned_quantity>=0)'],
    ['return_location','TEXT']
  ]){
    if((await routeLineColumns(db)).has(column))continue;
    try{
      await db.prepare('ALTER TABLE pl_route_lines ADD COLUMN '+column+' '+definition).run();
    }catch(error){
      if(!(await routeLineColumns(db)).has(column))throw error;
    }
  }
}
async function routeLineColumns(db){
  if(!await exists(db,'pl_route_lines'))return new Set();
  const schema=await db.prepare('PRAGMA table_info(pl_route_lines)').all();
  return new Set((schema.results||[]).map(col=>col.name));
}
async function hasPresentationFlag(db){
  if(!await exists(db,'pl_routes'))return false;
  const result=await db.prepare('PRAGMA table_info(pl_routes)').all();
  return (result.results||[]).some(col=>col.name==='is_presentation');
}
async function verifyCleanupPin(db,env,userId,pin){
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
  const credentials=await db.prepare(
    'SELECT c.pin_digest,u.role_code,u.active FROM user_pin_credentials c '+
    'JOIN users u ON u.id=c.user_id WHERE c.user_id=?'
  ).bind(userId).first();
  if(!credentials||credentials.role_code!=='ADMIN'||Number(credentials.active)!==1||
     !/^[0-9a-f]{64}$/i.test(String(credentials.pin_digest||'')))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PIN_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('GPBS:D1:PIN:v1:'+pin));
  const digest=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join('');
  const stored=String(credentials.pin_digest).toLowerCase();
  let difference=0;
  for(let i=0;i<64;i++)difference|=digest.charCodeAt(i)^stored.charCodeAt(i);
  return difference===0;
}
const validDate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
};
const polandToday=()=>{
  // Business rollover: the start of Sunday (00:00 Europe/Warsaw).
  // No scheduled job is needed; active/history lists are classified on read.
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const values=Object.fromEntries(parts.filter(p=>
    ['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
  return values.year+'-'+values.month+'-'+values.day;
};
const routeWeekRollover=routeDate=>{
  if(!validDate(String(routeDate||'')))return '9999-12-31';
  const day=new Date(routeDate+'T00:00:00Z');
  day.setUTCDate(day.getUTCDate()+(7-day.getUTCDay())%7);
  return day.toISOString().slice(0,10);
};
const needsReview=route=>
  route.status!=='REVIEW_EXPLAINED'&&Number(route.discrepancyCount)>0||
  Number(route.unconfirmedCount)>0&&route.status==='COMPLETED'||
  ['REVIEW_REQUIRED','DISCREPANCY'].includes(route.status);
const activePriority=route=>{
  if(needsReview(route))return 0;
  if(route.status==='COMPLETED')return 2;
  return 1;
};
function parseRoute(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const routeNumber=String(body.routeNumber||'').trim().toUpperCase();
  const routeDate=String(body.routeDate||'').trim();
  const crewSymbol=String(body.crewSymbol||'').trim().toUpperCase();
  if(!routeNumber||routeNumber.length>80||!validDate(routeDate)||
      !crewSymbol||crewSymbol.length>20)return null;
  if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>150)return null;
  const lines=[];
  for(const item of body.lines){
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const partCode=String(item.partCode||'').trim();
    const partName=String(item.partName||'').trim();
    const quantity=Number(item.quantity);
    if((!partCode&&!partName)||partCode.length>100||partName.length>180||
       !Number.isSafeInteger(quantity)||quantity<1||quantity>999999)return null;
    lines.push({partCode,partName,quantity});
  }
  return {routeNumber,routeDate,crewSymbol,lines,
    isPresentation:ROUTE_PRESENTATION_MODE};
}
export async function onRequestGet({request,env}){
  const auth=await authorize(request,env);
  if(auth.response)return auth.response;
  const url=new URL(request.url);
  try{
    if(!await exists(env.DB,'pl_routes'))
      return workerJson({ok:true,routes:[],storageReady:false,presentationMode:ROUTE_PRESENTATION_MODE,demoWeek48Count:0});
    const presentationColumn=await hasPresentationFlag(env.DB);
    const flag= presentationColumn?'is_presentation AS isPresentation':'0 AS isPresentation';
    const id=url.searchParams.get('id');
    if(id!==null){
      if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return send('Nieprawidłowa trasa.',400);
      const routeColumns=(await env.DB.prepare('PRAGMA table_info(pl_routes)').all()).results||[];
      const revisionColumn=routeColumns.some(col=>col.name==='edit_revision')
        ?'edit_revision AS editRevision,':'0 AS editRevision,';
      const route=await env.DB.prepare(
        'SELECT id,route_number AS routeNumber,route_date AS routeDate,'+
        'crew_symbol AS crewSymbol,status,created_at AS createdAt,'+revisionColumn+flag+' '+
        'FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      const columns=await routeLineColumns(env.DB);
      const optional=[
        columns.has('confirmed_quantity')
          ?'confirmed_quantity AS confirmedQuantity':'NULL AS confirmedQuantity',
        columns.has('returned_quantity')
          ?'returned_quantity AS returnedQuantity':'NULL AS returnedQuantity',
        columns.has('return_location')
          ?'return_location AS returnLocation':'NULL AS returnLocation'
      ].join(',');
      const lines=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
        optional+' FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      // Metadata only. The JPEG bytes are read from a separate authenticated R2 endpoint.
      const documents=await exists(env.DB,'pl_route_documents')
        ?(await env.DB.prepare(
          'SELECT id,mime_type AS mimeType,size_bytes AS sizeBytes,'+
          'uploaded_at AS uploadedAt FROM pl_route_documents '+
          'WHERE route_id=? ORDER BY uploaded_at DESC,id DESC LIMIT 10'
        ).bind(id).all()).results||[]
        :[];
      const audit=await exists(env.DB,'pl_route_audit')
        ?(await env.DB.prepare(
          'SELECT a.id,a.action,a.actor_id AS actorId,a.details_json AS detailsJson,'+
          'a.created_at AS createdAt,'+
          "COALESCE((SELECT u.name FROM users u WHERE u.id=a.actor_id LIMIT 1),'') AS actorName "+
          'FROM pl_route_audit a WHERE a.route_id=? '+
          'ORDER BY a.created_at DESC,a.id DESC LIMIT 30'
        ).bind(id).all()).results||[]
        :[];
      const history=audit.map(({actorName,...item})=>({
        ...item,actor:shortCreatorName(actorName)
      }));
      route.canEdit=canEditRoute(route.status,lines);
      return workerJson({ok:true,route,lines,documents,audit:history,storageReady:true});
    }
    const scope=url.searchParams.get('scope')||'active';
    if(scope!=='active'&&scope!=='history')return send('Nieprawidłowy widok tras.',400);
    const today=polandToday();
    const columns=await routeLineColumns(env.DB);
    const hasConfirmations=columns.has('confirmed_quantity');
    const blockedExpression=ROUTE_SETTLEMENT_COLUMNS.filter(col=>columns.has(col))
      .map(col=>'l.'+col+' IS NOT NULL').join(' OR ');
    const editableSql='CASE WHEN r.status=\'AWAITING_CONFIRMATION\' '+
      (blockedExpression
        ?'AND COALESCE(SUM(CASE WHEN '+blockedExpression+
          ' THEN 1 ELSE 0 END),0)=0 '
        :'')+
      'THEN 1 ELSE 0 END AS canEdit,';
    const mismatch=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.confirmed_quantity IS NOT NULL '+
       'AND l.confirmed_quantity<>l.quantity THEN 1 ELSE 0 END),0)'
      :'0';
    const unconfirmed=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.position IS NOT NULL '+
       'AND l.confirmed_quantity IS NULL THEN 1 ELSE 0 END),0)'
      :'COUNT(l.position)';
    // Archive only after Saturday -> Sunday midnight (Poland time), and only
    // explicitly COMPLETED routes with no unresolved quantities.
    // Open/exception routes remain current and are never archived by age alone.
    const eligible="r.status='COMPLETED' AND date(r.route_date,'weekday 0')<=? "+
      'AND '+mismatch+'=0 AND '+unconfirmed+'=0';
    const listSql=
      'SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,'+
      'r.crew_symbol AS crewSymbol,r.status,'+
      (presentationColumn?'r.is_presentation AS isPresentation,':'0 AS isPresentation,')+
      'COUNT(l.position) AS positions,COALESCE(SUM(l.quantity),0) AS units,'+
      editableSql+
      mismatch+' AS discrepancyCount,'+unconfirmed+' AS unconfirmedCount,'+
      "COALESCE((SELECT u.name FROM users u WHERE u.id=r.created_by LIMIT 1),'') AS creatorFullName "+
      'FROM pl_routes r LEFT JOIN pl_route_lines l ON l.route_id=r.id '+
      'GROUP BY r.id HAVING '+(scope==='history'?'':'NOT ')+
      '('+eligible+') '+
      'ORDER BY r.route_date DESC,r.created_at DESC,r.id DESC LIMIT 200';
    const routeRows=(await env.DB.prepare(listSql).bind(today).all()).results||[];
    // Strip the full name before returning data to the browser.
    const routes=routeRows.map(({creatorFullName,...route})=>({
      ...route,enteredBy:shortCreatorName(creatorFullName)
    }));
    if(scope==='active'){
      // Group by calendar week first (Sunday of the ISO Monday-Sunday week).
      // Inside each week: discrepancies at top, completed routes at bottom.
      // Do not push a completed route below routes from older weeks.
      routes.sort((a,b)=>
        routeWeekRollover(b.routeDate).localeCompare(routeWeekRollover(a.routeDate))||
        activePriority(a)-activePriority(b)||
        String(b.routeDate).localeCompare(String(a.routeDate))||
        String(b.id).localeCompare(String(a.id)));
    }
    const demoWeek48Count=auth.user.role==='ADMIN'&&presentationColumn
      ?Number((await env.DB.prepare(
        'SELECT COUNT(*) AS total FROM pl_routes WHERE is_presentation=1 AND id IN ('+
        demoWeek48Ids.map(()=>'?').join(',')+')'
      ).bind(...demoWeek48Ids).first())?.total||0)
      :0;
    return workerJson({ok:true,routes,storageReady:true,
      presentationMode:ROUTE_PRESENTATION_MODE,demoWeek48Count});
  }catch(e){
    console.error('PL routes list failed',e?.name||'Error');
    return send('Nie udało się odczytać tras z D1.',503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return send('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return send('Wymagany format JSON.',415);
  const auth=await authorize(request,env,true);
  if(auth.response)return auth.response;
  let raw;
  try{raw=await request.text();}
  catch{return send('Nie udało się odczytać formularza.',400);}
  if(raw.length>40000)return send('Zbyt duży formularz trasy.',413);
  let body;
  try{body=JSON.parse(raw);}catch{return send('Nieprawidłowy JSON.',400);}
  if(body?.action==='seedDemoWeek48'){
    // One deliberate, ADMIN-authenticated POST; never seed on GET or page load.
    if(!ROUTE_PRESENTATION_MODE||auth.user.role!=='ADMIN')
      return send('Tylko administrator może dodawać trasy pokazowe.',403);
    if(body.confirm!=='DODAJ DEMO 48')
      return send('Potwierdź dodanie tras prezentacyjnych.',400);
    try{
      const columns=await routeLineColumns(env.DB);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB)||
         !['confirmed_quantity','returned_quantity','return_location'].every(c=>columns.has(c)))
        await ensureSchema(env.DB);
      const placeholders=demoWeek48Ids.map(()=>'?').join(',');
      const existing=(await env.DB.prepare(
        'SELECT id,is_presentation FROM pl_routes WHERE id IN ('+placeholders+')'
      ).bind(...demoWeek48Ids).all()).results||[];
      if(existing.some(row=>Number(row.is_presentation)!==1))
        return send('Identyfikator demo jest zajęty przez zwykłą trasę. Niczego nie zmieniono.',409);
      const present=new Set(existing.map(row=>row.id));
      const statements=[];
      let added=0;
      for(let i=0;i<DEMO_WEEK48.length;i++){
        const item=DEMO_WEEK48[i],id=demoWeek48Id(i);
        if(present.has(id))continue; // repeat click never duplicates or rewrites a demo
        const occupied=await env.DB.prepare(
          'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
        ).bind(item.no,item.date).first();
        if(occupied)return send('Numer '+item.no+' w tej dacie jest już zajęty. Niczego nie dodano.',409);
        statements.push(env.DB.prepare(
          'INSERT INTO pl_routes '+
          '(id,route_number,route_date,crew_number,crew_symbol,status,created_by,is_presentation) '+
          'VALUES (?,?,?,?,?,?,?,1)'
        ).bind(id,item.no,item.date,'',item.crew,item.status,auth.user.id));
        item.parts.forEach(([name,quantity,confirmedOverride],position)=>{
          const confirmed=item.status==='AWAITING_CONFIRMATION'
            ?null:confirmedOverride===undefined?quantity:confirmedOverride;
          const returned=item.status==='COMPLETED'?0:null;
          statements.push(env.DB.prepare(
            'INSERT INTO pl_route_lines '+
            '(route_id,position,part_code,part_name,quantity,confirmed_quantity,returned_quantity) '+
            'VALUES (?,?,?,?,?,?,?)'
          ).bind(id,position+1,'',name,quantity,confirmed,returned));
        });
        added++;
      }
      if(statements.length)await env.DB.batch(statements);
      return workerJson({ok:true,added,alreadyPresent:DEMO_WEEK48.length-added,
        demoWeek:48,year:2026});
    }catch(error){
      console.error('PL week48 demo seed failed',error?.name||'Error');
      if(/UNIQUE constraint failed/i.test(String(error?.message||'')))
        return send('Jedna z przykładowych tras już istnieje. Nie nadpisano żadnych danych.',409);
      return send('Nie udało się wstawić tras demo do D1.',503);
    }
  }
  if(body?.action==='deleteDemoWeek48'){
    if(auth.user.role!=='ADMIN')return send('Tylko administrator może usuwać demo 48.',403);
    if(body.confirm!=='USUŃ DEMO 48')return send('Brak potwierdzenia usunięcia.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB))
        return workerJson({ok:true,deleted:0});
      const ids=demoWeek48Ids;
      const placeholders=ids.map(()=>'?').join(',');
      const existing=(await env.DB.prepare(
        'SELECT id,is_presentation FROM pl_routes WHERE id IN ('+placeholders+')'
      ).bind(...ids).all()).results||[];
      if(existing.some(row=>Number(row.is_presentation)!==1))
        return send('Jedna z tras ma już status rzeczywistej. Usuwanie przerwano.',409);
      const remove=existing.map(row=>row.id);
      if(!remove.length)return workerJson({ok:true,deleted:0});
      const marks=remove.map(()=>'?').join(',');
      const hasDocuments=await exists(env.DB,'pl_route_documents');
      const docs=hasDocuments?(await env.DB.prepare(
        'SELECT object_key,size_bytes FROM pl_route_documents WHERE route_id IN ('+marks+')'
      ).bind(...remove).all()).results||[]:[];
      if(docs.length){
        if(!env.PART_PHOTOS||typeof env.PART_PHOTOS.delete!=='function')
          return send('Nie można usunąć demo ze zdjęciami: R2 jest niedostępne.',503);
        for(let i=0;i<docs.length;i+=1000)
          await env.PART_PHOTOS.delete(docs.slice(i,i+1000).map(doc=>doc.object_key));
      }
      const statements=[];
      if(docs.length&&await exists(env.DB,'pl_r2_photo_quota')){
        const bytes=docs.reduce((acc,doc)=>acc+Number(doc.size_bytes||0),0);
        statements.push(env.DB.prepare(
          'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) WHERE id=1'
        ).bind(bytes));
      }
      if(hasDocuments)statements.push(env.DB.prepare(
        'DELETE FROM pl_route_documents WHERE route_id IN ('+marks+')'
      ).bind(...remove));
      if(await exists(env.DB,'pl_route_audit'))statements.push(env.DB.prepare(
        'DELETE FROM pl_route_audit WHERE route_id IN ('+marks+')'
      ).bind(...remove));
      statements.push(env.DB.prepare(
        'DELETE FROM pl_route_lines WHERE route_id IN ('+marks+')'
      ).bind(...remove));
      statements.push(env.DB.prepare(
        'DELETE FROM pl_routes WHERE id IN ('+marks+') AND is_presentation=1'
      ).bind(...remove));
      const result=await env.DB.batch(statements);
      return workerJson({ok:true,deleted:Number(result[result.length-1]?.meta?.changes||0)});
    }catch(error){
      console.error('PL week48 demo cleanup failed',error?.name||'Error');
      return send('Nie udało się usunąć sześciu tras demo.',503);
    }
  }
  if(body?.action==='deletePresentation'){
    if(!ROUTE_PRESENTATION_MODE)return send('Tryb wprowadzania tras prezentacyjnych jest wyłączony.',403);
    // Cleanup is deliberately separate from ordinary route creation.
    // Never run it for a non-Admin session or without a fresh D1 PIN check.
    if(auth.user.role!=='ADMIN')return send('Tylko administrator może usuwać trasy prezentacyjne.',403);
    if(body.confirm!=='USUŃ TRASY')return send('Potwierdzenie usuwania jest nieprawidłowe.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB))
        return workerJson({ok:true,deleted:0});
      // Demo cleanup also removes its linked R2 photos, not just D1 metadata.
      // Delete remote files first so a database failure never leaves charged
      // R2 orphans. Any failed R2 deletion aborts the D1 cleanup.
      const hasDocuments=await exists(env.DB,'pl_route_documents');
      const documents=hasDocuments
        ?(await env.DB.prepare(
          'SELECT d.object_key,d.size_bytes FROM pl_route_documents d '+
          'JOIN pl_routes r ON r.id=d.route_id WHERE r.is_presentation=1'
        ).all()).results||[]
        :[];
      if(documents.length){
        if(!env.PART_PHOTOS||typeof env.PART_PHOTOS.delete!=='function')
          return send('Nie można wyczyścić tras ze zdjęciami: R2 jest niedostępne.',503);
        for(let i=0;i<documents.length;i+=1000){
          await env.PART_PHOTOS.delete(documents.slice(i,i+1000).map(d=>d.object_key));
        }
      }
      const statements=[];
      if(documents.length&&await exists(env.DB,'pl_r2_photo_quota')){
        const bytes=documents.reduce((sum,d)=>sum+Number(d.size_bytes||0),0);
        statements.push(env.DB.prepare(
          'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) WHERE id=1'
        ).bind(bytes));
      }
      if(hasDocuments)statements.push(env.DB.prepare(
        'DELETE FROM pl_route_documents WHERE route_id IN ('+
        'SELECT id FROM pl_routes WHERE is_presentation=1)'
      ));
      if(await exists(env.DB,'pl_route_audit'))statements.push(env.DB.prepare(
        'DELETE FROM pl_route_audit WHERE route_id IN ('+
        'SELECT id FROM pl_routes WHERE is_presentation=1)'
      ));
      statements.push(env.DB.prepare(
        'DELETE FROM pl_route_lines WHERE route_id IN ('+
        'SELECT id FROM pl_routes WHERE is_presentation=1)'
      ));
      statements.push(env.DB.prepare('DELETE FROM pl_routes WHERE is_presentation=1'));
      const results=await env.DB.batch(statements);
      return workerJson({ok:true,deleted:Number(results[results.length-1]?.meta?.changes||0)});
    }catch(error){
      console.error('PL route presentation cleanup failed',error?.name||'Error');
      return send('Nie udało się wyczyścić tras prezentacyjnych.',503);
    }
  }
  if(body?.action==='update'){
    const id=String(body.id||'');
    const revision=Number(body.baseRevision);
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id)||
       !Number.isSafeInteger(revision)||revision<0)
      return send('Nieprawidłowy identyfikator lub wersja trasy.',400);
    const updated=parseRoute(body);
    if(!updated)return send('Uzupełnij numer, datę, symbol ekipy i prawidłowe części.',400);
    try{
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
        return send('Nie znaleziono trasy.',404);
      await ensureRouteAuditSchema(env.DB);
      const current=await env.DB.prepare(
        'SELECT id,status,route_number AS routeNumber,route_date AS routeDate,'+
        'crew_symbol AS crewSymbol,edit_revision AS revision FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!current)return send('Nie znaleziono trasy.',404);
      if(current.status!=='AWAITING_CONFIRMATION')
        return send('Trasa została już potwierdzona lub zakończona. Edycja jest zablokowana.',409);
      if(Number(current.revision)!==revision)
        return send('Trasa została zmieniona w innym oknie. Otwórz edycję ponownie.',409);
      const before=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,quantity '+
        'FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      const predicate=await routeEditablePredicate(env.DB,'pl_routes');
      const guard='EXISTS (SELECT 1 FROM pl_routes WHERE id=? AND edit_revision=? AND '+predicate+')';
      const statements=[
        env.DB.prepare(
          'UPDATE pl_routes SET route_number=?,route_date=?,crew_symbol=?,'+
          'edit_revision=edit_revision+1 '+
          'WHERE id=? AND edit_revision=? AND '+predicate
        ).bind(updated.routeNumber,updated.routeDate,updated.crewSymbol,id,revision),
        env.DB.prepare(
          'DELETE FROM pl_route_lines WHERE route_id=? AND '+guard
        ).bind(id,id,revision+1)
      ];
      updated.lines.forEach((line,index)=>{
        statements.push(env.DB.prepare(
          'INSERT INTO pl_route_lines (route_id,position,part_code,part_name,quantity) '+
          'SELECT ?,?,?,?,? WHERE '+guard
        ).bind(id,index+1,line.partCode,line.partName,line.quantity,id,revision+1));
      });
      statements.push(auditEntry(env.DB,{
        id:crypto.randomUUID(),routeId:id,action:'EDIT',
        actorId:auth.user.id,revision:revision+1,
        details:{
          before:{routeNumber:current.routeNumber,routeDate:current.routeDate,
            crewSymbol:current.crewSymbol,lines:before},
          after:{routeNumber:updated.routeNumber,routeDate:updated.routeDate,
            crewSymbol:updated.crewSymbol,lines:updated.lines}
        }
      }));
      const result=await env.DB.batch(statements);
      if(Number(result[0]?.meta?.changes||0)!==1)
        return send('Trasa została w międzyczasie zmieniona albo potwierdzona. Zmiany nie zostały zapisane.',409);
      return workerJson({ok:true,id,updated:true});
    }catch(error){
      console.error('PL route update failed',error?.name||'Error');
      if(/UNIQUE constraint failed/i.test(String(error?.message||'')))
        return send('Trasa z tym numerem i datą już istnieje.',409);
      return send('Nie udało się edytować trasy. Spróbuj ponownie.',503);
    }
  }
  if(body?.action==='explainDiscrepancy'){
    const id=String(body.id||'');
    const comment=String(body.comment||'').trim();
    const revision=Number(body.baseRevision);
    const corrections=body.corrections;
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id)||
       !Number.isSafeInteger(revision)||revision<0||
       comment.length<15||comment.length>2000||!Array.isArray(corrections)||corrections.length>150)
      return send('Podaj prawidłową trasę, korekty i komentarz (minimum 15 znaków).',400);
    if(corrections.some(x=>!x||!Number.isSafeInteger(x.position)||
       x.position<1||!Number.isSafeInteger(x.quantity)||x.quantity<1||
       x.quantity>999999)||new Set(corrections.map(x=>x.position)).size!==corrections.length)
      return send('Nieprawidłowe ilości w korekcie.',400);
    try{
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
        return send('Nie znaleziono trasy.',404);
      await ensureRouteAuditSchema(env.DB);
      const route=await env.DB.prepare(
        'SELECT id,status,edit_revision AS revision FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      if(!['REVIEW_REQUIRED','DISCREPANCY','CONFIRMED','AWAITING_CONFIRMATION'].includes(route.status))
        return send('Trasa nie wymaga już wyjaśnienia lub została zakończona.',409);
      if(Number(route.revision)!==revision)
        return send('Dane trasy zmieniły się. Otwórz wyjaśnienie ponownie.',409);
      const lines=(await env.DB.prepare(
        'SELECT position,part_name AS partName,quantity,confirmed_quantity AS confirmedQuantity '+
        'FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      const wrong=lines.filter(line=>line.confirmedQuantity!==null&&
        Number(line.quantity)!==Number(line.confirmedQuantity));
      if(!wrong.length)return send('W tej trasie nie ma już niezgodności.',409);
      const wrongPositions=new Set(wrong.map(line=>Number(line.position)));
      if(corrections.some(x=>!wrongPositions.has(x.position)))
        return send('Nie można korygować części bez niezgodności.',400);
      const correctionsByPosition=new Map(corrections.map(x=>[x.position,x.quantity]));
      const corrected=wrong.map(line=>({
        position:Number(line.position),partName:line.partName,
        before:Number(line.quantity),confirmed:Number(line.confirmedQuantity),
        after:correctionsByPosition.get(Number(line.position))??Number(line.quantity)
      }));
      const discrepanciesRemain=corrected.some(line=>line.after!==line.confirmed);
      const unconfirmed=lines.some(line=>line.confirmedQuantity===null);
      const newStatus=!discrepanciesRemain&&!unconfirmed?'CONFIRMED':'REVIEW_EXPLAINED';
      const statements=[
        env.DB.prepare(
          "UPDATE pl_routes SET status=?,edit_revision=edit_revision+1 "+
          "WHERE id=? AND edit_revision=? AND status IN ('REVIEW_REQUIRED','DISCREPANCY','CONFIRMED','AWAITING_CONFIRMATION') "+
          'AND EXISTS (SELECT 1 FROM pl_route_lines l WHERE l.route_id=pl_routes.id '+
          'AND l.confirmed_quantity IS NOT NULL AND l.confirmed_quantity<>l.quantity)'
        ).bind(newStatus,id,revision)
      ];
      for(const line of corrected){
        if(line.after===line.before)continue;
        statements.push(env.DB.prepare(
          'UPDATE pl_route_lines SET quantity=? WHERE route_id=? AND position=? '+
          'AND quantity=? AND confirmed_quantity=? '+
          'AND EXISTS (SELECT 1 FROM pl_routes r WHERE r.id=? AND r.edit_revision=? )'
        ).bind(line.after,id,line.position,line.before,line.confirmed,id,revision+1));
      }
      statements.push(auditEntry(env.DB,{
        id:crypto.randomUUID(),routeId:id,action:'EXPLAIN',
        actorId:auth.user.id,revision:revision+1,
        details:{comment,positions:corrected,statusBefore:route.status,statusAfter:newStatus}
      }));
      const result=await env.DB.batch(statements);
      if(Number(result[0]?.meta?.changes||0)!==1)
        return send('Niezgodność została w międzyczasie zmieniona. Spróbuj ponownie.',409);
      return workerJson({ok:true,id,status:newStatus});
    }catch(error){
      console.error('PL route discrepancy explanation failed',error?.name||'Error');
      return send('Nie udało się zatwierdzić wyjaśnienia.',503);
    }
  }
  if(body?.action!=='create')return send('Nieznana operacja.',400);
  const route=parseRoute(body);
  if(!route)return send('Uzupełnij numer i datę trasy, ekipę oraz prawidłową listę części.',400);
  try{
    const lineColumns=await routeLineColumns(env.DB);
    if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB)||
       !['confirmed_quantity','returned_quantity','return_location'].every(
         col=>lineColumns.has(col)
       ))await ensureSchema(env.DB);
    const duplicate=await env.DB.prepare(
      'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
    ).bind(route.routeNumber,route.routeDate).first();
    if(duplicate)return send('Trasa z tym numerem i datą jest już zapisana.',409);
    const id='PL-ROUTE-'+crypto.randomUUID();
    const steps=[
      env.DB.prepare(
        'INSERT INTO pl_routes (id,route_number,route_date,crew_number,crew_symbol,status,created_by,is_presentation) '+
        'VALUES (?,?,?,?,?,?,?,?)'
      ).bind(id,route.routeNumber,route.routeDate,'',route.crewSymbol,
        'AWAITING_CONFIRMATION',auth.user.id,route.isPresentation?1:0)
    ];
    route.lines.forEach((line,i)=>{
      steps.push(env.DB.prepare(
        'INSERT INTO pl_route_lines (route_id,position,part_code,part_name,quantity) VALUES (?,?,?,?,?)'
      ).bind(id,i+1,line.partCode,line.partName,line.quantity));
    });
    await env.DB.batch(steps); // D1 batch is atomic: no partly-created route.
    return workerJson({ok:true,id},201);
  }catch(e){
    console.error('PL route creation failed',e?.name||'Error');
    if(/UNIQUE constraint failed/i.test(String(e?.message||'')))
      return send('Trasa z tym numerem i datą jest już zapisana.',409);
    return send('Nie udało się zapisać trasy w D1.',503);
  }
}
