// Belleville: planned loading lists are separate from confirmed WZ/stock.
// No stock, module or WZ write is performed by this API.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {ensureFrLoadingListCatalog} from '../../lib/fr-loading-list-catalog.js';

const error=(message,status=400)=>workerJson({ok:false,error:message},status);
const UUID=/^[0-9a-f-]{36}$/i;
const ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
async function session(request,env,mobile=false){
  if(!workerAuthReady(env))throw Object.assign(Error('Panel nie jest skonfigurowany.'),{status:503});
  const user=await verifyWorkerSession(request,env)||
    (!mobile?await verifyRememberSession(request,env):null);
  if(!user)throw Object.assign(Error('Zaloguj się ponownie.'),{status:401});
  if(!(mobile?user.apps?.mobile:user.apps?.office)||!ROLES.has(user.role)||user.markets?.FR!==true||
     user.features?.wz===false)
    throw Object.assign(Error('Brak uprawnień do planowania wydań Belleville.'),{status:403});
  const owner=user.role==='ADMIN'&&String(user.nickname||'').trim().toUpperCase()==='JJ';
  if(!owner){
    const granted=await env.DB.prepare(
      'SELECT 1 FROM user_warehouse_access a JOIN warehouses w ON w.id=a.warehouse_id '+
      "WHERE a.user_id=? AND w.active=1 AND w.country_code='FR' AND "+
      "(w.id='FR-BELLEVILLE' OR LOWER(w.name) LIKE '%belleville%') LIMIT 1"
    ).bind(user.id).first();
    if(!granted)throw Object.assign(Error('Nie masz przypisanego magazynu Belleville.'),{status:403});
  }
  return user;
}
async function ensure(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS fr_loading_plans ('+
    'id TEXT PRIMARY KEY,route_code TEXT NOT NULL COLLATE NOCASE,'+
    'iso_year INTEGER NOT NULL,week_number INTEGER NOT NULL,'+
    "status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','IN_PROGRESS','COMPLETED')),"+
    'created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
    'UNIQUE(iso_year,week_number,route_code))').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS fr_loading_plan_lines ('+
    'id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES fr_loading_plans(id) ON DELETE CASCADE,'+
    'position INTEGER NOT NULL,excel_name TEXT NOT NULL,display_name TEXT NOT NULL,'+
    "kind TEXT NOT NULL CHECK(kind IN ('MODULE','PART')),"+
    'quantity INTEGER NOT NULL,alias_id TEXT,part_ids_json TEXT NOT NULL DEFAULT \'[]\','+
    'UNIQUE(plan_id,position))').run();
}
function moduleLabel(name){
  // Label-only categorization; never guesses a serial number or a stock index.
  const matched=name.match(/^(?:InPost|Bloq\.?\s*it|New\s*Gen)\s*\/\s*(.+)$/i);
  return matched?.[1]?.trim()||null;
}
async function mappedLines(db,lines){
  await ensureFrLoadingListCatalog(db);
  const entries=(await db.prepare(
    'SELECT id,excel_name AS excelName,display_name AS displayName FROM fr_loading_list_aliases'
  ).all()).results||[];
  const links=(await db.prepare(
    'SELECT alias_id AS aliasId,part_id AS partId FROM fr_loading_list_part_links'
  ).all()).results||[];
  const partIds=new Map();
  for(const row of links){
    if(!partIds.has(row.aliasId))partIds.set(row.aliasId,[]);
    partIds.get(row.aliasId).push(row.partId);
  }
  const normalize=value=>String(value).trim().replace(/\s+/g,' ').toLocaleLowerCase();
  const aliases=new Map(entries.map(row=>[normalize(row.excelName),row]));
  return lines.map((row,position)=>{
    const excelName=row.excelName.trim().replace(/\s+/g,' ');
    const alias=aliases.get(normalize(excelName));
    const module=moduleLabel(excelName);
    return {position,excelName,quantity:row.quantity,
      displayName:alias?.displayName||module||excelName,
      kind:module&&!alias?'MODULE':'PART',
      aliasId:alias?.id||null,partIds:alias?partIds.get(alias.id)||[]:[]};
  });
}
// Dec 28 always belongs to the final ISO week.
function nextLoadingWeek(year,week){
  const jan4=new Date(Date.UTC(year,0,4));
  const firstMonday=new Date(jan4);firstMonday.setUTCDate(jan4.getUTCDate()-(jan4.getUTCDay()+6)%7);
  const lastWeek=Math.floor((Date.UTC(year,11,28)-firstMonday.getTime())/604800000)+1;
  return week>=lastWeek?{year:year+1,week:1}:{year,week:week+1};
}
export async function onRequestGet({request,env}){
  try{
    const url=new URL(request.url),mobile=url.searchParams.get('mobile')==='1';
    await session(request,env,mobile);
    const route=String(url.searchParams.get('route')||'').trim().toUpperCase().replace(/\s+/g,'');
    const year=Number(url.searchParams.get('year')),week=Number(url.searchParams.get('week'));
    if(mobile&&(!route||route.length>60||!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(week)||week<1||week>53))
      return error('Nieprawidłowa trasa lub tydzień.');
    await ensure(env.DB);
    const sql="SELECT id,route_code AS routeCode,iso_year AS year,week_number AS week,"+
      "status,created_at AS createdAt,updated_at AS updatedAt FROM fr_loading_plans WHERE status IN ('PLANNED','IN_PROGRESS')";
    const includeNext=mobile&&url.searchParams.get('includeNext')==='1';
    const next=includeNext?nextLoadingWeek(year,week):null;
    const plans=(includeNext?await env.DB.prepare(sql+' AND route_code=? COLLATE NOCASE AND ((iso_year=? AND week_number=?) OR (iso_year=? AND week_number=?)) ORDER BY iso_year,week_number LIMIT 2').bind(route,year,week,next.year,next.week).all():
      mobile?await env.DB.prepare(sql+' AND route_code=? COLLATE NOCASE AND iso_year=? AND week_number=? LIMIT 1').bind(route,year,week).all():
      await env.DB.prepare(sql+' ORDER BY iso_year DESC,week_number DESC,route_code COLLATE NOCASE LIMIT 300').all()).results||[];
    if(!plans.length)return workerJson({ok:true,plans:[]});
    const rows=(await env.DB.prepare(
      'SELECT plan_id AS planId,position,excel_name AS excelName,'+
      'display_name AS displayName,kind,quantity,alias_id AS aliasId,'+
      'part_ids_json AS partIdsJson FROM fr_loading_plan_lines WHERE plan_id IN ('+
      plans.map(()=>'?').join(',')+') ORDER BY position'
    ).bind(...plans.map(row=>row.id)).all()).results||[];
    const byId=new Map(plans.map(plan=>[plan.id,{...plan,lines:[]}]));
    for(const row of rows){
      const plan=byId.get(row.planId);if(!plan)continue;
      let partIds=[];
      try{partIds=JSON.parse(row.partIdsJson||'[]');}catch{}
      plan.lines.push({excelName:row.excelName,displayName:row.displayName,
        kind:row.kind,quantity:row.quantity,aliasId:row.aliasId,partIds});
    }
    return workerJson({ok:true,plans:[...byId.values()]});
  }catch(ex){
    console.error('Loading plans GET failed',ex?.name||'Error');
    return error(ex.status?ex.message:'Nie można pobrać list załadunkowych.',ex.status||503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return error('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return error('Wymagany format JSON.',415);
  try{
    const user=await session(request,env);
    const raw=await request.text();
    if(raw.length>60000)return error('Lista załadunkowa jest za długa.',413);
    const body=JSON.parse(raw);
    if(body?.action!=='save')return error('Nieznana operacja.',400);
    const id=String(body.id||'');
    const routeCode=String(body.routeCode||'').trim().toUpperCase().replace(/\s+/g,'');
    const year=Number(body.year),week=Number(body.week),lines=body.lines;
    if(id&&!UUID.test(id))return error('Nieprawidłowy identyfikator listy.',400);
    if(!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(routeCode))
      return error('Wpisz numer trasy (litery i cyfry, bez spacji).',400);
    if(!Number.isInteger(year)||year<2020||year>2100||
       !Number.isInteger(week)||week<1||week>53)
      return error('Wpisz poprawny rok i tydzień ISO (1–53).',400);
    if(!Array.isArray(lines)||lines.length<1||lines.length>250)
      return error('Wklej od 1 do 250 pozycji z Excela.',400);
    for(const line of lines){
      if(!line||typeof line.excelName!=='string'||
         line.excelName.trim().length<2||line.excelName.trim().length>240||
         /[\r\n<>]/.test(line.excelName)||
         !Number.isInteger(line.quantity)||line.quantity<1||line.quantity>100000)
        return error('Sprawdź nazwy i ilości pozycji na liście.',400);
    }
    const db=env.DB;
    await ensure(db);
    if(id){
      const current=await db.prepare('SELECT status FROM fr_loading_plans WHERE id=?').bind(id).first();
      if(!current)return error('Nie znaleziono listy. Odśwież widok.',404);
      if(current.status!=='PLANNED')return error('Rozpoczętej listy nie można już edytować.',409);
    }
    const duplicate=await db.prepare(
      'SELECT id FROM fr_loading_plans WHERE iso_year=? AND week_number=? AND route_code=? COLLATE NOCASE'
    ).bind(year,week,routeCode).first();
    if(duplicate&&duplicate.id!==id)return error('Ta trasa ma już listę w podanym tygodniu.',409);
    const mapped=await mappedLines(db,lines);
    const key=id||crypto.randomUUID();
    const statements=[
      id?db.prepare(
        'UPDATE fr_loading_plans SET route_code=?,iso_year=?,week_number=?,'+
        'updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=\'PLANNED\''
      ).bind(routeCode,year,week,key):
      db.prepare(
        'INSERT INTO fr_loading_plans(id,route_code,iso_year,week_number,created_by) '+
        'VALUES(?,?,?,?,?)'
      ).bind(key,routeCode,year,week,user.id),
      db.prepare('DELETE FROM fr_loading_plan_lines WHERE plan_id=?').bind(key),
      ...mapped.map(line=>db.prepare(
        'INSERT INTO fr_loading_plan_lines(id,plan_id,position,excel_name,display_name,'+
        'kind,quantity,alias_id,part_ids_json) VALUES(?,?,?,?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),key,line.position,line.excelName,line.displayName,
        line.kind,line.quantity,line.aliasId,JSON.stringify(line.partIds)))
    ];
    await db.batch(statements);
    return workerJson({ok:true,id:key,unmapped:mapped.filter(line=>
      line.kind==='PART'&&!line.aliasId).map(line=>line.excelName)});
  }catch(ex){
    console.error('Loading plans POST failed',ex?.name||'Error');
    return error(ex.status?ex.message:
      'Nie udało się zapisać listy. Sprawdź, czy trasa nie jest już zaplanowana.',ex.status||503);
  }
}
