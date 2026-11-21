// GPBS Storage — PL Office route creation. Does not mutate stock or vehicle balances.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {routeEditablePredicate,canEditRoute,ROUTE_SETTLEMENT_COLUMNS} from '../../lib/pl-route-editability.js';
import {ensureRouteAuditSchema,auditEntry} from '../../lib/pl-route-audit.js';
import {resolveRouteParts,routePartsLineColumnExists} from '../../lib/pl-route-parts.js';

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
      ['Separator',8]]},
  {no:'48PL-07',date:'2026-11-28',crew:'RS',status:'REVIEW_REQUIRED',
    parts:[['Separator',9,7],['Dach uniwersalny',3,2],['Słupek',5],
      ['Rynna + uszczelka',4],['Kotwa trójkątna',12]]},
  {no:'48PL-08',date:'2026-11-29',crew:'TJ',status:'REVIEW_REQUIRED',sampleAudit:true,
    parts:[['Separator',8,7],['Osłona przyłącza',3,2],
      ['Słupek',4],['Kotwa trójkątna',10]]},
  {no:'48PL-09',date:'2026-11-28',crew:'VN',status:'REVIEW_REQUIRED',
    parts:[['Słupek',6,5],['Rynna + uszczelka',3,4],
      ['Dach uniwersalny',2],['Kotwa trójkątna',10]]}
];
const demoWeek48Id=i=>'PL-ROUTE-48de0000-0000-4000-8000-'+
  String(i+1).padStart(12,'0');
const demoWeek48Ids=DEMO_WEEK48.map((_,i)=>demoWeek48Id(i));
const retiredDemo48PL03=demoWeek48Id(2);
// Retired demo must not be recreated by '+ Demo 48' after its one-off cleanup.
const seedableDemoWeek48Ids=demoWeek48Ids.filter(id=>id!==retiredDemo48PL03);

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
        'verified_quantity INTEGER CHECK(verified_quantity>=0),'+
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
    ['verified_quantity','INTEGER CHECK(verified_quantity>=0)'],
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
async function ensureReturnApprovalSchema(db){
  // Independent acknowledgment per returned item. Never changes stock.
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_return_approvals ('+
      'route_id TEXT NOT NULL,position INTEGER NOT NULL,'+
      'quantity INTEGER NOT NULL CHECK(quantity>0),location TEXT NOT NULL,'+
      'approved_by TEXT NOT NULL,'+
      'approved_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),'+
      'PRIMARY KEY(route_id,position),'+
      'FOREIGN KEY(route_id,position) REFERENCES pl_route_lines(route_id,position) ON DELETE CASCADE)'
  ).run();
}
const returnApprovalMatches=(line,approval)=>
  approval!=null&&
  Number(approval.quantity)===Number(line.returnedQuantity)&&
  String(approval.location||'')===String(line.returnLocation||'').trim();
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
  // Business rollover: Monday 00:00 Europe/Warsaw (after Sunday finishes).
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
// Sort only WITHIN the same calendar week; the current week stays above older weeks.
// A confirmed route moves automatically when its updated status is fetched.
const activePriority=route=>{
  const needsReview=Number(route.pendingReturnApprovals)>0||
    Number(route.discrepancyCount)>0||
    (route.status==='COMPLETED'&&Number(route.unconfirmedCount)>0)||
    ['REVIEW_REQUIRED','DISCREPANCY'].includes(route.status);
  if(needsReview)return 1;
  if(route.status==='COMPLETED')return 4;
  if(route.status==='CONFIRMED'||route.status==='REVIEW_EXPLAINED'&&
     Number(route.unconfirmedCount)===0)
    return Number(route.hadVerification)>0?2:3;
  // Awaiting team confirmation always appears at the top of its week.
  return 0;
};
// One-off week-45 demonstration settlement. Never adjusts inventory stocks.
function demo45Settlement(number,lines){
  if(!Array.isArray(lines)||!lines.length)
    return {error:'Brakuje pozycji trasy '+number+'.'};
  const norm=value=>String(value||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').toLowerCase();
  let pole=null,anchor=null;
  if(number==='02HP'){
    const poles=lines.filter(x=>/\bslup(?:ek|k)/.test(norm(x.partName)));
    const anchors=lines.filter(x=>/\bkotw/.test(norm(x.partName)));
    if(poles.length!==1||anchors.length!==1||poles[0].position===anchors[0].position)
      return {error:'W 02HP nie można jednoznacznie wskazać słupków i kotew. Niczego nie zmieniono.'};
    pole=Number(poles[0].position);
    anchor=Number(anchors[0].position);
  }
  const updates=[];
  for(const line of lines){
    const quantity=Number(line.quantity);
    const position=Number(line.position);
    if(!Number.isSafeInteger(quantity)||quantity<1||
       !Number.isSafeInteger(position)||position<1)
      return {error:'Nieprawidłowe ilości lub pozycje w '+number+'.'};
    if(line.confirmedQuantity!=null&&Number(line.confirmedQuantity)!==quantity||
       line.verifiedQuantity!=null&&Number(line.verifiedQuantity)!==quantity)
      return {error:'W '+number+' istnieją inne potwierdzenia lub weryfikacje. Niczego nie nadpisano.'};
    let returned=0,location=null;
    if(number==='02HP'&&position===pole){returned=5;location='InPost';}
    if(number==='02HP'&&position===anchor){returned=2;location='Magazyn Tychy';}
    if(returned>quantity)return {error:'W '+number+' pozycja '+position+
      ' ma za mało sztuk na zaplanowany zwrot '+returned+'. Niczego nie zmieniono.'};
    const oldReturn=line.returnedQuantity;
    const oldPlace=String(line.returnLocation||'').trim();
    if(oldReturn!=null&&Number(oldReturn)!==returned||
       oldPlace&&oldPlace!==String(location||''))
      return {error:'W '+number+' istnieją inne rozliczenia zwrotów. Niczego nie nadpisano.'};
    updates.push({position,quantity,confirmedQuantity:quantity,
      verifiedQuantity:line.verifiedQuantity??null,
      returnedQuantity:returned,returnLocation:location,
      partCode:line.partCode||'',partName:line.partName||''});
  }
  return {updates};
}
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
    const catalogPartId=String(item.catalogPartId||'').trim();
    if(catalogPartId&&!/^PL-RPART-[a-f0-9-]{36}$/.test(catalogPartId))return null;
    lines.push({partCode,partName,quantity,catalogPartId});
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
        'crew_symbol AS crewSymbol,status,created_at AS createdAt,'+revisionColumn+flag+','+
        "COALESCE((SELECT u.name FROM users u WHERE u.id=pl_routes.created_by LIMIT 1),'') AS creatorFullName "+
        'FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      route.enteredBy=shortCreatorName(route.creatorFullName);
      delete route.creatorFullName;
      const columns=await routeLineColumns(env.DB);
      const optional=[
        columns.has('confirmed_quantity')
          ?'confirmed_quantity AS confirmedQuantity':'NULL AS confirmedQuantity',
        columns.has('returned_quantity')
          ?'returned_quantity AS returnedQuantity':'NULL AS returnedQuantity',
        columns.has('return_location')
          ?'return_location AS returnLocation':'NULL AS returnLocation',
        columns.has('verified_quantity')
          ?'verified_quantity AS verifiedQuantity':'NULL AS verifiedQuantity',
        await routePartsLineColumnExists(env.DB)
          ?'catalog_part_id AS catalogPartId':'NULL AS catalogPartId'
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
        ...item,actor:item.actorId==='DEMO'
          ?'Przykład (demo)':shortCreatorName(actorName)
      }));
      const approvedTable=await exists(env.DB,'pl_route_return_approvals');
      const returnApprovals=approvedTable?(await env.DB.prepare(
        'SELECT a.position,a.quantity,a.location,a.approved_by AS approvedById,'+
        'a.approved_at AS approvedAt,'+
        "COALESCE((SELECT u.name FROM users u WHERE u.id=a.approved_by LIMIT 1),'') AS approvedBy "+
        'FROM pl_route_return_approvals a WHERE a.route_id=? ORDER BY a.position'
      ).bind(id).all()).results||[]:[];
      const approvalsByPosition=new Map(returnApprovals.map(item=>[Number(item.position),item]));
      const positiveReturns=lines.filter(line=>Number(line.returnedQuantity)>0);
      route.returnCount=positiveReturns.length;
      route.pendingReturnApprovals=positiveReturns.filter(line=>
        !returnApprovalMatches(line,approvalsByPosition.get(Number(line.position)))).length;
      route.canApproveReturns=route.status==='COMPLETED'&&route.pendingReturnApprovals>0&&
        ['KOORDYNATOR','ADMIN'].includes(auth.user.role);
      route.canEdit=canEditRoute(route.status,lines);
      return workerJson({ok:true,route,lines,documents,audit:history,
        returnApprovals,storageReady:true});
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
    const notVerified=columns.has('verified_quantity')
      ?'l.verified_quantity IS NULL AND ':'';
    const mismatch=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.confirmed_quantity IS NOT NULL '+
       'AND '+notVerified+'l.confirmed_quantity<>l.quantity THEN 1 ELSE 0 END),0)'
      :'0';
    const unconfirmed=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.position IS NOT NULL '+
       'AND l.confirmed_quantity IS NULL THEN 1 ELSE 0 END),0)'
      :'COUNT(l.position)';
    // One-time display archive for ISO week 45/2026 at the user's request.
    // Keep original statuses and recorded quantities: no fake "COMPLETED"
    // confirmations and no D1 mutations. All other weeks keep the existing
    // rule: archived only when completed, reconciled, and after week end.
    const approvalTable=await exists(env.DB,'pl_route_return_approvals');
    const pendingReturns=columns.has('returned_quantity')
      ?'COALESCE(SUM(CASE WHEN l.returned_quantity>0 AND '+
        (approvalTable
          ?'NOT EXISTS (SELECT 1 FROM pl_route_return_approvals ap '+
            'WHERE ap.route_id=l.route_id AND ap.position=l.position '+
            'AND ap.quantity=l.returned_quantity '+
            "AND ap.location=trim(COALESCE(l.return_location,'')))"
          :'1=1')+
        ' THEN 1 ELSE 0 END),0)'
      :'0';
    // Even the special week-45 display archive must wait for return approval.
    const eligible="(r.route_date>='2026-11-02' AND r.route_date<='2026-11-08' AND "+
      pendingReturns+"=0) OR ("+
      "r.status='COMPLETED' AND date(r.route_date,'weekday 0')<? "+
      'AND '+mismatch+'=0 AND '+unconfirmed+'=0 AND '+pendingReturns+'=0)';
    const hasAudit=await exists(env.DB,'pl_route_audit');
    const everDifferent=hasConfirmations
      ?'COALESCE(SUM(CASE WHEN l.confirmed_quantity IS NOT NULL '+
        'AND l.confirmed_quantity<>l.quantity THEN 1 ELSE 0 END),0)'
      :'0';
    const auditExplained=hasAudit
      ?"EXISTS (SELECT 1 FROM pl_route_audit a WHERE a.route_id=r.id AND a.action='EXPLAIN')"
      :'0';
    const individuallyVerified=columns.has('verified_quantity')
      ?'COALESCE(SUM(CASE WHEN l.verified_quantity IS NOT NULL THEN 1 ELSE 0 END),0)>0'
      :'0';
    const listSql=
      'SELECT r.id,r.route_number AS routeNumber,r.route_date AS routeDate,'+
      'r.crew_symbol AS crewSymbol,r.status,'+
      (presentationColumn?'r.is_presentation AS isPresentation,':'0 AS isPresentation,')+
      'COUNT(l.position) AS positions,COALESCE(SUM(l.quantity),0) AS units,'+
      editableSql+
      mismatch+' AS discrepancyCount,'+unconfirmed+' AS unconfirmedCount,'+
      pendingReturns+' AS pendingReturnApprovals,'+
      'CASE WHEN '+everDifferent+'>0 OR '+auditExplained+
        ' THEN 1 ELSE 0 END AS hadDiscrepancy,'+
      'CASE WHEN '+individuallyVerified+' OR '+auditExplained+
        ' THEN 1 ELSE 0 END AS hadVerification,'+
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
      // Newest calendar week first; within each week:
      // Awaiting -> Needs review -> Confirmed/verified -> Confirmed -> Completed.
      // Moving a route to another status group never moves it across weeks.
      routes.sort((a,b)=>
        routeWeekRollover(b.routeDate).localeCompare(routeWeekRollover(a.routeDate))||
        activePriority(a)-activePriority(b)||
        String(b.routeDate).localeCompare(String(a.routeDate))||
        String(b.id).localeCompare(String(a.id)));
    }
    const demoWeek48Count=auth.user.role==='ADMIN'&&presentationColumn
      ?Number((await env.DB.prepare(
        'SELECT COUNT(*) AS total FROM pl_routes WHERE is_presentation=1 AND id IN ('+
        seedableDemoWeek48Ids.map(()=>'?').join(',')+')'
      ).bind(...seedableDemoWeek48Ids).first())?.total||0)
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
  if(body?.action==='approveReturns'){
    if(!['KOORDYNATOR','ADMIN'].includes(auth.user.role))
      return send('Zwroty może zatwierdzić tylko koordynator lub administrator.',403);
    const id=String(body.id||'');
    const revision=Number(body.baseRevision);
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id)||
       !Number.isSafeInteger(revision)||revision<0)
      return send('Nieprawidłowa trasa lub wersja danych.',400);
    try{
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
        return send('Trasa nie istnieje.',404);
      const columns=await routeLineColumns(env.DB);
      if(!['confirmed_quantity','returned_quantity','return_location','verified_quantity']
        .every(col=>columns.has(col)))
        return send('Brakuje danych rozliczenia.',409);
      await ensureRouteAuditSchema(env.DB);
      await ensureReturnApprovalSchema(env.DB);
      const route=await env.DB.prepare(
        'SELECT id,status,edit_revision AS revision FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Trasa nie istnieje.',404);
      if(route.status!=='COMPLETED')
        return send('Zatwierdzenie zwrotów jest możliwe dopiero po zakończeniu trasy.',409);
      if(Number(route.revision)!==revision)
        return send('Dane trasy zostały zmienione. Odśwież szczegóły.',409);
      const lines=(await env.DB.prepare(
        'SELECT position,quantity,confirmed_quantity AS confirmedQuantity,'+
        'verified_quantity AS verifiedQuantity,returned_quantity AS returnedQuantity,'+
        'return_location AS returnLocation FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      if(!lines.length)return send('W trasie nie ma części do rozliczenia.',409);
      const positive=lines.filter(line=>Number(line.returnedQuantity)>0);
      if(!positive.length)return send('W tej trasie nie zgłoszono zwrotów.',409);
      for(const line of lines){
        const actual=line.verifiedQuantity??line.confirmedQuantity;
        const returned=line.returnedQuantity;
        if(actual==null||returned==null||
           line.verifiedQuantity==null&&
             Number(line.confirmedQuantity)!==Number(line.quantity)||
           !Number.isSafeInteger(Number(actual))||
           !Number.isSafeInteger(Number(returned))||
           Number(returned)<0||Number(returned)>Number(actual)||
           Number(returned)>0&&!String(line.returnLocation||'').trim())
          return send('Trasa zawiera niezweryfikowaną ilość, zwrot lub brak miejsca zwrotu.',409);
      }
      const approvals=(await env.DB.prepare(
        'SELECT position,quantity,location FROM pl_route_return_approvals WHERE route_id=?'
      ).bind(id).all()).results||[];
      const byPosition=new Map(approvals.map(item=>[Number(item.position),item]));
      const pending=positive.filter(line=>
        !returnApprovalMatches(line,byPosition.get(Number(line.position))));
      if(!pending.length)return workerJson({ok:true,approved:0,alreadyApproved:true});
      const token=crypto.randomUUID();
      const statements=[env.DB.prepare(
        "UPDATE pl_routes SET edit_revision=edit_revision+1,edit_token=? "+
        "WHERE id=? AND status='COMPLETED' AND edit_revision=?"
      ).bind(token,id,revision)];
      for(const line of pending){
        statements.push(env.DB.prepare(
          'INSERT OR REPLACE INTO pl_route_return_approvals '+
          '(route_id,position,quantity,location,approved_by) '+
          'SELECT l.route_id,l.position,l.returned_quantity,trim(l.return_location),? '+
          'FROM pl_route_lines l JOIN pl_routes r ON r.id=l.route_id '+
          'WHERE l.route_id=? AND l.position=? AND l.returned_quantity=? '+
          "AND trim(COALESCE(l.return_location,''))=? "+
          'AND r.edit_revision=? AND r.edit_token=?'
        ).bind(auth.user.id,id,line.position,line.returnedQuantity,
          String(line.returnLocation).trim(),revision+1,token));
      }
      const result=await env.DB.batch(statements);
      if(result.some(step=>Number(step?.meta?.changes||0)!==1))
        return send('Trasa została zmieniona. Otwórz ponownie szczegóły.',409);
      return workerJson({ok:true,approved:pending.length});
    }catch(error){
      console.error('PL route return approval failed',error?.name||'Error');
      return send('Nie udało się zatwierdzić zwrotów.',503);
    }
  }
  if(body?.action==='prepareDemoWeek47'){
    // Explicit demo-only preparation for the week-end rollover test.
    // Exactly two routes are settled as COMPLETED; one is just CONFIRMED.
    // Neither route dates nor warehouse/car stocks are touched.
    if(auth.user.role!=='ADMIN')
      return send('Tylko administrator może przygotować trasy pokazowe.',403);
    if(body.confirm!=='PRZYGOTUJ DEMO 47')
      return send('Potwierdź przygotowanie tygodnia 47.',400);
    const completeIds=body.completeIds,confirmedId=body.confirmedId;
    const validId=id=>typeof id==='string'&&/^PL-ROUTE-[a-f0-9-]{36}$/.test(id);
    if(!Array.isArray(completeIds)||completeIds.length!==2||
       !completeIds.every(validId)||!validId(confirmedId)||
       new Set([...completeIds,confirmedId]).size!==3)
      return send('Podaj dokładnie dwie trasy do zakończenia i trzecią do potwierdzenia.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines')||
         !await hasPresentationFlag(env.DB))
        return send('Nie znaleziono tras pokazowych.',404);
      const columns=await routeLineColumns(env.DB);
      if(!['confirmed_quantity','verified_quantity','returned_quantity','return_location'].every(c=>columns.has(c)))
        return send('Baza nie obsługuje jeszcze rozliczenia trasy.',409);
      await ensureRouteAuditSchema(env.DB);
      const routes=(await env.DB.prepare(
        'SELECT id,route_number AS routeNumber,route_date AS routeDate,'+
        'crew_symbol AS crewSymbol,status,edit_revision AS revision '+
        'FROM pl_routes WHERE is_presentation=1 AND '+
        "route_date BETWEEN '2026-11-16' AND '2026-11-22' "+
        'ORDER BY route_number,id'
      ).all()).results||[];
      const requestedIds=new Set([...completeIds,confirmedId]);
      if(routes.length!==3||routes.some(route=>!requestedIds.has(route.id)))
        return send('Tydzień 47 musi zawierać dokładnie te trzy trasy pokazowe. Niczego nie zmieniono.',409);
      const staged=[];
      for(const route of routes){
        const targetStatus=route.id===confirmedId?'CONFIRMED':'COMPLETED';
        if(!['AWAITING_CONFIRMATION','CONFIRMED','COMPLETED'].includes(route.status))
          return send('Trasa '+route.routeNumber+' wymaga wcześniejszego wyjaśnienia. Niczego nie zmieniono.',409);
        const lines=(await env.DB.prepare(
          'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
          'confirmed_quantity AS confirmedQuantity,verified_quantity AS verifiedQuantity,'+
          'returned_quantity AS returnedQuantity,return_location AS returnLocation '+
          'FROM pl_route_lines WHERE route_id=? ORDER BY position'
        ).bind(route.id).all()).results||[];
        if(!lines.length||lines.length>150)
          return send('Trasa '+route.routeNumber+' nie ma prawidłowej listy części.',409);
        const updates=[];
        for(const line of lines){
          const q=Number(line.quantity),position=Number(line.position);
          if(!Number.isSafeInteger(q)||q<1||!Number.isSafeInteger(position)||position<1||
             line.confirmedQuantity!=null&&Number(line.confirmedQuantity)!==q||
             line.verifiedQuantity!=null&&Number(line.verifiedQuantity)!==q||
             line.returnedQuantity!=null&&Number(line.returnedQuantity)!==0||
             String(line.returnLocation||'').trim()!=='')
            return send('Trasa '+route.routeNumber+' ma niezgodność lub istniejący zwrot. Niczego nie nadpisano.',409);
          updates.push({
            position,partCode:line.partCode||'',partName:line.partName||'',
            quantity:q,confirmedQuantity:q,verifiedQuantity:line.verifiedQuantity??null,
            returnedQuantity:targetStatus==='COMPLETED'?0:null,returnLocation:null
          });
        }
        const already=route.status===targetStatus&&lines.every((line,i)=>
          line.confirmedQuantity!=null&&Number(line.confirmedQuantity)===updates[i].quantity&&
          (targetStatus==='COMPLETED'
            ?line.returnedQuantity!=null&&Number(line.returnedQuantity)===0
            :line.returnedQuantity==null)&&
          !line.returnLocation
        );
        // A demo already marked COMPLETED may still lack settlement amounts;
        // fill those blanks, but never downgrade a completed route to confirmed.
        if(route.status==='COMPLETED'&&targetStatus!=='COMPLETED')
          return send('Trasa '+route.routeNumber+' została już zakończona. Nie można jej cofnąć do potwierdzonej.',409);
        if(!already)staged.push({route,lines,updates,targetStatus});
      }
      if(!staged.length)return workerJson({ok:true,updated:0,alreadyPrepared:true});
      const statements=[];
      for(const {route,lines,updates,targetStatus} of staged){
        const token=crypto.randomUUID();
        statements.push(env.DB.prepare(
          'UPDATE pl_routes SET status=?,edit_revision=edit_revision+1,edit_token=? '+
          'WHERE id=? AND is_presentation=1 AND edit_revision=? AND status=? '+
          "AND route_date BETWEEN '2026-11-16' AND '2026-11-22'"
        ).bind(targetStatus,token,route.id,route.revision,route.status));
        for(const item of updates){
          statements.push(env.DB.prepare(
            'UPDATE pl_route_lines SET confirmed_quantity=quantity,returned_quantity=?,return_location=NULL '+
            'WHERE route_id=? AND position=? AND quantity=? '+
            'AND (confirmed_quantity IS NULL OR confirmed_quantity=quantity) '+
            'AND (verified_quantity IS NULL OR verified_quantity=quantity) '+
            'AND (returned_quantity IS NULL OR returned_quantity=0) '+
            "AND (return_location IS NULL OR trim(return_location)='') "+
            'AND EXISTS (SELECT 1 FROM pl_routes r WHERE r.id=? '+
            'AND r.edit_revision=? AND r.edit_token=?)'
          ).bind(item.returnedQuantity,route.id,item.position,item.quantity,
            route.id,route.revision+1,token));
        }
        statements.push(auditEntry(env.DB,{
          id:crypto.randomUUID(),routeId:route.id,action:'EDIT',
          actorId:auth.user.id,revision:route.revision+1,token,
          details:{
            demo:true,comment:'Test automatycznej archiwizacji tygodnia 47. Bez zmian stanów.',
            before:{routeNumber:route.routeNumber,routeDate:route.routeDate,
              crewSymbol:route.crewSymbol,status:route.status,lines},
            after:{routeNumber:route.routeNumber,routeDate:route.routeDate,
              crewSymbol:route.crewSymbol,status:targetStatus,lines:updates}
          }
        }));
      }
      const result=await env.DB.batch(statements);
      if(result.some(step=>Number(step?.meta?.changes||0)!==1))
        return send('Jedna z tras została zmieniona w innym oknie. Odśwież listę.',409);
      return workerJson({ok:true,updated:staged.length,
        completed:routes.filter(r=>completeIds.includes(r.id)).map(r=>r.routeNumber),
        confirmed:routes.find(r=>r.id===confirmedId)?.routeNumber});
    }catch(error){
      console.error('PL demo week47 preparation failed',error?.name||'Error');
      return send('Nie udało się przygotować tras pokazowych tygodnia 47.',503);
    }
  }
  if(body?.action==='completeDemoWeek45'){
    // Only the two specifically requested presentation routes, never real stock.
    if(auth.user.role!=='ADMIN')return send('Tylko administrator może rozliczyć trasy pokazowe.',403);
    if(body.confirm!=='ROZLICZ DEMO 45')return send('Potwierdź rozliczenie tras demo 45.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines')||
         !await hasPresentationFlag(env.DB))
        return send('Nie znaleziono tras pokazowych.',404);
      const required=['confirmed_quantity','verified_quantity','returned_quantity','return_location'];
      const columns=await routeLineColumns(env.DB);
      if(!required.every(col=>columns.has(col)))
        return send('Dane rozliczenia tras nie są jeszcze dostępne.',409);
      await ensureRouteAuditSchema(env.DB);
      const routes=(await env.DB.prepare(
        "SELECT id,route_number AS routeNumber,route_date AS routeDate,"+
        "crew_symbol AS crewSymbol,status,edit_revision AS revision "+
        "FROM pl_routes WHERE is_presentation=1 "+
        "AND route_number IN ('02HH','02HP') "+
        "AND route_date BETWEEN '2026-11-02' AND '2026-11-08' "+
        "ORDER BY route_number"
      ).all()).results||[];
      if(routes.length!==2||routes[0].routeNumber!=='02HH'||routes[1].routeNumber!=='02HP')
        return send('Brakuje jednej z dwóch tras pokazowych 02HH i 02HP z tygodnia 45.',409);
      const prepared=[];
      for(const route of routes){
        const lines=(await env.DB.prepare(
          'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
          'confirmed_quantity AS confirmedQuantity,verified_quantity AS verifiedQuantity,'+
          'returned_quantity AS returnedQuantity,return_location AS returnLocation '+
          'FROM pl_route_lines WHERE route_id=? ORDER BY position'
        ).bind(route.id).all()).results||[];
        const settlement=demo45Settlement(route.routeNumber,lines);
        if(settlement.error)return send(settlement.error,409);
        const updates=settlement.updates;
        const matching=route.status==='COMPLETED'&&updates.every((x,index)=>
          lines[index].confirmedQuantity!=null&&lines[index].returnedQuantity!=null&&
          Number(lines[index].confirmedQuantity)===x.quantity&&
          Number(lines[index].returnedQuantity)===x.returnedQuantity&&
          String(lines[index].returnLocation||'')===String(x.returnLocation||''));
        if(route.status==='COMPLETED'&&!matching)
          return send('Trasa '+route.routeNumber+' jest już zakończona z innym rozliczeniem.',409);
        if(!matching)prepared.push({route,lines,updates});
      }
      if(!prepared.length)return workerJson({ok:true,updated:0,alreadyComplete:true});
      const statements=[];
      for(const {route,lines,updates} of prepared){
        const token=crypto.randomUUID();
        statements.push(env.DB.prepare(
          "UPDATE pl_routes SET status='COMPLETED',edit_revision=edit_revision+1,edit_token=? "+
          "WHERE id=? AND is_presentation=1 AND edit_revision=? "+
          "AND route_number=? AND route_date BETWEEN '2026-11-02' AND '2026-11-08' "+
          "AND status<>'COMPLETED'"
        ).bind(token,route.id,route.revision,route.routeNumber));
        for(const item of updates){
          statements.push(env.DB.prepare(
            'UPDATE pl_route_lines SET confirmed_quantity=quantity,'+
            'returned_quantity=?,return_location=? '+
            'WHERE route_id=? AND position=? AND quantity=? '+
            'AND EXISTS (SELECT 1 FROM pl_routes r WHERE r.id=? '+
            'AND r.edit_revision=? AND r.edit_token=?)'
          ).bind(item.returnedQuantity,item.returnLocation,
            route.id,item.position,item.quantity,route.id,route.revision+1,token));
        }
        statements.push(auditEntry(env.DB,{
          id:crypto.randomUUID(),routeId:route.id,action:'EDIT',
          actorId:auth.user.id,revision:route.revision+1,token,
          details:{
            demo:true,comment:'Rozliczenie demonstracyjne tygodnia 45.',
            before:{
              routeNumber:route.routeNumber,routeDate:route.routeDate,
              crewSymbol:route.crewSymbol,status:route.status,lines
            },
            after:{
              routeNumber:route.routeNumber,routeDate:route.routeDate,
              crewSymbol:route.crewSymbol,status:'COMPLETED',lines:updates
            }
          }
        }));
      }
      const result=await env.DB.batch(statements);
      if(result.some(x=>Number(x?.meta?.changes||0)!==1))
        return send('Trasy zostały w międzyczasie zmienione. Odśwież historię.',409);
      return workerJson({ok:true,updated:prepared.length,routeNumbers:prepared.map(x=>x.route.routeNumber)});
    }catch(error){
      console.error('PL demo week45 settlement failed',error?.name||'Error');
      return send('Nie udało się rozliczyć pokazowych tras tygodnia 45.',503);
    }
  }
  if(body?.action==='seedDemoWeek48'){
    // One deliberate, ADMIN-authenticated POST; never seed on GET or page load.
    if(!ROUTE_PRESENTATION_MODE||auth.user.role!=='ADMIN')
      return send('Tylko administrator może dodawać trasy pokazowe.',403);
    if(body.confirm!=='DODAJ DEMO 48')
      return send('Potwierdź dodanie tras prezentacyjnych.',400);
    try{
      const columns=await routeLineColumns(env.DB);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB)||
         !['confirmed_quantity','verified_quantity','returned_quantity','return_location'].every(c=>columns.has(c)))
        await ensureSchema(env.DB);
      const placeholders=seedableDemoWeek48Ids.map(()=>'?').join(',');
      const existing=(await env.DB.prepare(
        'SELECT id,is_presentation FROM pl_routes WHERE id IN ('+placeholders+')'
      ).bind(...seedableDemoWeek48Ids).all()).results||[];
      if(existing.some(row=>Number(row.is_presentation)!==1))
        return send('Identyfikator demo jest zajęty przez zwykłą trasę. Niczego nie zmieniono.',409);
      const present=new Set(existing.map(row=>row.id));
      // Only the new 48PL-08 carries clearly labeled, fictional explanation history.
      if(!present.has(demoWeek48Id(7)))await ensureRouteAuditSchema(env.DB);
      const statements=[];
      let added=0;
      for(let i=0;i<DEMO_WEEK48.length;i++){
        const item=DEMO_WEEK48[i],id=demoWeek48Id(i);
        if(id===retiredDemo48PL03)continue;
        if(present.has(id))continue; // repeat click never duplicates or rewrites a demo
        const occupied=await env.DB.prepare(
          'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
        ).bind(item.no,item.date).first();
        if(occupied)return send('Numer '+item.no+' w tej dacie jest już zajęty. Niczego nie dodano.',409);
        statements.push(env.DB.prepare(
          'INSERT INTO pl_routes '+
          '(id,route_number,route_date,crew_number,crew_symbol,status,created_by,is_presentation,edit_revision) '+
          'VALUES (?,?,?,?,?,?,?,1,?)'
        ).bind(id,item.no,item.date,'',item.crew,item.status,auth.user.id,item.sampleAudit?1:0));
        item.parts.forEach(([name,quantity,confirmedOverride],position)=>{
          const confirmed=item.status==='AWAITING_CONFIRMATION'
            ?null:confirmedOverride===undefined?quantity:confirmedOverride;
          const returned=item.status==='COMPLETED'?0:null;
          const verified=item.sampleAudit&&position===0?confirmed:null;
          statements.push(env.DB.prepare(
            'INSERT INTO pl_route_lines '+
            '(route_id,position,part_code,part_name,quantity,confirmed_quantity,verified_quantity,returned_quantity) '+
            'VALUES (?,?,?,?,?,?,?,?)'
          ).bind(id,position+1,'',name,quantity,confirmed,verified,returned));
        });
        if(item.sampleAudit){
          const sample={
            demo:true,
            comment:'Przykład demonstracyjny: jedna pozycja została skorygowana, druga pozostaje do dalszego sprawdzenia.',
            statusBefore:'REVIEW_REQUIRED',statusAfter:'REVIEW_REQUIRED',
            positions:[
              {position:1,partName:'Separator',before:8,confirmed:7,after:7,
                decision:'MATCH_CREW',
                note:'Po kontakcie z magazynem potwierdzono, że wydano 7 zamiast 8 sztuk. Poprawiono zapis do ilości otrzymanej przez ekipę.'},
              {position:2,partName:'Osłona przyłącza',before:3,confirmed:2,after:null,
                decision:'LEAVE_OPEN',
                note:'Ekipa otrzymała 2 sztuki, magazyn wskazuje 3. Trwa sprawdzanie dokumentu wydania; nie wprowadzono fikcyjnej korekty.'}
            ]
          };
          statements.push(env.DB.prepare(
            'INSERT INTO pl_route_audit (id,route_id,action,actor_id,details_json) '+
            'VALUES (?,?,?,?,?)'
          ).bind(crypto.randomUUID(),id,'EXPLAIN','DEMO',JSON.stringify(sample)));
        }
        added++;
      }
      if(statements.length)await env.DB.batch(statements);
      return workerJson({ok:true,added,alreadyPresent:seedableDemoWeek48Ids.length-added,
        demoWeek:48,year:2026});
    }catch(error){
      console.error('PL week48 demo seed failed',error?.name||'Error');
      if(/UNIQUE constraint failed/i.test(String(error?.message||'')))
        return send('Jedna z przykładowych tras już istnieje. Nie nadpisano żadnych danych.',409);
      return send('Nie udało się wstawić tras demo do D1.',503);
    }
  }
  if(body?.action==='deleteDemo48PL03'){
    // Exact, one-time removal of the demonstrative route with duplicate audit
    // history. Never expose deletion of a normal route through this action.
    if(auth.user.role!=='ADMIN')return send('Tylko administrator może usunąć trasę pokazową.',403);
    if(body.confirm!=='USUŃ 48PL-03')return send('Potwierdź usunięcie trasy 48PL-03.',400);
    try{
      if(!await verifyCleanupPin(env.DB,env,auth.user.id,body.pin))
        return send('Nieprawidłowy PIN administratora.',403);
      if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB))
        return workerJson({ok:true,deleted:0});
      const route=await env.DB.prepare(
        'SELECT id,route_number AS routeNumber,route_date AS routeDate,'+
        'is_presentation AS isPresentation FROM pl_routes WHERE id=?'
      ).bind(retiredDemo48PL03).first();
      if(!route)return workerJson({ok:true,deleted:0});
      if(Number(route.isPresentation)!==1||route.routeNumber!=='48PL-03'||
         route.routeDate!=='2026-11-25')
        return send('Nie znaleziono właściwej trasy pokazowej. Niczego nie usunięto.',409);
      const hasDocuments=await exists(env.DB,'pl_route_documents');
      const docs=hasDocuments?(await env.DB.prepare(
        'SELECT object_key,size_bytes FROM pl_route_documents WHERE route_id=?'
      ).bind(retiredDemo48PL03).all()).results||[]:[];
      if(docs.length){
        if(!env.PART_PHOTOS||typeof env.PART_PHOTOS.delete!=='function')
          return send('Usuwanie przerwane: brakuje dostępu do zdjęć w R2.',503);
        for(let i=0;i<docs.length;i+=1000){
          await env.PART_PHOTOS.delete(docs.slice(i,i+1000).map(d=>d.object_key));
        }
      }
      const statements=[];
      if(docs.length&&await exists(env.DB,'pl_r2_photo_quota')){
        const bytes=docs.reduce((sum,doc)=>sum+Number(doc.size_bytes||0),0);
        statements.push(env.DB.prepare(
          'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) WHERE id=1'
        ).bind(bytes));
      }
      if(hasDocuments)statements.push(env.DB.prepare(
        'DELETE FROM pl_route_documents WHERE route_id=?'
      ).bind(retiredDemo48PL03));
      if(await exists(env.DB,'pl_route_audit'))statements.push(env.DB.prepare(
        'DELETE FROM pl_route_audit WHERE route_id=?'
      ).bind(retiredDemo48PL03));
      statements.push(env.DB.prepare(
        'DELETE FROM pl_route_lines WHERE route_id=?'
      ).bind(retiredDemo48PL03));
      statements.push(env.DB.prepare(
        "DELETE FROM pl_routes WHERE id=? AND is_presentation=1 "+
        "AND route_number='48PL-03' AND route_date='2026-11-25'"
      ).bind(retiredDemo48PL03));
      const result=await env.DB.batch(statements);
      return workerJson({ok:true,deleted:Number(result[result.length-1]?.meta?.changes||0)});
    }catch(error){
      console.error('PL route 48PL-03 scoped cleanup failed',error?.name||'Error');
      return send('Nie udało się usunąć wyłącznie trasy demo 48PL-03.',503);
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
      const catalogLines=await resolveRouteParts(env.DB,updated.lines);
      const operationToken=crypto.randomUUID();
      const before=(await env.DB.prepare(
        'SELECT position,part_code AS partCode,part_name AS partName,quantity,'+
        'catalog_part_id AS catalogPartId FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      const predicate=await routeEditablePredicate(env.DB,'pl_routes');
      const guard='EXISTS (SELECT 1 FROM pl_routes WHERE id=? AND edit_revision=? AND edit_token=? AND '+predicate+')';
      const statements=[
        env.DB.prepare(
          'UPDATE pl_routes SET route_number=?,route_date=?,crew_symbol=?,'+
          'edit_revision=edit_revision+1,edit_token=? '+
          'WHERE id=? AND edit_revision=? AND '+predicate
        ).bind(updated.routeNumber,updated.routeDate,updated.crewSymbol,operationToken,id,revision),
        env.DB.prepare(
          'DELETE FROM pl_route_lines WHERE route_id=? AND '+guard
        ).bind(id,id,revision+1,operationToken)
      ];
      catalogLines.forEach((line,index)=>{
        statements.push(env.DB.prepare(
          'INSERT INTO pl_route_lines (route_id,position,part_code,part_name,quantity,catalog_part_id) '+
          'SELECT ?,?,?,?,?,? WHERE '+guard
        ).bind(id,index+1,line.partCode,line.partName,line.quantity,
          line.catalogPartId,id,revision+1,operationToken));
      });
      statements.push(auditEntry(env.DB,{
        id:crypto.randomUUID(),routeId:id,action:'EDIT',
        actorId:auth.user.id,revision:revision+1,token:operationToken,
        details:{
          before:{routeNumber:current.routeNumber,routeDate:current.routeDate,
            crewSymbol:current.crewSymbol,lines:before},
          after:{routeNumber:updated.routeNumber,routeDate:updated.routeDate,
            crewSymbol:updated.crewSymbol,lines:catalogLines}
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
    const revision=Number(body.baseRevision);
    const comment=String(body.comment||'').trim();
    const corrections=body.corrections;
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id)||
       !Number.isSafeInteger(revision)||revision<0||
       comment.length<15||comment.length>2000||
       !Array.isArray(corrections)||corrections.length<1||corrections.length>150)
      return send('Wpisz komentarz (minimum 15 znaków) i prawidłowe ilości.',400);
    if(corrections.some(item=>!item||
       !Number.isSafeInteger(item.position)||item.position<1||
       !Number.isSafeInteger(item.quantity)||item.quantity<0||item.quantity>999999)||
       new Set(corrections.map(item=>item.position)).size!==corrections.length)
      return send('Wpisz prawidłową ilość po weryfikacji dla każdej części.',400);
    try{
      if(!await exists(env.DB,'pl_routes')||!await exists(env.DB,'pl_route_lines'))
        return send('Nie znaleziono trasy.',404);
      if(!(await routeLineColumns(env.DB)).has('verified_quantity'))
        await ensureSchema(env.DB);
      await ensureRouteAuditSchema(env.DB);
      const route=await env.DB.prepare(
        'SELECT id,status,edit_revision AS revision FROM pl_routes WHERE id=?'
      ).bind(id).first();
      if(!route)return send('Nie znaleziono trasy.',404);
      if(!['REVIEW_REQUIRED','REVIEW_EXPLAINED','DISCREPANCY','CONFIRMED','AWAITING_CONFIRMATION'].includes(route.status))
        return send('Trasa jest zakończona lub nie pozwala na weryfikację.',409);
      if(Number(route.revision)!==revision)
        return send('Dane trasy zmieniły się. Otwórz weryfikację ponownie.',409);
      const lines=(await env.DB.prepare(
        'SELECT position,part_name AS partName,quantity,'+
        'confirmed_quantity AS confirmedQuantity,verified_quantity AS verifiedQuantity '+
        'FROM pl_route_lines WHERE route_id=? ORDER BY position'
      ).bind(id).all()).results||[];
      const mismatches=lines.filter(line=>line.confirmedQuantity!=null&&
        line.verifiedQuantity==null&&Number(line.confirmedQuantity)!==Number(line.quantity));
      if(!mismatches.length)return send('W tej trasie nie ma już niezweryfikowanych różnic.',409);
      const byPosition=new Map(corrections.map(item=>[item.position,item.quantity]));
      if(byPosition.size!==mismatches.length||
         mismatches.some(line=>!byPosition.has(Number(line.position))))
        return send('Podaj ilość po weryfikacji dla każdej niezgodnej pozycji.',409);
      // Final verified quantities may differ from both the original issue
      // and the crew's first report (e.g. the crew collected missing parts).
      // All three values remain available in D1 and the audit log.
      const verified=mismatches.map(line=>({
        position:Number(line.position),partName:line.partName,
        before:Number(line.quantity),confirmed:Number(line.confirmedQuantity),
        after:byPosition.get(Number(line.position)),verified:true
      }));
      const unconfirmed=lines.some(line=>line.confirmedQuantity==null);
      const status=unconfirmed?'AWAITING_CONFIRMATION':'CONFIRMED';
      const token=crypto.randomUUID();
      const statements=[
        env.DB.prepare(
          'UPDATE pl_routes SET status=?,edit_revision=edit_revision+1,edit_token=? '+
          'WHERE id=? AND edit_revision=? '+
          "AND status IN ('REVIEW_REQUIRED','REVIEW_EXPLAINED','DISCREPANCY','CONFIRMED','AWAITING_CONFIRMATION') "+
          'AND EXISTS (SELECT 1 FROM pl_route_lines l WHERE l.route_id=pl_routes.id '+
          'AND l.confirmed_quantity IS NOT NULL AND l.verified_quantity IS NULL '+
          'AND l.confirmed_quantity<>l.quantity)'
        ).bind(status,token,id,revision)
      ];
      for(const item of verified){
        statements.push(env.DB.prepare(
          'UPDATE pl_route_lines SET verified_quantity=? '+
          'WHERE route_id=? AND position=? AND quantity=? AND confirmed_quantity=? '+
          'AND verified_quantity IS NULL '+
          'AND EXISTS (SELECT 1 FROM pl_routes r WHERE r.id=? '+
          'AND r.edit_revision=? AND r.edit_token=?)'
        ).bind(item.after,id,item.position,item.before,item.confirmed,
          id,revision+1,token));
      }
      statements.push(auditEntry(env.DB,{
        id:crypto.randomUUID(),routeId:id,action:'EXPLAIN',
        actorId:auth.user.id,revision:revision+1,token,
        details:{comment,positions:verified,statusBefore:route.status,statusAfter:status}
      }));
      const result=await env.DB.batch(statements);
      if(Number(result[0]?.meta?.changes||0)!==1)
        return send('Trasa została w międzyczasie zmieniona. Otwórz weryfikację ponownie.',409);
      return workerJson({ok:true,id,status,verifiedCount:verified.length});
    }catch(error){
      console.error('PL route discrepancy explanation failed',error?.name||'Error');
      return send('Nie udało się zatwierdzić weryfikacji.',503);
    }
  }
  if(body?.action!=='create')return send('Nieznana operacja.',400);
  const route=parseRoute(body);
  if(!route)return send('Uzupełnij numer i datę trasy, ekipę oraz prawidłową listę części.',400);
  try{
    const lineColumns=await routeLineColumns(env.DB);
    if(!await exists(env.DB,'pl_routes')||!await hasPresentationFlag(env.DB)||
       !['confirmed_quantity','verified_quantity','returned_quantity','return_location'].every(
         col=>lineColumns.has(col)
       ))await ensureSchema(env.DB);
    const duplicate=await env.DB.prepare(
      'SELECT id FROM pl_routes WHERE route_number=? AND route_date=? LIMIT 1'
    ).bind(route.routeNumber,route.routeDate).first();
    if(duplicate)return send('Trasa z tym numerem i datą jest już zapisana.',409);
    const catalogLines=await resolveRouteParts(env.DB,route.lines);
    const id='PL-ROUTE-'+crypto.randomUUID();
    const steps=[
      env.DB.prepare(
        'INSERT INTO pl_routes (id,route_number,route_date,crew_number,crew_symbol,status,created_by,is_presentation) '+
        'VALUES (?,?,?,?,?,?,?,?)'
      ).bind(id,route.routeNumber,route.routeDate,'',route.crewSymbol,
        'AWAITING_CONFIRMATION',auth.user.id,route.isPresentation?1:0)
    ];
    catalogLines.forEach((line,i)=>{
      steps.push(env.DB.prepare(
        'INSERT INTO pl_route_lines (route_id,position,part_code,part_name,quantity,catalog_part_id) '+
        'VALUES (?,?,?,?,?,?)'
      ).bind(id,i+1,line.partCode,line.partName,line.quantity,line.catalogPartId));
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
