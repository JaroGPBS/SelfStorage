// GPBS Storage: guarded web-panel API, independent from production /api.
import {ensurePartIndexes} from '../../lib/pl-part-indexes.js';
import {createSharedCataloguePart} from '../../lib/shared-catalogue-create.js';
import {BOX_CATALOG_SNAPSHOT} from '../../lib/box-catalog-20261111.js';
import {VEHICLE_CATALOG_SNAPSHOT} from '../../lib/vehicle-catalog-20261111.js';
import {getVehicleCatalogue} from '../../lib/vehicle-catalogue-service.js';
import {isFrTestAccount} from '../../lib/fr-test-store.js';
import {resolveFrCarClaim} from '../../lib/fr-car-review.js';
import {readFrWeeklySettings,saveFrWeeklySettings} from '../../lib/fr-weekly-schedule.js';
import {ownerContext,ownerPasswordMatches,ownerPinMatches,changeOwnerCredential} from '../../lib/super-admin-security.js';
import {ensureAccessTable,readUserAccess,effectiveAccessByUsers,validExtraPermissions,validAppAccess,serializeUserAccess,ownerBySymbol} from '../../lib/user-access-settings.js';
import {getPhotoObject,readPhotoResponse,r2Ready,
  ensurePhotoTables,readValidatedPhoto,reservePhotoWrite,releasePhotoBytes}
  from '../../lib/pl-r2-photos.js';
// Bootstrap administrator access: strong secret PLUS legacy administrator PIN.
// Later: migrate to scoped D1 users, passwordless/2FA and per-permission access.
const COOKIE_NAME = '__Host-gpbs_panel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';
const ALLOWED_ROLES = new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER','EKIPA']);
// Owner's fixed legacy login ID, from Admin Stock FR / Ekipy.
// The password and personally chosen legacy PIN remain unchanged.
const OWNER_LEGACY_ID = 'ADMIN';
const OWNER_ROLE = 'ADMIN';
// A conservative guard for the owner's existing D1 Office account.
// Keep this alias immutable in the panel until a unique D1 owner ID is configured.
const OWNER_D1_SYMBOL = 'JJ';
function isProtectedOwnerAccount(user){
  // A role is a permission, NOT the identity of the system's owner.
  // Other ADMIN accounts may be created, edited and archived by the owner.
  return String(user?.name||'').trim().toUpperCase()===OWNER_D1_SYMBOL;
}
async function isProtectedOwnerRecord(db,user){
  if(isProtectedOwnerAccount(user))return true;
  if(!user?.id)return false;
  const table=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='panel_super_admin_security'"
  ).first();
  if(!table)return false;
  return !!await db.prepare(
    'SELECT 1 FROM panel_super_admin_security WHERE owner_user_id=?'
  ).bind(user.id).first();
}
const enc = new TextEncoder();

function respond(body, status=200, extra={}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, private, max-age=0',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      ...extra
    }
  });
}

function fail(message, status=400) { return respond({ok:false,error:message},status); }
function ready(env) {
  return Boolean(env.DB && typeof env.PANEL_ADMIN_PASSWORD === 'string' &&
    env.PANEL_ADMIN_PASSWORD.length >= 8 &&
    typeof env.PANEL_SESSION_SECRET === 'string' && env.PANEL_SESSION_SECRET.length >= 32);
}

function b64(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64(s) {
  const pad=s.replace(/-/g,'+').replace(/_/g,'/');
  const output=atob(pad.padEnd(Math.ceil(pad.length/4)*4,'='));
  return Uint8Array.from(output, ch => ch.charCodeAt(0));
}
async function signingKey(secret) {
  return crypto.subtle.importKey('raw',enc.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function createToken(secret, actor, ctx=null) {
  const payload = enc.encode(JSON.stringify({
    id:actor,role:'ADMIN',rev:Number(ctx?.config?.revision||0),ownerUserId:ctx?.owner?.id||null,exp:Date.now()+SESSION_TTL_MS,
    nonce:crypto.randomUUID()
  }));
  const key=await signingKey(secret);
  const sig=await crypto.subtle.sign('HMAC',key,payload);
  return b64(payload)+'.'+b64(sig);
}
async function readSession(request, env) {
  const secret=env.PANEL_SESSION_SECRET;
  const cookie=request.headers.get('Cookie') || '';
  const match=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='));
  if (!match) return null;
  const value=match.slice(COOKIE_NAME.length+1);
  const pair=value.split('.');
  if (pair.length !== 2 || pair.some(x=>!x || x.length>2000)) return null;
  try {
    const data=unb64(pair[0]);
    const signature=unb64(pair[1]);
    const key=await signingKey(secret);
    if (!await crypto.subtle.verify('HMAC',key,signature,data)) return null;
    const session=JSON.parse(new TextDecoder().decode(data));
    if (session.role!=='ADMIN'||session.id!==OWNER_LEGACY_ID||
      !Number.isFinite(session.exp)||session.exp<Date.now()||
      session.exp>Date.now()+SESSION_TTL_MS) return null;
    const ctx=await ownerContext(env);
    if(ctx){
      if(session.ownerUserId&&session.ownerUserId!==ctx.owner.id)return null;
      if(Number(session.rev||0)!==Number(ctx.config.revision||0))return null;
      // After the switch, old pre-D1 signed cookies no longer work.
      if(ctx.config.unified_pin===1&&!session.ownerUserId)return null;
    }
    return {...session,superAdmin:!!ctx};
  } catch {return null;}
}
async function equalSecret(actual,expected) {
  if (typeof actual!=='string') return false;
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(actual)),
    crypto.subtle.digest('SHA-256',enc.encode(expected))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}

// D1-backed login limits. All checks fail closed if D1 cannot update.
const LOGIN_WINDOW_SECONDS = 15 * 60;
const IP_MAX_ATTEMPTS = 5;        // 5 attempts / 15 minutes -> 5-minute lock
const IP_LOCK_SECONDS = 5 * 60;
const ADMIN_PIN_MAX_ATTEMPTS = 5; // only reached after correct panel password
const ADMIN_PIN_LOCK_SECONDS = 30 * 60;

async function loginIpIdentifier(request, secret) {
  // Trust only Cloudflare's network-provided header, never a user-supplied X-Forwarded-For.
  const ip = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (!/^[a-f0-9:.]{3,45}$/.test(ip)) return null;
  const key = await signingKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('GPBS:PANEL:LOGIN:IP:' + ip));
  return 'ip:' + b64(new Uint8Array(sig).slice(0, 16));
}

function blocked(seconds) {
  const retry = Math.max(1, Math.ceil(seconds));
  return respond({
    ok: false,
    error: 'Zbyt wiele prób logowania. Spróbuj ponownie za ' + Math.ceil(retry / 60) + ' min.',
    retryAfterSeconds: retry
  }, 429, { 'Retry-After': String(retry) });
}

async function reserveLoginAttempt(db, identifier, maxAttempts, lockSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const prior = await db.prepare(
    'SELECT locked_until FROM panel_login_attempts WHERE identifier = ?'
  ).bind(identifier).first();
  if (prior && Number(prior.locked_until) > now) {
    return Number(prior.locked_until) - now;
  }

  // Atomic upsert: simultaneous requests increment one serialized D1 counter,
  // with the lock checked again after reservation, before credentials are validated.
  // Once an expired lock expires, the user receives a fresh attempts window.
  await db.prepare(
    'INSERT INTO panel_login_attempts (identifier, failures, locked_until, updated_at) ' +
    'VALUES (?, 1, 0, ?) ' +
    'ON CONFLICT(identifier) DO UPDATE SET ' +
    'locked_until = CASE ' +
    'WHEN updated_at < ? OR (locked_until > 0 AND locked_until <= ?) THEN 0 ' +
    'WHEN failures + 1 >= ? THEN ? ELSE 0 END, ' +
    'failures = CASE ' +
    'WHEN updated_at < ? OR (locked_until > 0 AND locked_until <= ?) THEN 1 ' +
    'ELSE failures + 1 END, ' +
    'updated_at = ?'
  ).bind(
    identifier, now,
    now - LOGIN_WINDOW_SECONDS, now, maxAttempts, now + lockSeconds,
    now - LOGIN_WINDOW_SECONDS, now,
    now
  ).run();

  const current = await db.prepare(
    'SELECT locked_until FROM panel_login_attempts WHERE identifier = ?'
  ).bind(identifier).first();
  return Math.max(0, Number(current?.locked_until || 0) - now);
}

async function clearLoginAttempts(db, identifiers) {
  // Successful, fully verified login resets both restrictions.
  await db.batch(identifiers.map(id =>
    db.prepare('DELETE FROM panel_login_attempts WHERE identifier = ?').bind(id)
  ));
}

async function verifyLegacyAdmin(pin,env) {
  if (typeof pin!=='string'||!/^\d{4}$/.test(pin)) return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try {
    const res=await fetch(env.APPS_SCRIPT_URL||SCRIPT_FALLBACK,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify({action:'LOGIN',payload:{pin}}),
      signal:controller.signal,
      redirect:'follow'
    });
    if(!res.ok) return null;
    const body=await res.json();
    if(body?.ok===true && String(body?.ekipa?.rola||'').toUpperCase().trim()==='ADMIN'&&body?.ekipa?.id)
      return String(body.ekipa.id);
    return null;
  } finally {clearTimeout(timer);}
}

// The owner now shares a single D1 PIN across mobile, Office and Admin.
// The legacy FR credential remains a temporary login bridge until migration.
// Read-only Cloudflare account metrics. The API token stays on the server.
async function cloudflareUsage(env,url) {
  const accountId=String(env.CF_ACCOUNT_ID||'').trim();
  const databaseId=String(env.CF_D1_DATABASE_ID||'').trim();
  const bucketName=String(env.CF_R2_BUCKET_NAME||'').trim();
  const token=String(env.CF_ANALYTICS_API_TOKEN||'').trim();
  // Only variable names are exposed to an authenticated ADMIN, never values or tokens.
  const missing=[
    !accountId?'CF_ACCOUNT_ID':null,
    !databaseId?'CF_D1_DATABASE_ID':null,
    !bucketName?'CF_R2_BUCKET_NAME':null,
    !token?'CF_ANALYTICS_API_TOKEN':null
  ].filter(Boolean);
  if(missing.length)return {status:'not_configured',missing};
  if(!/^[a-fA-F0-9]{32}$/.test(accountId) ||
     !/^[a-fA-F0-9-]{36}$/.test(databaseId) ||
     !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucketName))
    return {status:'invalid_configuration'};

  // Edge cache is optional (e.g. unavailable during local development).
  // Cache only after the authenticated Admin session check in route().
  const cache=typeof caches!=='undefined'?caches.default:null;
  const cacheKey=new Request(url.origin+'/api/panel?view=usage&internal_cache_v=3');
  if(cache){
    try{
      const cached=await cache.match(cacheKey);
      if(cached)return await cached.json();
    }catch{}
  }

  const now=new Date();
  const monthStart=now.toISOString().slice(0,7)+'-01';
  const monthFrom=monthStart+'T00:00:00Z';
  const today=now.toISOString().slice(0,10);
  const storageStart=new Date(now.getTime()-7*86400000).toISOString();
  const values={accountTag:accountId,databaseId,bucketName,startDate:monthStart,
    endDate:today,today,storageFrom:storageStart,storageTo:now.toISOString(),monthFrom};
  // Each node is independent; failure of one does not blank the entire dashboard.
  const specs=[
    {key:'d1Rows',args:'$accountTag:string!,$databaseId:string!,$startDate:Date!,$endDate:Date!',
      node:'d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$startDate,date_leq:$endDate,databaseId:$databaseId}) {sum {rowsRead rowsWritten}}'},
    {key:'d1Today',args:'$accountTag:string!,$databaseId:string!,$today:Date!',
      node:'d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$today,date_leq:$today,databaseId:$databaseId}) {sum {rowsRead rowsWritten}}'},
    {key:'d1Storage',args:'$accountTag:string!,$databaseId:string!,$storageFrom:Time!,$storageTo:Time!',
      node:'d1StorageAdaptiveGroups(limit:1,filter:{databaseId:$databaseId,datetime_geq:$storageFrom,datetime_leq:$storageTo},orderBy:[datetime_DESC]) {max {databaseSizeBytes} dimensions {datetime}}'},
    {key:'r2Storage',args:'$accountTag:string!,$bucketName:string!,$storageFrom:Time!,$storageTo:Time!',
      node:'r2StorageAdaptiveGroups(limit:1,filter:{bucketName:$bucketName,datetime_geq:$storageFrom,datetime_leq:$storageTo},orderBy:[datetime_DESC]) {max {payloadSize metadataSize objectCount} dimensions {datetime}}'},
    {key:'r2Ops',args:'$accountTag:string!,$bucketName:string!,$monthFrom:Time!,$storageTo:Time!',
      node:'r2OperationsAdaptiveGroups(limit:10000,filter:{bucketName:$bucketName,datetime_geq:$monthFrom,datetime_leq:$storageTo}) {sum {requests} dimensions {actionType}}'}
  ];
  const safeMessage=value=>{
    let clean=String(value||'');
    for(const sensitive of [token,accountId,databaseId,bucketName].filter(Boolean))
      clean=clean.split(sensitive).join('[redacted]');
    return clean.replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
      .replace(/https?:\/\/[^\s)]+/gi,'[URL]')
      .replace(/\b[a-f0-9]{32}\b/gi,'[id]')
      .replace(/\b[a-f0-9]{8}-[a-f0-9-]{27,}\b/gi,'[id]')
      .replace(/[A-Za-z0-9_\-]{40,}/g,'[value]').slice(0,200);
  };
  const errorReason=errors=>{
    const description=errors.map(e=>String(e?.message||'')).join(' ');
    return /cannot query field|unknown field|unknown argument|unknown type/i.test(description)
      ?'graphql_schema':/variable|expected type|invalid value|syntax error|parsing/i.test(description)
      ?'graphql_variables':/limit|budget|cost|quota|too many|range too large|older than|excessive resources/i.test(description)
      ?'graphql_limit':/forbidden|unauthori[sz]ed|permission|access denied|not authorized/i.test(description)
      ?'authorization':'graphql_error';
  };
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),9000);
  async function load(spec){
    let phase='fetch';
    try{
      const query='query '+spec.key+'('+spec.args+') {viewer {accounts(filter:{accountTag:$accountTag}) {data:'+spec.node+'}}}';
      const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{
        method:'POST',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({query,variables:values}),signal:abort.signal
      });
      phase='response';
      const result=await response.json();
      phase='processing';
      const errors=Array.isArray(result?.errors)?result.errors.filter(Boolean):[];
      if(!response.ok||errors.length){
        const reason=[401,403].includes(response.status)?'authorization':
          response.status===429?'rate_limited':
          errors.length?errorReason(errors):
          response.status===400?'request_invalid':'http_error';
        console.error('Cloudflare usage dataset failed',spec.key,reason,
          'status',response.status,'detail',safeMessage(errors[0]?.message));
        return {ok:false,reason};
      }
      const rows=result?.data?.viewer?.accounts?.[0]?.data;
      if(!Array.isArray(rows)){
        console.error('Cloudflare usage dataset failed',spec.key,'account_unavailable');
        return {ok:false,reason:'account_unavailable'};
      }
      return {ok:true,rows};
    }catch(error){
      const reason=error?.name==='AbortError'?'timeout':
        phase==='fetch'?'fetch_failed':phase==='response'?'invalid_response':'processing_error';
      console.error('Cloudflare usage dataset failed',spec.key,reason,
        error?.name||'Error','detail',safeMessage(error?.message));
      return {ok:false,reason};
    }
  }
  let results;
  try{results=await Promise.all(specs.map(load));}
  finally{clearTimeout(timer);}
  const [d1Rows,d1Today,d1Size,r2Size,r2Ops]=results;
  const successCount=results.filter(r=>r.ok).length;
  const issues={
    d1:results.slice(0,3).map((r,i)=>r.ok?null:{dataset:specs[i].key,reason:r.reason}).filter(Boolean),
    r2:results.slice(3).map((r,i)=>r.ok?null:{dataset:specs[i+3].key,reason:r.reason}).filter(Boolean)
  };
  const safeNumber=n=>n==null||!Number.isFinite(Number(n))?null:Number(n);
  const total=(rows,key)=>rows.reduce((sum,row)=>sum+(safeNumber(row?.sum?.[key])||0),0);
  const d1Storage=d1Size.ok?d1Size.rows[0]:null;
  const r2Storage=r2Size.ok?r2Size.rows[0]:null;
  // R2 quota classes follow the official operation-to-class mapping.
  // Unknown action types make class counts unavailable rather than falsely reporting 0.
  const r2ClassA=new Set([
    'LISTBUCKETS','PUTBUCKET','LISTOBJECTS','PUTOBJECT','COPYOBJECT',
    'COMPLETEMULTIPARTUPLOAD','CREATEMULTIPARTUPLOAD',
    'LIFECYCLESTORAGETIERTRANSITION','LISTMULTIPARTUPLOADS',
    'UPLOADPART','UPLOADPARTCOPY','LISTPARTS','PUTBUCKETENCRYPTION',
    'PUTBUCKETCORS','PUTBUCKETLIFECYCLECONFIGURATION'
  ]);
  const r2ClassB=new Set([
    'HEADBUCKET','HEADOBJECT','GETOBJECT','USAGESUMMARY',
    'GETBUCKETENCRYPTION','GETBUCKETLOCATION','GETBUCKETCORS',
    'GETBUCKETLIFECYCLECONFIGURATION'
  ]);
  const r2FreeOps=new Set(['DELETEOBJECT','DELETEBUCKET','ABORTMULTIPARTUPLOAD']);
  const opsSummary={a:0,b:0,unknown:0};
  if(r2Ops.ok){
    for(const row of r2Ops.rows){
      const action=String(row?.dimensions?.actionType||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      const count=safeNumber(row?.sum?.requests)||0;
      if(r2ClassA.has(action))opsSummary.a+=count;
      else if(r2ClassB.has(action))opsSummary.b+=count;
      else if(!r2FreeOps.has(action))opsSummary.unknown+=count;
    }
    if(opsSummary.unknown){
      console.error('Cloudflare usage R2 contains unclassified operation types',
        'count',opsSummary.unknown);
    }
  }
  const output={
    status:successCount?'ok':'unavailable',
    reason:successCount?null:(results[0]?.reason||'graphql_error'),
    sampledAt:now.toISOString(),month:now.toISOString().slice(0,7),issues,
    d1:{
      sizeBytes:safeNumber(d1Storage?.max?.databaseSizeBytes),
      storageSampleAt:d1Storage?.dimensions?.datetime||null,
      rowsRead:d1Rows.ok?total(d1Rows.rows,'rowsRead'):null,
      rowsWritten:d1Rows.ok?total(d1Rows.rows,'rowsWritten'):null,
      todayRowsRead:d1Today.ok?total(d1Today.rows,'rowsRead'):null,
      todayRowsWritten:d1Today.ok?total(d1Today.rows,'rowsWritten'):null
    },
    r2:{
      sizeBytes:r2Storage?((safeNumber(r2Storage.max?.payloadSize)||0)+
        (safeNumber(r2Storage.max?.metadataSize)||0)):null,
      objectCount:safeNumber(r2Storage?.max?.objectCount),
      storageSampleAt:r2Storage?.dimensions?.datetime||null,
      operations:r2Ops.ok?total(r2Ops.rows,'requests'):null,
      classA:r2Ops.ok&&!opsSummary.unknown?opsSummary.a:null,
      classB:r2Ops.ok&&!opsSummary.unknown?opsSummary.b:null,
      unclassified:r2Ops.ok?opsSummary.unknown:null
    }
  };
  // Keep only complete successful responses in cache.
  if(successCount===specs.length&&cache){
    try{await cache.put(cacheKey,new Response(JSON.stringify(output),{
      headers:{'Cache-Control':'public, max-age=900'}
    }));}catch{}
  }
  return output;
}

async function adminUsage(env,url) {
  // Application-specific photo safeguards, not Cloudflare billing usage.
  let photo=null;
  try{
    const table=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_r2_photo_quota'"
    ).first();
    if(table){
      const row=await env.DB.prepare(
        'SELECT used_bytes,cycle,write_count,read_count FROM pl_r2_photo_quota WHERE id=1'
      ).first();
      if(row)photo={
        usedBytes:Number(row.used_bytes)||0,
        warningBytes:8000000000,hardBytes:9000000000,
        month:row.cycle||null,
        readCount:Number(row.read_count)||0,
        writeCount:Number(row.write_count)||0
      };
    }
  }catch(error){console.error('Local photo usage unavailable',error?.name||'Error');}
  return {cloudflare:await cloudflareUsage(env,url),photo};
}

// BOX QR registry: deliberately separate from ordinary warehouses (Belleville/PL).
// Original QR payloads verified in Admin Stock FR / Magazyny, 12 Nov 2026.
async function ensureBoxQrRegistry(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS fr_warehouse_qr ('+
      'warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id),'+
      'code TEXT NOT NULL UNIQUE)'
  ).run();
  const existing=[
    ['FR-TOULOUSE','MAG-TL7A2Q'],['FR-PARIS','MAG-PA5A4B']
  ];
  for(const [id,qr] of existing){
    await db.prepare(
      'INSERT OR IGNORE INTO fr_warehouse_qr(warehouse_id,code) '+
      "SELECT id,? FROM warehouses WHERE id=? AND country_code='FR'"
    ).bind(qr,id).run();
  }
}
async function boxQrRows(db) {
  await ensureBoxQrRegistry(db);
  const rows=await db.prepare(
    'SELECT w.id,w.name,w.active,q.code FROM fr_warehouse_qr q '+
    "JOIN warehouses w ON w.id=q.warehouse_id WHERE w.country_code='FR' "+
    'ORDER BY CASE w.id WHEN \'FR-TOULOUSE\' THEN 0 WHEN \'FR-PARIS\' THEN 1 ELSE 2 END,'+
    'w.name COLLATE NOCASE'
  ).all();
  return rows.results||[];
}
function freshBoxCode() {
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  return 'BOX-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function boxSlug(name) {
  return String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[łŁ]/g,'L').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,35);
}
async function createBoxWarehouse(env,body,actor) {
  const name=String(body?.name||'').trim().replace(/\s+/g,' ');
  if(name.length<3||name.length>70)return fail('Podaj nazwę magazynu BOX (3–70 znaków).',400);
  const slug=boxSlug(name), id='FR-BOX-'+slug;
  if(!slug||id.length>50)return fail('Podaj poprawną nazwę magazynu.',400);
  const db=env.DB;
  await ensureBoxQrRegistry(db);
  const dupe=await db.prepare(
    'SELECT id FROM warehouses WHERE id=? OR (name=? COLLATE NOCASE AND country_code=\'FR\') LIMIT 1'
  ).bind(id,name).first();
  if(dupe)return fail('Magazyn o tej nazwie lub identyfikatorze już istnieje.',409);
  const code=freshBoxCode();
  await db.batch([
    db.prepare('INSERT INTO warehouses(id,name,country_code,active) VALUES(?,?,\'FR\',1)').bind(id,name),
    db.prepare('INSERT INTO fr_warehouse_qr(warehouse_id,code) VALUES(?,?)').bind(id,code),
    db.prepare('INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),actor,'BOX_CREATE','WAREHOUSE',id,JSON.stringify({name,code}))
  ]);
  return respond({ok:true,warehouse:{id,name,active:1,code}});
}
async function rotateBoxQr(env,body,actor) {
  const id=String(body?.warehouseId||'');
  if(!/^[A-Z0-9-]{3,50}$/.test(id))return fail('Nieprawidłowy magazyn.',400);
  const db=env.DB;
  await ensureBoxQrRegistry(db);
  const row=await db.prepare(
    'SELECT q.code,w.name,w.active FROM fr_warehouse_qr q '+
    "JOIN warehouses w ON w.id=q.warehouse_id WHERE w.country_code='FR' AND w.id=?"
  ).bind(id).first();
  if(!row)return fail('Magazyn nie jest zarejestrowanym magazynem BOX.',404);
  const code=freshBoxCode();
  await db.batch([
    db.prepare('UPDATE fr_warehouse_qr SET code=? WHERE warehouse_id=? AND code=?')
      .bind(code,id,row.code),
    db.prepare('INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),actor,'BOX_QR_ROTATE','WAREHOUSE',id,
        JSON.stringify({previousCode:row.code,code}))
  ]);
  return respond({ok:true,warehouse:{id,name:row.name,active:row.active,code}});
}

async function queryPanel(env,view,url) {
  if(view==='frWeeklySettings')return readFrWeeklySettings(env.DB);
  if(view==='boxQr')return boxQrRows(env.DB);
  if(view==='usage')return adminUsage(env,url);
  if(view==='indexMigration') {
    await ensurePartIndexes(env.DB);
    const result=await env.DB.prepare(
      'SELECT p.id,p.name,p.sap_number,m.old_index,m.new_index,'+
      'm.toulouse_done,m.paris_done,m.old_active '+
      'FROM pl_part_index_migrations m JOIN parts p ON p.id=m.part_id '+
      'WHERE p.active=1 ORDER BY m.new_index LIMIT 5000'
    ).all();
    return {parts:result.results||[]};
  }
  if(view==='summary') {
    const [warehouses, parts, users, marketUsers, oldOperations, tables] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS total,"+
        "COUNT(CASE WHEN country_code='PL' THEN 1 END) AS pl,"+
        "COUNT(CASE WHEN country_code='FR' THEN 1 END) AS fr "+
        "FROM warehouses WHERE active=1 AND country_code IN ('PL','FR')"
      ).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM parts WHERE active=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE active=1").first(),
      env.DB.prepare(
        "SELECT COUNT(DISTINCT CASE WHEN w.country_code='PL' THEN u.id END) AS pl,"+
        "COUNT(DISTINCT CASE WHEN w.country_code='FR' THEN u.id END) AS fr "+
        "FROM users u "+
        "JOIN user_warehouse_access a ON a.user_id=u.id "+
        "JOIN warehouses w ON w.id=a.warehouse_id "+
        "WHERE u.active=1 AND w.active=1 AND w.country_code IN ('PL','FR')"
      ).first(),
      env.DB.prepare(
        "SELECT operation_type AS direction,COUNT(*) AS n "+
        "FROM warehouse_operations WHERE operation_type IN ('PZ','WZ') "+
        "GROUP BY operation_type"
      ).all(),
      env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "+
        "('pl_warehouse_sessions','pl_warehouse_session_lines','pl_nok_session_lines','pl_part_verifications','pl_part_photo_objects','pl_part_photos')"
      ).all()
    ]);
    const existing = new Set((tables.results||[]).map(row=>row.name));
    // Each active catalogue part counts once, even if an old D1 photo and an
    // R2 photo reference coexist during migration.
    const photoSources=[];
    if(existing.has('pl_part_photo_objects'))
      photoSources.push('EXISTS(SELECT 1 FROM pl_part_photo_objects r WHERE r.part_id=p.id)');
    if(existing.has('pl_part_photos'))
      photoSources.push('EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)');
    const photoCount=photoSources.length?await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM parts p WHERE p.active=1 AND ('+
      photoSources.join(' OR ')+')'
    ).first():{n:0};
    const documentCounts = {PZ:0,WZ:0};
    for(const row of oldOperations.results||[]) {
      if(row.direction==='PZ'||row.direction==='WZ')
        documentCounts[row.direction]+=Number(row.n||0);
    }
    // Count one PZ/WZ document per session and direction. Include NOK-only
    // documents, but never count one session twice when both OK and NOK exist.
    if(existing.has('pl_warehouse_sessions')&&existing.has('pl_warehouse_session_lines')){
      const source=existing.has('pl_nok_session_lines')
        ?'SELECT session_id,direction FROM pl_warehouse_session_lines '+
          'UNION SELECT session_id,direction FROM pl_nok_session_lines'
        :'SELECT DISTINCT session_id,direction FROM pl_warehouse_session_lines';
      const sessionCounts=await env.DB.prepare(
        "SELECT direction,COUNT(*) AS n FROM ("+source+") "+
        "WHERE direction IN ('PZ','WZ') GROUP BY direction"
      ).all();
      for(const row of sessionCounts.results||[]) {
        if(row.direction==='PZ'||row.direction==='WZ')
          documentCounts[row.direction]+=Number(row.n||0);
      }
    }
    let overissuedLines=0;
    if(existing.has('pl_warehouse_session_lines')){
      const columns=await env.DB.prepare('PRAGMA table_info(pl_warehouse_session_lines)').all();
      if((columns.results||[]).some(c=>c.name==='shortage_quantity')){
        const overissued=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM pl_warehouse_session_lines "+
          "WHERE direction='WZ' AND shortage_quantity>0"
        ).first();
        overissuedLines=Number(overissued?.n||0);
      }
    }
    const reviewTable=existing.has('pl_part_verifications');
    const waiting=reviewTable?await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pl_part_verifications v JOIN parts p ON p.id=v.part_id WHERE v.status='PENDING' AND p.active=1"
    ).first():null;
    const pendingWarehouses=reviewTable?(await env.DB.prepare(
      'SELECT w.name AS name,COUNT(*) AS count FROM pl_part_verifications v '+
      'JOIN warehouses w ON w.id=v.warehouse_id '+
      'JOIN parts p ON p.id=v.part_id '+
      "WHERE v.status='PENDING' AND w.country_code='PL' AND p.active=1 "+
      'GROUP BY w.id,w.name ORDER BY count DESC,w.name LIMIT 12'
    ).all()).results||[]:[];
    return {
      warehouses:Number(warehouses?.total||0),
      warehouseCounts:{pl:Number(warehouses?.pl||0),fr:Number(warehouses?.fr||0)},
      parts:Number(parts?.n||0),
      photos:Number(photoCount?.n||0),
      operations:documentCounts.PZ+documentCounts.WZ,
      operationCounts:{pz:documentCounts.PZ,wz:documentCounts.WZ},
      users:Number(users?.n||0),
      userCounts:{pl:Number(marketUsers?.pl||0),fr:Number(marketUsers?.fr||0)},
      overissuedLines,pendingParts:Number(waiting?.n||0),pendingWarehouses
    };
  }
  if(view==='warehouses') {
    // Show only actual warehouse records. French BOX QR values are read from
    // the existing registry; printed codes are NEVER rotated by this view.
    const qrTable=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_warehouse_qr'"
    ).first();
    const qrJoin=qrTable?'LEFT JOIN fr_warehouse_qr q ON q.warehouse_id=w.id ':'';
    const qrExpr=qrTable?'MAX(q.code)':'NULL';
    const rows=await env.DB.prepare(
      "SELECT w.id,w.name,w.country_code,w.active,COUNT(s.part_id) AS positions,"+
      "COALESCE(SUM(s.quantity),0) AS units,"+
      "COALESCE("+qrExpr+",CASE w.id WHEN 'FR-TOULOUSE' THEN 'MAG-TL7A2Q' "+
      "WHEN 'FR-PARIS' THEN 'MAG-PA5A4B' ELSE NULL END) AS qr_code "+
      "FROM warehouses w LEFT JOIN warehouse_stock s ON s.warehouse_id=w.id "+
      qrJoin+
      "WHERE w.country_code='PL' OR (w.country_code='FR' AND ("+
      "w.id IN ('FR-TOULOUSE','FR-PARIS','FR-BELLEVILLE') OR "+
      "LOWER(w.name) LIKE '%belleville%')) "+
      "GROUP BY w.id,w.name,w.country_code,w.active "+
      "ORDER BY CASE w.id WHEN 'FR-TOULOUSE' THEN 1 "+
      "WHEN 'FR-PARIS' THEN 2 ELSE CASE WHEN w.country_code='PL' THEN 0 ELSE 3 END END,"+
      "w.name COLLATE NOCASE"
    ).all();
    const result=(rows.results||[]).map(w=>({
      ...w,name:w.id==='FR-TOULOUSE'?'Box Toulouse':
        w.id==='FR-PARIS'?'Box Paryż':w.name
    }));
    if(!result.some(w=>w.country_code==='FR'&&
      /belleville/i.test(w.id+' '+w.name))){
      result.push({id:'',name:'Belleville',country_code:'FR',active:0,
        positions:null,units:null,qr_code:null,not_configured:true});
    }
    return result;
  }
  if(view==='warehouseOptions') {
    const rows=await env.DB.prepare(
      'SELECT id,name,country_code,active FROM warehouses ORDER BY country_code,name'
    ).all();
    return rows.results||[];
  }
  if(view==='vehicleParts')return getVehicleCatalogue(env.DB);
  if(view==='boxParts') {
    // Admin-only scoped view. The 78-item list is from Google Stock FR GPBS.
    // Prefer D1 quantities only when the entire warehouse import is present;
    // otherwise identify the figures as an external spreadsheet snapshot.
    const ids=BOX_CATALOG_SNAPSHOT.map(p=>p.part_id);
    const questionMarks=ids.map(()=>'?').join(',');
    const hasIndexMap=await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
    ).first();
    const details=await env.DB.prepare(
      'SELECT p.id,p.name,p.part_number,p.sap_number'+
      (hasIndexMap?',ix.new_index':'')+
      ' FROM parts p '+
      (hasIndexMap?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
      'WHERE p.id IN ('+questionMarks+') AND p.active=1'
    ).bind(...ids).all();
    const byId=new Map((details.results||[]).map(p=>[p.id,p]));
    const rows=await env.DB.prepare(
      "SELECT warehouse_id,part_id,quantity FROM warehouse_stock "+
      "WHERE warehouse_id IN ('FR-TOULOUSE','FR-PARIS') AND part_id IN ("+
      questionMarks+")"
    ).bind(...ids).all();
    const quantities=new Map();
    const warehouseCounts={toulouse:0,paris:0};
    for(const row of rows.results||[]){
      const place=row.warehouse_id==='FR-TOULOUSE'?'toulouse':
        row.warehouse_id==='FR-PARIS'?'paris':null;
      if(!place)continue;
      quantities.set(place+'|'+row.part_id,Number(row.quantity));
      warehouseCounts[place]++;
    }
    const fromD1={toulouse:warehouseCounts.toulouse===ids.length,
      paris:warehouseCounts.paris===ids.length};
    const parts=BOX_CATALOG_SNAPSHOT.map(item=>{
      const part=byId.get(item.part_id);
      return {
        id:item.part_id,
        name:part?.name||item.name,
        part_number:part?.new_index||part?.part_number||item.source_code,
        source_code:item.source_code,
        legacy_index:item.legacy_index,
        sap_number:item.sap||part?.sap_number||'',
        paris:fromD1.paris?quantities.get('paris|'+item.part_id):item.paris,
        toulouse:fromD1.toulouse?quantities.get('toulouse|'+item.part_id):item.toulouse,
        part_found:Boolean(part)
      };
    });
    return {parts,fromD1,matchedParts:byId.size,
      expectedParts:BOX_CATALOG_SNAPSHOT.length,
      snapshotDate:'11.11.2026'};
  }
  if(view==='parts') {
    // A single catalogue is shared by every market; stock belongs to warehouses.
    const verification=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_verifications'"
    ).first();
    const hasPhotos=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
    ).first();
    const hasR2Photos=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photo_objects'"
    ).first();
    const hasIndices=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
    ).first();
    const photoFlags=[
      hasR2Photos?'EXISTS(SELECT 1 FROM pl_part_photo_objects r2 WHERE r2.part_id=p.id)':null,
      hasPhotos?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
    ].filter(Boolean).join(' OR ');
    const rows=await env.DB.prepare(
      'SELECT p.id,'+
      (hasIndices?'COALESCE(ix.new_index,p.part_number) AS part_number,ix.old_index,'
        :'p.part_number,NULL AS old_index,')+
      'p.name,p.sap_number '+
      (verification?' ,v.status AS verification_status ':' ,NULL AS verification_status ')+
      (photoFlags?' ,('+photoFlags+') AS has_photo ':
        ' ,0 AS has_photo ')+
      'FROM parts p '+
      (hasIndices?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
      (verification?'LEFT JOIN pl_part_verifications v ON v.part_id=p.id ':'')+
      'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE LIMIT 3000'
    ).all();
    return {parts:rows.results||[]};
  }
  if(view==='newParts') {
    const ready=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_verifications'"
    ).first();
    if(!ready)return {parts:[]};
    const hasPhotos=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
    ).first();
    const hasR2Photos=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photo_objects'"
    ).first();
    const hasIndices=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
    ).first();
    const photoFlags=[
      hasR2Photos?'EXISTS(SELECT 1 FROM pl_part_photo_objects r2 WHERE r2.part_id=p.id)':null,
      hasPhotos?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
    ].filter(Boolean).join(' OR ');
    const rows=await env.DB.prepare(
      'SELECT p.id,'+
      (hasIndices?'COALESCE(ix.new_index,p.part_number) AS part_number,ix.old_index,'
        :'p.part_number,NULL AS old_index,')+
      'p.name,p.sap_number,'+
      'v.status AS verification_status,v.created_at AS added_at,'+
      'w.name AS warehouse_name,v.warehouse_id,COALESCE(u.name,v.created_by) AS added_by,'+
      (photoFlags?'('+photoFlags+') AS has_photo ':
        '0 AS has_photo ')+
      'FROM pl_part_verifications v JOIN parts p ON p.id=v.part_id '+
      (hasIndices?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
      'JOIN warehouses w ON w.id=v.warehouse_id '+
      'LEFT JOIN users u ON u.id=v.created_by '+
      "WHERE v.status='PENDING' AND w.country_code='PL' AND p.active=1 "+
      'ORDER BY v.created_at DESC,v.part_id DESC LIMIT 1000'
    ).all();
    return {parts:rows.results||[]};
  }
  if(view==='movements') {
    // Historical operations and NEW mixed PZ/WZ sessions use separate tables.
    // Previous panel only queried warehouse_operations, making every new session invisible.
    const indexed=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
    ).first();
    const sessionSchema=await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' "+
      "AND name IN ('pl_warehouse_sessions','pl_warehouse_session_lines')"
    ).first();
    const queries=[
      env.DB.prepare(
        'SELECT o.id,o.id AS session_id,o.operation_type,o.warehouse_id,'+
        "o.operator_id,COALESCE(u.name,o.operator_id) AS operator_name,"+
        'o.recipient_name,o.created_at,p.name AS part_name,'+
        (indexed?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,'+
        'l.quantity_delta,l.quantity_before,l.quantity_after,'+
        '0 AS shortage_quantity,0 AS before_unknown '+
        'FROM warehouse_operations o JOIN warehouse_operation_lines l ON l.operation_id=o.id '+
        'JOIN parts p ON p.id=l.part_id '+
        (indexed?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'LEFT JOIN users u ON u.id=o.operator_id '+
        'ORDER BY o.created_at DESC,o.id DESC LIMIT 250'
      ).all()
    ];
    if(Number(sessionSchema?.n)===2){
      const columns=await env.DB.prepare('PRAGMA table_info(pl_warehouse_session_lines)').all();
      const hasUnknownFlag=(columns.results||[]).some(c=>c.name==='before_unknown');
      const originalQuantity=hasUnknownFlag
        ?'CASE WHEN l.before_unknown=1 THEN NULL ELSE l.quantity_before END'
        :'l.quantity_before';
      const shortageColumn=(columns.results||[]).some(c=>c.name==='shortage_quantity')
        ?'l.shortage_quantity':'0';
      const unknownColumn=hasUnknownFlag?'l.before_unknown':'0';
      queries.push(env.DB.prepare(
        'SELECT s.id,s.id AS session_id,l.direction AS operation_type,'+
        's.warehouse_id,s.actor_id AS operator_id,'+
        'COALESCE(u.name,s.actor_id) AS operator_name,'+
        's.counterparty AS recipient_name,s.committed_at AS created_at,'+
        'p.name AS part_name,'+
        (indexed?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,'+
        "CASE WHEN l.direction='PZ' THEN l.quantity ELSE -l.quantity END AS quantity_delta,"+
        originalQuantity+' AS quantity_before,l.quantity_after,'+
        shortageColumn+' AS shortage_quantity,'+unknownColumn+' AS before_unknown '+
        'FROM pl_warehouse_sessions s '+
        'JOIN pl_warehouse_session_lines l ON l.session_id=s.id '+
        'JOIN parts p ON p.id=l.part_id '+
        (indexed?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'LEFT JOIN users u ON u.id=s.actor_id '+
        'ORDER BY s.committed_at DESC,s.id DESC LIMIT 250'
      ).all());
    }
    const results=await Promise.all(queries);
    return results.flatMap(x=>x.results||[])
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)) ||
        String(b.id).localeCompare(String(a.id)))
      .slice(0,250);
  }
  // Only chief ADMIN accesses private contact fields in this combined view.
  if(view==='users') {
    // Archive is optional until db/06-user-archive.sql has been executed.
    const hasArchiveTable=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_archives'"
    ).first();
    const claimTable=Boolean(await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_car_claims'"
    ).first());
    const carTables=(await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fr_vehicle_usage','vehicles')"
    ).all()).results||[];
    const hasCars=carTables.length===2;
    const realPlate=hasCars
      ?"(SELECT v.registration_number FROM fr_vehicle_usage a JOIN vehicles v "+
       "ON v.id=a.vehicle_id WHERE a.user_id=u.id LIMIT 1)"
      :'NULL';
    const pendingPlate=claimTable
      ?"(SELECT c.requested_plate FROM fr_car_claims c WHERE c.user_id=u.id AND c.status='PENDING')"
      :'NULL';
    const pendingInventory=claimTable
      ?"(SELECT CASE WHEN c.inventory_json IS NULL THEN 0 ELSE 1 END "+
       "FROM fr_car_claims c WHERE c.user_id=u.id AND c.status='PENDING')"
      :'NULL';
    const archived=url.searchParams.get('archived')==='1';
    if(archived&&!hasArchiveTable)return [];
    const rows=await env.DB.prepare(
      'SELECT u.id,u.name,u.role_code,u.active,u.created_at,'+
      'pr.first_name,pr.last_name,pr.phone,pr.display_code, '+
      'CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS has_pin, '+
      'COALESCE('+realPlate+",'') AS car_plate, "+
      'COALESCE('+pendingPlate+",'') AS car_pending_plate, "+
      'COALESCE('+pendingInventory+',0) AS car_pending_inventory, '+
      "COALESCE((SELECT GROUP_CONCAT(a.warehouse_id, ', ') FROM user_warehouse_access a WHERE a.user_id=u.id),'') AS warehouses, "+
      "COALESCE((SELECT GROUP_CONCAT(DISTINCT w.country_code) FROM user_warehouse_access a "+
      "JOIN warehouses w ON w.id=a.warehouse_id WHERE a.user_id=u.id),'') AS warehouse_countries "+
      'FROM users u '+
      'LEFT JOIN user_pin_credentials p ON p.user_id=u.id '+
      'LEFT JOIN user_private_profiles pr ON pr.user_id=u.id '+

      (hasArchiveTable?'LEFT JOIN user_archives ar ON ar.user_id=u.id ':'')+
      (hasArchiveTable
        ? (archived?'WHERE ar.user_id IS NOT NULL ':'WHERE ar.user_id IS NULL ')
        : '')+
      'ORDER BY u.active DESC,u.name COLLATE NOCASE LIMIT 500'
    ).all();
    return effectiveAccessByUsers(env.DB,rows.results||[]);
  }
  if(view==='pinStatus')return {
    available:typeof env.PIN_PEPPER==='string'&&env.PIN_PEPPER.length>=32
  };
  if(view==='roles') {
    const rows=await env.DB.prepare('SELECT code,name FROM user_roles ORDER BY code').all();
    return rows.results||[];
  }
  throw new Error('Nieznany widok panelu.');
}

async function addUser(env, body, actor) {
  const name=String(body?.name||'').trim();
  const role=String(body?.role||'').trim().toUpperCase();
  const warehouses=body?.warehouses;
  if(name.length<2||name.length>100 || !ALLOWED_ROLES.has(role) ||
    !Array.isArray(warehouses)||warehouses.length>20 ||
    new Set(warehouses).size!==warehouses.length ||
    warehouses.some(id=>typeof id!=='string'||!/^[A-Z0-9-]{2,50}$/.test(id)))
    return fail('Sprawdź nazwę, rolę i przypisania magazynów.',400);
  const match=await env.DB.prepare('SELECT code FROM user_roles WHERE code=?').bind(role).first();
  if(!match) return fail('Nie znaleziono roli.',400);
  for(const id of warehouses) {
    if(!await env.DB.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').bind(id).first())
      return fail('Wybrany magazyn nie jest aktywny: '+id,400);
  }
  const id='GPBS-U-'+crypto.randomUUID();
  const statements=[
    env.DB.prepare('INSERT INTO users (id,name,role_code,active) VALUES (?,?,?,1)').bind(id,name,role)
  ];
  for(const warehouseId of warehouses)
    statements.push(env.DB.prepare(
      'INSERT INTO user_warehouse_access (user_id,warehouse_id) VALUES (?,?)'
    ).bind(id,warehouseId));
  const audited=await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE name='panel_audit_log' AND type='table'"
  ).first();
  if(!audited)return fail('Najpierw wykonaj SQL: db/04-panel-audit.sql',503);
  statements.push(env.DB.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),actor,'USER_CREATE','USER',id,
    JSON.stringify({name,role,warehouses})));
  await env.DB.batch(statements);
  return respond({ok:true,user:{id,name,role,warehouses},pinAssigned:false});
}

async function updateUser(env, body, actor) {
  const id=String(body.userId||'');
  const name=String(body.name||'').trim();
  const role=String(body.role||'').trim().toUpperCase();
  const active=body.active;
  const warehouses=body.warehouses;
  if(!/^GPBS-U-[a-f0-9-]{36}$/.test(id)||name.length<2||name.length>100||
     !ALLOWED_ROLES.has(role)||(active!==0&&active!==1)||
     !Array.isArray(warehouses)||warehouses.length>20||
     new Set(warehouses).size!==warehouses.length||
     warehouses.some(x=>typeof x!=='string'||!/^[A-Z0-9-]{2,50}$/.test(x))) {
    return fail('Sprawdź dane użytkownika.',400);
  }
  const existing=await env.DB.prepare('SELECT id,name,role_code,active FROM users WHERE id=?').bind(id).first();
  if(!existing)return fail('Nie znaleziono użytkownika.',404);
  if(await isProtectedOwnerRecord(env.DB,existing))
    return fail('Nie można zmienić konta właściciela przez ten panel.',403);
  if(await archiveTableExists(env.DB)&&
     await env.DB.prepare('SELECT user_id FROM user_archives WHERE user_id=?').bind(id).first())
    return fail('Konto w archiwum. Użyj najpierw opcji Przywróć.',409);
  if(!await env.DB.prepare('SELECT code FROM user_roles WHERE code=?').bind(role).first())
    return fail('Nieznana rola.',400);
  const assigned=(await env.DB.prepare('SELECT warehouse_id FROM user_warehouse_access WHERE user_id=?').bind(id).all()).results.map(row=>row.warehouse_id);
  for(const warehouseId of warehouses) {
    const warehouse=await env.DB.prepare('SELECT active FROM warehouses WHERE id=?').bind(warehouseId).first();
    if(!warehouse||(!warehouse.active&&!assigned.includes(warehouseId)))
      return fail('Magazyn niedostępny: '+warehouseId,400);
  }
  const audited=await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='panel_audit_log' AND type='table'").first();
  if(!audited)return fail('Najpierw wykonaj SQL: db/04-panel-audit.sql',503);
  const stmts=[
    env.DB.prepare('UPDATE users SET name=?,role_code=?,active=? WHERE id=?').bind(name,role,active,id),
    env.DB.prepare('DELETE FROM user_warehouse_access WHERE user_id=?').bind(id),
    ...warehouses.map(x=>env.DB.prepare('INSERT INTO user_warehouse_access(user_id,warehouse_id) VALUES(?,?)').bind(id,x)),
    env.DB.prepare('INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),actor,'USER_UPDATE','USER',id,JSON.stringify({before:existing,after:{name,role,active,warehouses}}))
  ];
  await env.DB.batch(stmts);
  return respond({ok:true,userId:id,pinUnchanged:true});
}

// Private staff details: stored separately from users.name (public greeting).
function normalizeStaff(body) {
  const nickname=String(body?.nickname||'').trim();
  const first=String(body?.firstName||'').trim();
  const last=String(body?.lastName||'').trim();
  const phone=String(body?.phone||'').trim();
  const role=String(body?.role||'').trim().toUpperCase();
  const warehouses=body?.warehouses;
  const active=body?.active===undefined?1:body.active;
  if(nickname.length<2||nickname.length>100||
     first.length>60||last.length>80||
     phone.length>28||(phone&&!/^[+0-9() .-]+$/.test(phone))||
     (phone&&(phone.match(/[0-9]/g)||[]).length<6)||
     !ALLOWED_ROLES.has(role)||(![0,1].includes(active))||
     !Array.isArray(warehouses)||warehouses.length>20||
     new Set(warehouses).size!==warehouses.length||
     warehouses.some(w=>typeof w!=='string'||!/^[A-Z0-9-]{2,50}$/.test(w))) return null;
  return {nickname,first,last,phone,role,warehouses,active};
}

// A nickname such as MT remains MT. Longer names get compact initials.
function symbolFromNickname(nickname) {
  const normalize=word=>word.replace(/[Łł]/g,'L').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  const words=nickname.split(/\s+/).map(normalize).filter(Boolean);
  if(!words.length)return 'UZ';
  const value=words.length>1
    ? words.map(w=>w[0]).join('')
    : words[0];
  return value.slice(0,10).padEnd(2,'X');
}

async function chooseStaffCode(db,staff,userId='',previous=null) {
  const root=(previous?.name===staff.nickname && previous?.display_code)
    ? previous.display_code : symbolFromNickname(staff.nickname);
  for(let i=1;i<=99;i++) {
    const candidate=i===1?root:root.slice(0,12-String(i).length)+String(i);
    const occupied=await db.prepare(
      'SELECT user_id FROM user_private_profiles WHERE display_code = ? COLLATE NOCASE'
    ).bind(candidate).first();
    if(!occupied || occupied.user_id===userId) return candidate;
  }
  return null;
}

async function requireStaffSchema(db) {
  const rows=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('panel_audit_log','user_private_profiles')"
  ).all();
  return new Set((rows.results||[]).map(row=>row.name)).size===2;
}

async function validateStaffWarehouses(db,staff,previous=[]) {
  if(!await db.prepare('SELECT code FROM user_roles WHERE code=?').bind(staff.role).first())
    return 'Nie znaleziono wybranej roli.';
  for(const id of staff.warehouses) {
    const wh=await db.prepare('SELECT id,active FROM warehouses WHERE id=?').bind(id).first();
    if(!wh||(!wh.active&&!previous.includes(id)))return 'Magazyn jest niedostępny: '+id;
  }
  return '';
}

async function staffMutation(env,body,actor,edit) {
  const db=env.DB;
  const staff=normalizeStaff(body);
  if(!staff) return fail('Podaj użytkownika, rolę i poprawne dane kontaktowe, jeśli je wpisujesz.',400);
  if(!await requireStaffSchema(db))
    return fail('Najpierw wykonaj migrację db/05-user-private-profiles.sql w D1.',503);
  const id=edit?String(body.userId||''):'GPBS-U-'+crypto.randomUUID();
  let before=null,prior=[];
  if(edit) {
    if(!/^GPBS-U-[a-f0-9-]{36}$/.test(id))return fail('Niepoprawne konto.',400);
    before=await db.prepare(
      'SELECT u.id,u.name,u.role_code,u.active,p.first_name,p.last_name,p.phone,p.display_code '+
      'FROM users u LEFT JOIN user_private_profiles p ON p.user_id=u.id WHERE u.id=?'
    ).bind(id).first();
    if(!before)return fail('Nie znaleziono użytkownika.',404);
    if(await archiveTableExists(db)) {
      const archived=await db.prepare('SELECT user_id FROM user_archives WHERE user_id=?').bind(id).first();
      if(archived)return fail('Użytkownik jest archiwalny. Najpierw go przywróć.',409);
    }
    prior=(await db.prepare('SELECT warehouse_id FROM user_warehouse_access WHERE user_id=?')
      .bind(id).all()).results.map(r=>r.warehouse_id);
    if(await isProtectedOwnerRecord(db,before)){
      // Allow optional contact edits only. Owner identity, role, status, and grants stay fixed.
      const unchangedGrants=prior.length===staff.warehouses.length &&
        prior.every(w=>staff.warehouses.includes(w));
      if(staff.nickname!==before.name||staff.role!==before.role_code||
         staff.active!==1||before.active!==1||!unchangedGrants)
        return fail('Konto właściciela: identyfikator, rola, status i uprawnienia są chronione.',403);
    }
  }
  // The short visible nickname must identify one account unambiguously.
  const nicknameUsed=await db.prepare(
    'SELECT id FROM users WHERE name = ? COLLATE NOCASE AND id <> ? LIMIT 1'
  ).bind(staff.nickname,id).first();
  if(nicknameUsed) return fail('Taki identyfikator użytkownika już istnieje.',409);
  const error=await validateStaffWarehouses(db,staff,prior);
  if(error)return fail(error,400);
  const code=await chooseStaffCode(db,staff,id,before);
  if(!code)return fail('Symbol jest zajęty. Wybierz inny.',409);

  if(staff.role==='EKIPA' && !['PL','FR'].includes(String(body.crewMarket||'')))
    return fail('Wybierz rynek ekipy: Polska albo Francja.',400);
  if(staff.role==='EKIPA')await ensureAccessTable(db);
  const stmts=[];
  if(edit) {
    stmts.push(db.prepare('UPDATE users SET name=?,role_code=?,active=? WHERE id=?')
      .bind(staff.nickname,staff.role,staff.active,id));
    stmts.push(db.prepare(
      'INSERT INTO user_private_profiles (user_id,first_name,last_name,phone,display_code) '+
      'VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET '+
      'first_name=excluded.first_name,last_name=excluded.last_name,'+
      'phone=excluded.phone,display_code=excluded.display_code,updated_at=CURRENT_TIMESTAMP'
    ).bind(id,staff.first,staff.last,staff.phone||null,code));
    stmts.push(db.prepare('DELETE FROM user_warehouse_access WHERE user_id=?').bind(id));
  } else {
    stmts.push(db.prepare('INSERT INTO users (id,name,role_code,active) VALUES (?,?,?,?)')
      .bind(id,staff.nickname,staff.role,staff.active));
    stmts.push(db.prepare(
      'INSERT INTO user_private_profiles (user_id,first_name,last_name,phone,display_code) VALUES (?,?,?,?,?)'
    ).bind(id,staff.first,staff.last,staff.phone||null,code));
  }
  for(const wh of staff.warehouses) {
    stmts.push(db.prepare('INSERT INTO user_warehouse_access (user_id,warehouse_id) VALUES (?,?)')
      .bind(id,wh));
  }
  if(staff.role==='EKIPA'){
    stmts.push(db.prepare(
      'INSERT INTO user_access_settings(user_id,pl_enabled,fr_enabled) VALUES(?,?,?) '+
      'ON CONFLICT(user_id) DO UPDATE SET pl_enabled=excluded.pl_enabled,'+
      'fr_enabled=excluded.fr_enabled,updated_at=CURRENT_TIMESTAMP'
    ).bind(id,body.crewMarket==='PL'?1:0,body.crewMarket==='FR'?1:0));
  }
  // Audit stores the symbol, role and warehouse assignment, NEVER phone numbers.
  stmts.push(db.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),actor,edit?'STAFF_UPDATE':'STAFF_CREATE','USER',id,
    JSON.stringify({nickname:staff.nickname,code,role:staff.role,active:staff.active,warehouses:staff.warehouses})));
  await db.batch(stmts);
  return respond({ok:true,userId:id,nickname:staff.nickname,displayCode:code,pinUnchanged:true});
}


// Permanent removal is intentionally restricted to crew accounts without
// operational history. Never touch warehouse_stock, movements or inventories.
async function permanentlyDeleteUnusedCrew(env,body) {
  const id=String(body?.userId||'');
  if(!id||id.length>150||/[\u0000-\u001f]/.test(id))return fail('Nieprawidłowy identyfikator ekipy.',400);
  const db=env.DB;
  const user=await db.prepare('SELECT id,name,role_code FROM users WHERE id=?').bind(id).first();
  if(!user)return fail('Nie znaleziono ekipy. Odśwież listę użytkowników.',404);
  if(user.role_code!=='EKIPA')return fail('Trwale można usuwać tylko konta ekip.',403);
  if(await isProtectedOwnerRecord(db,user))return fail('Konto chronione.',403);
  const realSessions=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fr_sessions','fr_session_lines')"
  ).all();
  const realSessionTables=new Set((realSessions.results||[]).map(x=>x.name));
  if(realSessionTables.has('fr_sessions')&&realSessionTables.has('fr_session_lines')){
    const hasLiveOperations=await db.prepare(
      'SELECT 1 FROM fr_sessions s JOIN fr_session_lines l ON l.session_id=s.id '+
      'WHERE s.user_id=? LIMIT 1'
    ).bind(id).first();
    if(hasLiveOperations)return fail(
      'Ekipa ma pobrania lub zwroty zapisane na rzeczywistych stanach. Nie usunięto ich automatycznie.',409);
  }
  if(await isFrTestAccount(db,id)){
    // Legacy separated test records are removed, as well as any car-only
    // inventories recorded after restoring the normal mobile workflow.
    // The real tables warehouse_stock, vehicle_stock and fr_* are untouched.
    const others=await db.prepare(
      'SELECT 1 FROM fr_test_accounts WHERE user_id<>? LIMIT 1'
    ).bind(id).first();
    const hasTestHandover=Boolean(await db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_test_vehicle_handovers'"
    ).first());
    const statements=[
      db.prepare('DELETE FROM fr_test_vehicle_event_fingerprints WHERE event_id IN (SELECT id FROM fr_test_vehicle_events WHERE user_id=?)').bind(id),
      db.prepare('DELETE FROM fr_test_vehicle_event_lines WHERE event_id IN (SELECT id FROM fr_test_vehicle_events WHERE user_id=?)').bind(id),
      db.prepare('DELETE FROM fr_test_vehicle_events WHERE user_id=?').bind(id),
      db.prepare('DELETE FROM fr_test_session_lines WHERE session_id IN (SELECT id FROM fr_test_sessions WHERE user_id=?)').bind(id),
      db.prepare('DELETE FROM fr_test_sessions WHERE user_id=?').bind(id),
      db.prepare('DELETE FROM fr_test_visits WHERE user_id=?').bind(id),
      db.prepare('DELETE FROM fr_test_vehicle_usage WHERE user_id=?').bind(id),
      db.prepare('DELETE FROM fr_test_accounts WHERE user_id=?').bind(id)
    ];
    if(hasTestHandover)statements.push(
      db.prepare('DELETE FROM fr_test_vehicle_handovers WHERE user_id=?').bind(id)
    );
    // Remove vehicle-only trial history without modifying actual BOX stock.
    const frTables=(await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
      "'fr_car_claims','fr_vehicle_events','fr_vehicle_event_lines',"+
      "'fr_vehicle_event_fingerprints','fr_vehicle_usage','fr_vehicle_handovers',"+
      "'fr_visits','fr_sessions','fr_session_lines')"
    ).all()).results||[];
    const has=new Set(frTables.map(t=>t.name));
    if(has.has('fr_car_claims'))
      statements.push(db.prepare('DELETE FROM fr_car_claims WHERE user_id=?').bind(id));
    if(has.has('fr_vehicle_events')){
      if(has.has('fr_vehicle_event_fingerprints'))statements.push(db.prepare(
        'DELETE FROM fr_vehicle_event_fingerprints WHERE event_id IN (SELECT id FROM fr_vehicle_events WHERE user_id=?)'
      ).bind(id));
      if(has.has('fr_vehicle_event_lines'))statements.push(db.prepare(
        'DELETE FROM fr_vehicle_event_lines WHERE event_id IN (SELECT id FROM fr_vehicle_events WHERE user_id=?)'
      ).bind(id));
      statements.push(db.prepare('DELETE FROM fr_vehicle_events WHERE user_id=?').bind(id));
    }
    if(has.has('fr_vehicle_handovers'))
      statements.push(db.prepare('DELETE FROM fr_vehicle_handovers WHERE user_id=?').bind(id));
    if(has.has('fr_vehicle_usage'))
      statements.push(db.prepare('DELETE FROM fr_vehicle_usage WHERE user_id=?').bind(id));
    if(has.has('fr_sessions')){
      if(has.has('fr_session_lines'))statements.push(db.prepare(
        'DELETE FROM fr_session_lines WHERE session_id IN (SELECT id FROM fr_sessions WHERE user_id=?)'
      ).bind(id));
      statements.push(db.prepare('DELETE FROM fr_sessions WHERE user_id=?').bind(id));
    }
    if(has.has('fr_visits'))
      statements.push(db.prepare('DELETE FROM fr_visits WHERE user_id=?').bind(id));

    if(!others){
      // Last test crew: discard all fake cars and BOX snapshots together.
      statements.push(db.prepare('DELETE FROM fr_test_vehicle_stock'));
      statements.push(db.prepare('DELETE FROM fr_test_vehicles'));
      statements.push(db.prepare('DELETE FROM fr_test_warehouse_stock'));
      statements.push(db.prepare('DELETE FROM fr_test_warehouse_snapshots'));
    }
    const existingTables=(await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
      "'user_private_profiles','user_warehouse_access','user_pin_credentials',"+
      "'user_access_settings','user_archives','panel_audit_log')"
    ).all()).results||[];
    const tableNames=new Set(existingTables.map(row=>row.name));
    for(const table of ['user_private_profiles','user_warehouse_access',
      'user_pin_credentials','user_access_settings','user_archives']){
      if(tableNames.has(table))
        statements.push(db.prepare('DELETE FROM '+table+' WHERE user_id=?').bind(id));
    }
    if(tableNames.has('panel_audit_log'))statements.push(db.prepare(
      "DELETE FROM panel_audit_log WHERE target_type='USER' AND target_id=?"
    ).bind(id));
    statements.push(db.prepare("DELETE FROM users WHERE id=? AND role_code='EKIPA'").bind(id));
    await db.batch(statements);
    return respond({ok:true,userId:id,
      message:'Usunięto ekipę testową i jej testowe operacje. Prawdziwe stany pozostały bez zmian.'});
  }


  // Fetch the schemas in one request; D1 Free has limits per Worker invocation.
  // Introspect ONLY operational tables that might reference this account.
  const rows=(await db.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all()).results||[];
  const present=new Set(rows.map(t=>t.name));
  const metadata=new Set(['user_private_profiles','user_warehouse_access',
    'user_pin_credentials','user_access_settings','user_archives','fr_vehicle_usage',
    'fr_car_claims','fr_vehicle_handovers']);
  const visitTables=new Set(['fr_visits','fr_sessions','fr_vehicle_events']);
  const possibleColumns=new Set(['user_id','actor_id','operator_id','created_by',
    'team_id','assigned_by','reviewed_by','performed_by','verified_by',
    'approved_by','submitted_by','owner_user_id','updated_by','archived_by',
    'issued_by','received_by']);
  for(const entry of rows){
    const table=String(entry.name||'');
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)||table==='users'||
       metadata.has(table)||visitTables.has(table))continue;
    const schema=String(entry.sql||'').toLowerCase();
    if(![...possibleColumns].some(col=>schema.includes(col)) &&
       !/\breferences\s+["']?users\b/i.test(schema))continue;
    const cols=(await db.prepare('PRAGMA table_info("'+table+'")').all()).results||[];
    const refColumns=new Set(cols.map(c=>c.name).filter(name=>possibleColumns.has(name)));
    if(/\breferences\s+["']?users\b/i.test(schema)){
      const fks=(await db.prepare('PRAGMA foreign_key_list("'+table+'")').all()).results||[];
      for(const fk of fks)if(String(fk.table).toLowerCase()==='users')
        refColumns.add(fk.from);
    }
    for(const col of refColumns){
      if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col))continue;
      const found=await db.prepare('SELECT 1 FROM "'+table+'" WHERE "'+col+'"=? LIMIT 1')
        .bind(id).first();
      if(found)return fail(
        'Nie usunięto ekipy: ma powiązane dane ('+table+'). Stany pozostają bez zmian.',409);
    }
  }
  const hasSessions=present.has('fr_sessions');
  const hasLines=present.has('fr_session_lines');
  if(hasSessions&&hasLines){
    const changed=await db.prepare(
      'SELECT 1 FROM fr_sessions s JOIN fr_session_lines l ON l.session_id=s.id '+
      "WHERE s.user_id=? GROUP BY s.id,l.part_id HAVING "+
      "SUM(CASE WHEN l.direction='ZWROT' THEN l.quantity ELSE -l.quantity END)<>0 LIMIT 1"
    ).bind(id).first();
    if(changed)return fail(
      'Nie można skasować ekipy: ma operacje zmieniające stany magazynowe. Żadnych stanów nie zmieniono.',409);
  }

  const statements=[];
  if(present.has('fr_vehicle_events')){
    if(present.has('fr_vehicle_event_fingerprints'))statements.push(db.prepare(
      'DELETE FROM fr_vehicle_event_fingerprints WHERE event_id IN (SELECT id FROM fr_vehicle_events WHERE user_id=?)'
    ).bind(id));
    if(present.has('fr_vehicle_event_lines'))statements.push(db.prepare(
      'DELETE FROM fr_vehicle_event_lines WHERE event_id IN (SELECT id FROM fr_vehicle_events WHERE user_id=?)'
    ).bind(id));
    statements.push(db.prepare('DELETE FROM fr_vehicle_events WHERE user_id=?').bind(id));
  }
  if(hasSessions&&hasLines)statements.push(db.prepare(
    'DELETE FROM fr_session_lines WHERE session_id IN (SELECT id FROM fr_sessions WHERE user_id=?)'
  ).bind(id));
  if(hasSessions)statements.push(db.prepare('DELETE FROM fr_sessions WHERE user_id=?').bind(id));
  if(present.has('fr_visits'))
    statements.push(db.prepare('DELETE FROM fr_visits WHERE user_id=?').bind(id));
  for(const table of metadata)if(present.has(table)){
    statements.push(db.prepare('DELETE FROM "'+table+'" WHERE user_id=?').bind(id));
  }
  // AA and other unused fictitious crews should not survive in Admin history.
  if(present.has('panel_audit_log'))
    statements.push(db.prepare(
      "DELETE FROM panel_audit_log WHERE target_type='USER' AND target_id=?"
    ).bind(id));
  statements.push(db.prepare("DELETE FROM users WHERE id=? AND role_code='EKIPA'").bind(id));
  await db.batch(statements);
  return respond({ok:true,userId:id,message:'Ekipa została trwale usunięta z D1.'});
}

async function archiveTableExists(db) {
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_archives'"
  ).first());
}

async function changeStaffArchive(env,body,actor,restore) {
  const id=String(body?.userId||'');
  if(!/^GPBS-U-[a-f0-9-]{36}$/.test(id))return fail('Nieprawidłowe konto.',400);
  const db=env.DB;
  if(!await archiveTableExists(db))
    return fail('Najpierw wykonaj migrację db/06-user-archive.sql w Cloudflare D1.',503);
  const user=await db.prepare('SELECT id,name,role_code,active FROM users WHERE id=?').bind(id).first();
  if(!user)return fail('Nie znaleziono użytkownika.',404);
  if(await isProtectedOwnerRecord(db,user))return fail('Konta właściciela nie można zarchiwizować.',403);
  const archive=await db.prepare('SELECT user_id FROM user_archives WHERE user_id=?').bind(id).first();
  if(restore&&!archive)return fail('To konto nie jest zarchiwizowane.',409);
  if(!restore&&archive)return fail('Konto zostało już zarchiwizowane.',409);

  // History and immutable ID must survive. Archive deactivates immediately
  // and removes the D1 PIN digest. Restore never reactivates automatically.
  const statements=restore
    ? [
      db.prepare('DELETE FROM user_archives WHERE user_id=?').bind(id),
      db.prepare('UPDATE users SET active=0 WHERE id=?').bind(id)
    ]
    : [
      db.prepare('UPDATE users SET active=0 WHERE id=?').bind(id),
      db.prepare('DELETE FROM user_pin_credentials WHERE user_id=?').bind(id),
      db.prepare('INSERT INTO user_archives(user_id,archived_by) VALUES (?,?)').bind(id,actor)
    ];
  statements.push(db.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES (?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),actor,restore?'USER_RESTORED':'USER_ARCHIVED','USER',id,
    JSON.stringify({nickname:user.name,previousActive:user.active,restoredInactive:restore})));
  await db.batch(statements);
  return respond({ok:true,userId:id,archived:!restore,active:0,
    message:restore?'Przywrócono konto jako nieaktywne. Nadaj PIN i aktywuj, jeśli ma pracować.':
      'Konto przeniesiono do archiwum. ID i historia pozostają bez zmian.'});
}

/* D1 PIN provisioning, separate from legacy French PIN login.
   Only a signed ADMIN session may generate/reset. A secret server-side
   HMAC key permits uniqueness checking without storing 4-digit PINs. */
const RESERVED_STAFF_PINS = new Set(['0000','1111','1234']);
const MAX_PIN_BATCH = 100;
const MAX_PIN_RETRIES = 200;

function randomStaffPin() {
  const bytes=new Uint16Array(1);
  for(;;) {
    crypto.getRandomValues(bytes);
    if(bytes[0]>=60000)continue; // eliminate modulo bias
    const pin=String(bytes[0]%10000).padStart(4,'0');
    if(!RESERVED_STAFF_PINS.has(pin))return pin;
  }
}

async function staffPinKey(env) {
  return crypto.subtle.importKey('raw',enc.encode(env.PIN_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
}

async function staffPinDigest(key,pin) {
  const bytes=await crypto.subtle.sign('HMAC',key,
    enc.encode('GPBS:D1:PIN:v1:'+pin));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}

async function issueStaffPin(db,key,user,actor,reset=false) {
  const prior=await db.prepare(
    'SELECT pin_digest FROM user_pin_credentials WHERE user_id=?'
  ).bind(user.id).first();
  if(!reset&&prior)return {status:'ALREADY_ASSIGNED',userId:user.id};
  if(reset&&!prior)return {status:'NOT_ASSIGNED',userId:user.id};
  for(let i=0;i<MAX_PIN_RETRIES;i++) {
    const pin=randomStaffPin();
    const digest=await staffPinDigest(key,pin);
    if(reset&&digest===prior.pin_digest)continue;
    try {
      const operation=reset
        ?db.prepare('UPDATE user_pin_credentials SET pin_digest=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND pin_digest=?')
          .bind(digest,user.id,prior.pin_digest)
        :db.prepare('INSERT INTO user_pin_credentials (user_id,pin_digest) VALUES (?,?)').bind(user.id,digest);
      // Audited in the same atomic batch. No PIN or digest in the audit log.
      const audit=db.prepare(
        'INSERT INTO panel_audit_log (id,actor_id,action,target_type,target_id,details) VALUES (?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),actor,reset?'PIN_RESET':'PIN_ISSUED','USER',user.id,
        JSON.stringify({user:user.name,role:user.role_code}));
      const result=await db.batch([operation,audit]);
      if(Number(result[0]?.meta?.changes||0)!==1)
        return {status:'CONCURRENT_CHANGE',userId:user.id};
      return {status:reset?'RESET':'GENERATED',userId:user.id,
        name:user.name,role:user.role_code,pin};
    } catch(error) {
      const text=String(error?.message||'').toLowerCase();
      if(!text.includes('constraint'))throw error;
      const current=await db.prepare(
        'SELECT pin_digest FROM user_pin_credentials WHERE user_id=?'
      ).bind(user.id).first();
      if(reset&&(!current||current.pin_digest!==prior.pin_digest))
        return {status:'CONCURRENT_CHANGE',userId:user.id};
      if(!reset&&current)
        return {status:'ALREADY_ASSIGNED',userId:user.id};
      // Unique PIN collision with another account: retry.
    }
  }
  throw Error('Brak wolnego PIN-u do przypisania. Skontaktuj się z administratorem.');
}

async function provisionStaffPins(env,body,actor) {
  if(typeof env.PIN_PEPPER!=='string'||env.PIN_PEPPER.length<32)
    return fail('Generator nieaktywny. Skonfiguruj PIN_PEPPER w Cloudflare jako Secret.',503);

  const db=env.DB;
  const key=await staffPinKey(env);
  const action=String(body.action||'');
  if(!['pinGenerate','pinGenerateMissing','pinReset'].includes(action))
    return fail('Nieznana operacja.',400);

  if(action==='pinGenerateMissing') {
    const role=String(body.role||'').trim().toUpperCase();
    if(role&&!ALLOWED_ROLES.has(role))return fail('Nieprawidłowa rola.',400);
    const hasOwnerSecurity=!!await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='panel_super_admin_security'"
    ).first();
    const sql='SELECT u.id,u.name,u.role_code FROM users u '+
      'LEFT JOIN user_pin_credentials p ON p.user_id=u.id '+
      "WHERE u.active=1 AND UPPER(TRIM(u.name))<>'JJ' AND p.user_id IS NULL "+
      (hasOwnerSecurity?'AND NOT EXISTS (SELECT 1 FROM panel_super_admin_security sa WHERE sa.owner_user_id=u.id) ':'')+
      (await archiveTableExists(db)?'AND NOT EXISTS (SELECT 1 FROM user_archives ar WHERE ar.user_id=u.id) ':'')+
      (role?'AND u.role_code=? ':'')+
      'ORDER BY u.created_at,u.id LIMIT ?';
    const results=role
      ?await db.prepare(sql).bind(role,MAX_PIN_BATCH).all()
      :await db.prepare(sql).bind(MAX_PIN_BATCH).all();
    const issued=[];
    let skipped=0;
    for(const user of results.results||[]) {
      const outcome=await issueStaffPin(db,key,user,actor,false);
      if(outcome.pin)issued.push(outcome);
      else skipped++;
    }
    return respond({ok:true,generated:issued.length,skipped,
      pins:issued,maxBatch:MAX_PIN_BATCH,
      warning:'PIN-y widoczne są tylko teraz. Nie można ich później odczytać; można je zresetować.'});
  }

  const userId=String(body.userId||'');
  if(!/^GPBS-U-[a-f0-9-]{36}$/.test(userId))
    return fail('Nieprawidłowy użytkownik.',400);
  const user=await db.prepare(
    'SELECT id,name,role_code FROM users WHERE id=? AND active=1'
  ).bind(userId).first();
  if(!user)return fail('Nie znaleziono aktywnego użytkownika.',404);
  if(await isProtectedOwnerRecord(db,user))
    return fail('PIN właściciela jest ustawiany indywidualnie, nie przez generator.',403);
  if(await archiveTableExists(db) &&
    await db.prepare('SELECT user_id FROM user_archives WHERE user_id=?').bind(userId).first())
    return fail('Nie można nadać PIN-u użytkownikowi w archiwum.',409);

  const result=await issueStaffPin(db,key,user,actor,action==='pinReset');
  if(!result.pin) {
    const errors={
      ALREADY_ASSIGNED:'Użytkownik ma już PIN. Użyj Resetuj PIN.',
      NOT_ASSIGNED:'Użytkownik nie ma jeszcze PIN-u.',
      CONCURRENT_CHANGE:'PIN został zmieniony równocześnie. Odśwież listę.'
    };
    return fail(errors[result.status]||'Nie udało się wygenerować PIN-u.',409);
  }
  return respond({ok:true,...result,
    warning:'PIN jest widoczny tylko teraz. Zapisz go bezpiecznie.'});
}

// Admin replacement: upload edited file, atomically repoint D1 and delete the old original.
async function replacePartPhoto(request,env){
  const session=await readSession(request,env);
  if(!session||session.role!=='ADMIN')return fail('Zaloguj się jako administrator.',401);
  if(!r2Ready(env))return fail('R2 nie jest podłączone do panelu.',503);
  if(Number(request.headers.get('Content-Length')||0)>22*1024*1024)
    return fail('Zdjęcie przekracza 20 MB.',413);
  let form;
  try{form=await request.formData();}
  catch{return fail('Nie można odczytać pliku.',400);}
  const id=String(form.get('partId')||'');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return fail('Nieprawidłowa część.',400);
  const file=form.get('photo');
  if(!file||typeof file!=='object'||!file.size)return fail('Wybierz zdjęcie do zastąpienia.');
  let photo;
  try{photo=await readValidatedPhoto(file);}
  catch(error){return fail(error?.message||'Nieprawidłowe zdjęcie.',error?.status||400);}
  try{
    const exists=await env.DB.prepare('SELECT id FROM parts WHERE id=? AND active=1')
      .bind(id).first();
    if(!exists)return fail('Nie znaleziono części.',404);
    await ensurePhotoTables(env.DB);
  }catch(error){return fail('Baza zdjęć nie jest dostępna.',503);}
  const prev=await getPhotoObject(env.DB,id);
  const ext={
    'image/jpeg':'jpg','image/png':'png','image/bmp':'bmp',
    'image/webp':'webp','image/heic':'heic','image/avif':'avif'
  }[photo.type];
  const newKey='parts/'+crypto.randomUUID()+'.'+ext;
  let reserved=false,uploaded=false,committed=false;
  try{
    await reservePhotoWrite(env.DB,photo.bytes.byteLength);reserved=true;
    const obj=await env.PART_PHOTOS.put(newKey,photo.bytes,{
      httpMetadata:{contentType:photo.type,cacheControl:'private, no-store'}
    });
    if(!obj)throw Error('R2 nie przyjęło zdjęcia.');
    uploaded=true;
    const statements=[
      env.DB.prepare('INSERT INTO pl_part_photo_objects (part_id,object_key,mime_type,size_bytes) '+
        'VALUES (?,?,?,?) ON CONFLICT(part_id) DO UPDATE SET '+
        'object_key=excluded.object_key,mime_type=excluded.mime_type,'+
        'size_bytes=excluded.size_bytes,updated_at=CURRENT_TIMESTAMP')
        .bind(id,newKey,photo.type,photo.bytes.byteLength)
    ];
    const legacy=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
    ).first();
    if(legacy)statements.push(env.DB.prepare(
      'DELETE FROM pl_part_photos WHERE part_id=?').bind(id));
    await env.DB.batch(statements);
    committed=true;
    let oldRemoved=true;
    if(prev?.object_key){
      try{
        await env.PART_PHOTOS.delete(prev.object_key);
        await releasePhotoBytes(env.DB,Number(prev.size_bytes));
      }catch(error){
        oldRemoved=false;
        // If cleanup fails, keep the old bytes charged to our local quota.
        console.error('Admin old R2 photo cleanup unavailable',error?.name||'Error');
      }
    }
    return respond({ok:true,message:oldRemoved
      ?'Zastąpiono zdjęcie. Poprzedni oryginał usunięto.'
      :'Nowe zdjęcie zapisano, ale usunięcie poprzedniego pliku wymaga sprawdzenia.'});
  }catch(error){
    if(!committed){
      if(uploaded){
        try{await env.PART_PHOTOS.delete(newKey);}
        catch(err){console.error('Admin photo cleanup failed',err?.name||'Error');return fail('Nie można wycofać przesłanego zdjęcia R2.',503);}
      }
      if(reserved)await releasePhotoBytes(env.DB,photo.bytes.byteLength).catch(()=>{});
    }
    return fail(error?.status?error.message:'Nie udało się zastąpić zdjęcia.',error?.status||503);
  }
}

async function createAdminCataloguePart(request,env){
  const session=await readSession(request,env);
  if(!session||session.role!=='ADMIN')return fail('Zaloguj się jako administrator.',401);
  if(Number(request.headers.get('Content-Length')||0)>22*1024*1024)
    return fail('Zdjęcie przekracza 20 MB.',413);
  try{
    const form=await request.formData();
    const part=await createSharedCataloguePart(env,form);
    await env.DB.prepare(
      'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
      'VALUES (?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(),session.id,'PART_CREATE','PART',part.id,
      JSON.stringify({name:part.name,number:part.number,sap:part.sap,photo:part.hasPhoto}))
      .run().catch(error=>console.error('Catalogue part audit unavailable',error?.name||'Error'));
    return respond({ok:true,part});
  }catch(error){
    console.error('Admin catalogue create failed',error?.name||'Error');
    return fail(error?.status?error.message:'Nie udało się dodać części.',error?.status||503);
  }
}

async function ensureVehicleCategoryLinks(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS vehicle_catalog_links ('+
    'source_row INTEGER PRIMARY KEY,'+
    'part_id TEXT REFERENCES parts(id),'+
    'excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}
async function route(request,env) {
  if(!ready(env)) return fail('Panel nie jest jeszcze aktywowany przez administratora.',503);
  const url=new URL(request.url);
  if(request.method==='GET') {
    const session=await readSession(request,env);
    if(!session) return fail('Zaloguj się do panelu.',401);
    const view=url.searchParams.get('view')||'summary';
    if(view==='boxQr'&&!session.superAdmin)return fail('Tylko Super Admin może zarządzać kodami BOX.',403);
    if((view==='users'||view==='newParts'||view==='usage') && session.role!=='ADMIN')
      return fail('Brak uprawnień.',403);
    if(view==='partPhoto') {
      const partId=url.searchParams.get('part')||'';
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(partId))return fail('Nieprawidłowa część.',400);
      try {
        const hasR2=await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photo_objects'"
        ).first();
        if(hasR2){
          const ref=await getPhotoObject(env.DB,partId);
          if(ref){
            if(!env.PART_PHOTOS)return fail('Magazyn zdjęć R2 niedostępny.',503);
            const photo=await readPhotoResponse(env,ref);
            return photo||fail('Zdjęcie R2 nie zostało znalezione.',404);
          }
        }
        const exists=await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
        ).first();
        if(!exists)return fail('Brak zdjęcia części.',404);
        const item=await env.DB.prepare(
          'SELECT mime_type,photo_base64 FROM pl_part_photos WHERE part_id=?'
        ).bind(partId).first();
        if(!item)return fail('Brak zdjęcia części.',404);
        const decoded=atob(item.photo_base64);
        const image=Uint8Array.from(decoded,c=>c.charCodeAt(0));
        return new Response(image,{status:200,headers:{
          'Content-Type':item.mime_type,
          'Cache-Control':'private, no-store',
          'X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':"default-src 'none'; sandbox"
        }});
      }catch(ex) {
        console.error('panel part photo failed',ex?.name||'Error');
        return fail('Nie można otworzyć zdjęcia części.',503);
      }
    }
    try {
      if(view==='superAdmin') {
        if(!session.superAdmin)return fail('Brak dostępu do Super Admin.',403);
        const ctx=await ownerContext(env);
        if(!ctx)return fail('Nie znaleziono głównego konta JJ w D1.',503);
        return respond({ok:true,view,data:{owner:ctx.owner.name,unifiedPin:Boolean(ctx.config.unified_pin)},
          user:{role:'ADMIN',superAdmin:true}});
      }
      return respond({ok:true,view,data:await queryPanel(env,view,url),
        user:{role:'ADMIN',superAdmin:Boolean(session.superAdmin)}});
    } catch(e) {
      console.error('panel GET',e?.name||'Error');
      return fail('Nie udało się pobrać danych panelu.',500);
    }
  }
  if(request.method!=='POST') return fail('Niedozwolona metoda.',405);
  const origin=request.headers.get('Origin');
  if(!origin||origin!==url.origin) return fail('Niedozwolona domena.',403);
  if((request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data;'))
    return url.searchParams.get('action')==='createPart'
      ?createAdminCataloguePart(request,env):replacePartPhoto(request,env);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  let body;
  try {
    const raw=await request.text();
    if(raw.length>12000) return fail('Zbyt duże żądanie.',413);
    body=JSON.parse(raw);
  }catch{return fail('Niepoprawne dane JSON.',400);}
  if(body?.action==='login') {
    // The public entry point counts attempts even if the password is wrong.
    // PIN guesses have a second, shared counter after the password is valid.
    // Never contact the legacy Apps Script if a limit is exceeded.
    try {
      const ipKey = await loginIpIdentifier(request, env.PANEL_SESSION_SECRET);
      if(!ipKey) return fail('Nie można bezpiecznie zweryfikować połączenia.',503);

      const ipLock = await reserveLoginAttempt(
        env.DB, ipKey, IP_MAX_ATTEMPTS, IP_LOCK_SECONDS
      );
      if(ipLock>0) return blocked(ipLock);

      const ctx=await ownerContext(env);
      if(!await ownerPasswordMatches(env,body.password,ctx))
        return fail('Nieprawidłowe dane logowania.',401);

      const adminKey='admin-pin:primary';
      const pinLock = await reserveLoginAttempt(
        env.DB, adminKey, ADMIN_PIN_MAX_ATTEMPTS, ADMIN_PIN_LOCK_SECONDS
      );
      if(pinLock>0) return blocked(pinLock);

      const verified=ctx
        ?await ownerPinMatches(env,body.pin,ctx,pin=>verifyLegacyAdmin(pin,env))
        :(await verifyLegacyAdmin(body.pin,env))===OWNER_LEGACY_ID;
      if(!verified)return fail('Nieprawidłowe dane logowania.',401);

      // A failed database cleanup must not issue a session: fail closed.
      await clearLoginAttempts(env.DB,[ipKey,adminKey]);
      const token=await createToken(env.PANEL_SESSION_SECRET,OWNER_LEGACY_ID,ctx);
      return respond({ok:true,role:'ADMIN',superAdmin:!!ctx},200,{
        'Set-Cookie':COOKIE_NAME+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
      });
    } catch(error) {
      console.error('GPBS panel login unavailable:',error?.name||'Error');
      return fail('Logowanie chwilowo niedostępne. Spróbuj ponownie później.',503);
    }
  }
  const session=await readSession(request,env);
  if(!session) return fail('Sesja wygasła. Zaloguj się ponownie.',401);
  if(body?.action==='logout')
    return respond({ok:true},200,{
      'Set-Cookie':COOKIE_NAME+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
    });
  if(body?.action==='changeOwnerPin')
    return fail('Użyj zakładki Super Admin. Oddzielne PIN-y zostały wycofane.',410);
  if(body?.action==='superAdminChange'){
    if(!session.superAdmin)return fail('Tylko właściciel może zmieniać hasło i PIN.',403);
    try{
      const attemptKey='super-admin-change';
      const lock=await reserveLoginAttempt(env.DB,attemptKey,5,30*60);
      if(lock>0)return blocked(lock);
      const ctx=await ownerContext(env);
      const result=await changeOwnerCredential(env,ctx,body,pin=>verifyLegacyAdmin(pin,env));
      if(!result.ok)return fail(result.error,result.status||400);
      await clearLoginAttempts(env.DB,[attemptKey]);
      return respond({ok:true,changed:result.changed,message:'Dane logowania zmieniono. Zaloguj się ponownie.'},200,{
        'Set-Cookie':COOKIE_NAME+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
      });
    }catch(error){
      console.error('Super Admin credential change failed',error?.name||'Error');
      return fail('Nie udało się zapisać zmiany danych logowania.',503);
    }
  }
  if(body?.action==='setFrWeeklySettings'){
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try{
      const settings=await saveFrWeeklySettings(env.DB,body.settings);
      await env.DB.prepare(
        'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),session.id,'FR_WEEKLY_SETTINGS','CONFIG','FR_WEEKLY',
        JSON.stringify({enabled:settings.enabled,weekday:settings.weekday,time:settings.time}))
      .run();
      return respond({ok:true,settings});
    }catch(error){
      console.error('FR weekly settings update failed',error?.name||'Error');
      return fail('Nie udało się zapisać harmonogramu.',503);
    }
  }
  if(['setUserMarkets','setUserPermissions','setUserApps'].includes(body?.action)){
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try{
      const userId=String(body.userId||'');
      if(!/^GPBS-U-[a-f0-9-]{36}$/.test(userId))
        return fail('Nieprawidłowy identyfikator użytkownika.',400);
      const user=await env.DB.prepare(
        'SELECT id,name,role_code,active FROM users WHERE id=?'
      ).bind(userId).first();
      if(!user)return fail('Nie znaleziono użytkownika.',404);
      if(await archiveTableExists(env.DB)){
        if(await env.DB.prepare('SELECT 1 FROM user_archives WHERE user_id=?').bind(userId).first())
          return fail('Nie można zmienić uprawnień konta w archiwum.',409);
      }
      if(await isProtectedOwnerRecord(env.DB,user))
        return fail('Uprawnienia głównego administratora są niezmienne.',403);
      const access=await readUserAccess(env.DB,user);
      let markets=access.markets,features=access.features,apps=access.apps;
      if(body.action==='setUserMarkets'){
        if(!body.markets||typeof body.markets!=='object'||Array.isArray(body.markets)||
          Object.keys(body.markets).sort().join(',')!=='FR,PL'||
          typeof body.markets.PL!=='boolean'||typeof body.markets.FR!=='boolean')
          return fail('Nieprawidłowe uprawnienia rynków.',400);
        markets={PL:body.markets.PL,FR:body.markets.FR};
      }else if(body.action==='setUserPermissions'){
        if(!validExtraPermissions(body.permissions))
          return fail('Nieprawidłowe uprawnienia dodatkowe.',400);
        features=body.permissions;
      }else{
        if(!validAppAccess(body.apps))
          return fail('Nieprawidłowe uprawnienia aplikacji.',400);
        apps=body.apps;
      }
      await ensureAccessTable(env.DB);
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO user_access_settings(user_id,pl_enabled,fr_enabled,extra_permissions) VALUES(?,?,?,?) '+
          'ON CONFLICT(user_id) DO UPDATE SET pl_enabled=excluded.pl_enabled,'+
          'fr_enabled=excluded.fr_enabled,extra_permissions=excluded.extra_permissions,updated_at=CURRENT_TIMESTAMP'
        ).bind(userId,Number(markets.PL),Number(markets.FR),serializeUserAccess(features,apps)),
        env.DB.prepare(
          'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
        ).bind(crypto.randomUUID(),session.id,
          body.action==='setUserMarkets'?'USER_MARKETS_UPDATE':
             body.action==='setUserApps'?'USER_APPS_UPDATE':'USER_FEATURES_UPDATE',
          'USER',userId,JSON.stringify(body.action==='setUserMarkets'?{markets}:
            body.action==='setUserApps'?{apps}:{features}))
      ]);
      return respond({ok:true,markets,permissions:features,apps});
    }catch(error){
      console.error('User access update failed',error?.name||'Error');
      return fail('Nie udało się zapisać uprawnień użytkownika.',503);
    }
  }
  if(['pinGenerate','pinGenerateMissing','pinReset'].includes(body?.action)) {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try {
      return await provisionStaffPins(env,body,session.id);
    } catch(error) {
      console.error('GPBS PIN provisioning error:',error?.name||'Error');
      return fail('Nie udało się wygenerować PIN-u. Sprawdź konfigurację i spróbuj ponownie.',500);
    }
  }
  if(body?.action==='boxCreate'||body?.action==='boxQrRotate'){
    if(!session.superAdmin)return fail('Tylko Super Admin może zarządzać kodami BOX.',403);
    try{
      return body.action==='boxCreate'
        ?await createBoxWarehouse(env,body,session.id)
        :await rotateBoxQr(env,body,session.id);
    }catch(error){
      console.error('BOX QR change failed',error?.name||'Error');
      return fail('Nie udało się zapisać kodu magazynu BOX. Sprawdź nazwę lub stan D1.',409);
    }
  }
  if(body?.action==='resolveFrCarClaim'){
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try{return respond(await resolveFrCarClaim(env.DB,body,session.id));}
    catch(error){
      const msg=String(error?.message||'').slice(0,200);
      console.error('FR car claim resolution',error?.name||'Error');
      return fail(/constraint|foreign key|UNIQUE/i.test(msg)
        ?'Nie udało się zmienić przypisania. Odśwież listę i spróbuj ponownie.'
        :msg,409);
    }
  }
  if(body?.action==='deleteUnusedCrew') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try{return await permanentlyDeleteUnusedCrew(env,body);}
    catch(error){
      console.error('Permanent crew deletion failed',String(error?.message||error).slice(0,300));
      return fail('D1 nie usunęła ekipy. Możliwe powiązania lub ograniczenie bazy. Żadne dane nie zostały skasowane.',409);
    }
  }
  if(body?.action==='archiveUser'||body?.action==='restoreUser') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try {
      return await changeStaffArchive(env,body,session.id,body.action==='restoreUser');
    } catch(error) {
      console.error('GPBS archive mutation',error?.name||'Error');
      return fail('Nie udało się zmienić stanu archiwum.',500);
    }
  }
  if(body?.action==='createStaff'||body?.action==='updateStaff') {
    if(session.role!=='ADMIN') return fail('Brak uprawnień.',403);
    try {
      return await staffMutation(env,body,session.id,body.action==='updateStaff');
    } catch(e) {
      const message=String(e?.message||'').toLowerCase();
      if(message.includes('unique constraint') && message.includes('display_code'))
        return fail('Symbol użytkownika jest zajęty. Spróbuj ponownie.',409);
      console.error('GPBS private staff update',e?.name||'Error');
      return fail('Nie udało się zapisać kartoteki pracownika.',500);
    }
  }
  if(body?.action==='markIndexMigration') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    const id=String(body.partId||'');
    const field=new Map([
      ['Toulouse','toulouse_done'],
      ['Paris','paris_done']
    ]).get(String(body.warehouse||''));
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!field||typeof body.done!=='boolean')
      return fail('Nieprawidłowy indeks lub magazyn.',400);
    try{
      const changed=await env.DB.prepare(
        'UPDATE pl_part_index_migrations SET '+field+'=?,updated_at=CURRENT_TIMESTAMP '+
        'WHERE part_id=? AND old_active=1 RETURNING part_id'
      ).bind(body.done?1:0,id).first();
      if(!changed)return fail('Stary indeks został już wyłączony lub część nie istnieje.',409);
      return respond({ok:true,message:'Zapisano stan wymiany etykiety.'});
    }catch(error){
      console.error('Index replacement checkbox error',error?.name||'Error');
      return fail('Nie udało się zapisać stanu etykiety.',503);
    }
  }
  if(body?.action==='retireOldIndex') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    const id=String(body.partId||'');
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return fail('Nieprawidłowa część.',400);
    try{
      const row=await env.DB.prepare(
        'SELECT old_index,new_index,toulouse_done,paris_done,old_active '+
        'FROM pl_part_index_migrations WHERE part_id=?'
      ).bind(id).first();
      if(!row||!row.old_active)return fail('Stary indeks nie jest aktywny.',409);
      if(!row.toulouse_done||!row.paris_done)
        return fail('Najpierw potwierdź wymianę etykiet w Tuluzie i Paryżu.',409);
      const result=await env.DB.batch([
        env.DB.prepare(
          'UPDATE parts SET part_number=? WHERE id=? AND part_number=? AND EXISTS ('+
          'SELECT 1 FROM pl_part_index_migrations m WHERE m.part_id=parts.id AND '+
          'm.toulouse_done=1 AND m.paris_done=1 AND m.old_active=1)'
        ).bind(row.new_index,id,row.old_index),
        env.DB.prepare(
          'UPDATE pl_part_index_migrations SET old_active=0,updated_at=CURRENT_TIMESTAMP '+
          'WHERE part_id=? AND toulouse_done=1 AND paris_done=1 AND old_active=1'
        ).bind(id),
        env.DB.prepare(
          'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
          'VALUES (?,?,?,?,?,?)'
        ).bind(crypto.randomUUID(),session.id,'INDEX_OLD_RETIRED','PART',id,
          JSON.stringify({old:row.old_index,now:row.new_index}))
      ]);
      if(Number(result[0]?.meta?.changes||0)!==1||Number(result[1]?.meta?.changes||0)!==1)
        return fail('Nie można zakończyć wymiany. Odśwież listę.',409);
      return respond({ok:true,message:'Stary indeks wyłączony. Aktywny pozostaje '+row.new_index+'.'});
    }catch(error){
      console.error('Index retirement error',error?.name||'Error');
      return fail('Nie udało się wyłączyć starego indeksu.',503);
    }
  }
  if(body?.action==='deletePart') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    const id=String(body.partId||'');
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return fail('Nieprawidłowa część.',400);
    try {
      const part=await env.DB.prepare(
        'SELECT id,name,part_number,sap_number FROM parts WHERE id=? AND active=1'
      ).bind(id).first();
      if(!part)return fail('Część już nie istnieje w aktywnym katalogu.',404);
      const stock=await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM warehouse_stock WHERE part_id=? AND quantity<>0'
      ).bind(id).first();
      if(Number(stock?.n||0)>0)
        return fail('Nie można usunąć części z niezerowym stanem magazynowym. Najpierw popraw jej stany.',409);

      const hasR2Table=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photo_objects'"
      ).first();
      const photoRef=hasR2Table?await getPhotoObject(env.DB,id):null;
      const hasLegacyPhotoTable=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_photos'"
      ).first();
      const hasReview=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_verifications'"
      ).first();

      // Delete R2 first: when storage is unavailable, leave the part active
      // so the administrator can retry without creating an invisible orphan.
      // R2.delete is idempotent; a retry also repairs a previous D1 failure.
      if(photoRef) {
        if(!env.PART_PHOTOS||typeof env.PART_PHOTOS.delete!=='function')
          return fail('R2 jest niedostępne. Część i zdjęcie nie zostały usunięte.',503);
        // Also ensure the accounting table exists before touching remote storage.
        // Otherwise a missing quota table could leave an active part with no photo.
        await ensurePhotoTables(env.DB);
        try {
          await env.PART_PHOTOS.delete(photoRef.object_key);
        }catch(error) {
          console.error('Admin part R2 removal failed',error?.name||'Error');
          return fail('Nie udało się usunąć zdjęcia z R2. Część nie została usunięta.',503);
        }
      }

      // The D1 batch is atomic: archive the part, remove photo references,
      // update quota, and keep a permanent audit. No operational history is deleted.
      const statements=[];
      if(photoRef) {
        // Refund only while this exact photo reference still exists.
        // This prevents double refunds in repeated removal attempts.
        statements.push(env.DB.prepare(
          'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) '+
          'WHERE id=1 AND EXISTS ('+
          'SELECT 1 FROM pl_part_photo_objects WHERE part_id=? AND object_key=?)'
        ).bind(Number(photoRef.size_bytes),id,photoRef.object_key));
        statements.push(env.DB.prepare(
          'DELETE FROM pl_part_photo_objects WHERE part_id=? AND object_key=?'
        ).bind(id,photoRef.object_key));
      }
      if(hasLegacyPhotoTable)statements.push(env.DB.prepare(
        'DELETE FROM pl_part_photos WHERE part_id=?'
      ).bind(id));
      const partStatementIndex=statements.length;
      statements.push(env.DB.prepare(
        'UPDATE parts SET active=0 WHERE id=? AND active=1 AND NOT EXISTS ('+
        'SELECT 1 FROM warehouse_stock WHERE part_id=? AND quantity<>0)'
      ).bind(id,id));
      if(hasReview)statements.push(env.DB.prepare(
        'UPDATE pl_part_verifications SET raw_code=NULL WHERE part_id=?'
      ).bind(id));
      statements.push(env.DB.prepare(
        'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
        'VALUES (?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),session.id,'PART_DEACTIVATE','PART',id,
        JSON.stringify({name:part.name,number:part.part_number,
          sap:part.sap_number,photoRemoved:Boolean(photoRef),legacyPhotoCleared:Boolean(hasLegacyPhotoTable)})));
      const result=await env.DB.batch(statements);
      if(Number(result[partStatementIndex]?.meta?.changes||0)!==1)
        return fail('Nie można zakończyć usuwania: stan części zmienił się. Odśwież katalog.',409);
      return respond({ok:true,message:photoRef
        ?'Usunięto część i jej zdjęcie z R2. Historia PZ/WZ została zachowana.'
        :'Usunięto część z aktywnego katalogu. Historia PZ/WZ została zachowana.'});
    }catch(error) {
      console.error('panel part deactivate',error?.name||'Error');
      return fail('Nie udało się zakończyć usuwania części. Jeśli zdjęcie było w R2, ponów usunięcie z katalogu.',503);
    }
  }
  if(['linkVehiclePart','removeVehiclePart','addVehiclePart'].includes(body?.action)){
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    const action=body.action,sourceRow=Number(body.sourceRow);
    const partId=String(body.partId||'').trim();
    if(action!=='removeVehiclePart'&&
      !/^[A-Za-z0-9_-]{1,100}$/.test(partId))
      return fail('Wskaż istniejącą część z katalogu głównego.',400);
    try{
      await ensureVehicleCategoryLinks(env.DB);
      const catalogue=await getVehicleCatalogue(env.DB);
      const current=action==='addVehiclePart'?null:
        catalogue.parts.find(item=>item.source_row===sourceRow);
      if(action!=='addVehiclePart'&&(!Number.isSafeInteger(sourceRow)||!current))
        return fail('Nie znaleziono części w katalogu samochodowym.',404);
      if(action!=='removeVehiclePart'){
        const part=await env.DB.prepare('SELECT id FROM parts WHERE id=? AND active=1')
          .bind(partId).first();
        if(!part)return fail('Wybrana część nie istnieje w katalogu głównym.',404);
        if(catalogue.parts.some(p=>p.id===partId&&p.source_row!==sourceRow))
          return fail('Ta część jest już przypisana do samochodów.',409);
      }
      let targetRow=sourceRow;
      let stmt;
      if(action==='addVehiclePart'){
        const last=await env.DB.prepare(
          'SELECT MAX(source_row) AS last FROM vehicle_catalog_links WHERE source_row>=10000'
        ).first();
        targetRow=Math.max(9999,Number(last?.last||9999))+1;
        stmt=env.DB.prepare(
          'INSERT INTO vehicle_catalog_links(source_row,part_id,excluded) VALUES(?,?,0)'
        ).bind(targetRow,partId);
      }else if(action==='removeVehiclePart'){
        stmt=env.DB.prepare(
          'INSERT INTO vehicle_catalog_links(source_row,excluded) VALUES(?,1) '+
          'ON CONFLICT(source_row) DO UPDATE SET excluded=1,updated_at=CURRENT_TIMESTAMP'
        ).bind(targetRow);
      }else{
        stmt=env.DB.prepare(
          'INSERT INTO vehicle_catalog_links(source_row,part_id,excluded) VALUES(?,?,0) '+
          'ON CONFLICT(source_row) DO UPDATE SET part_id=excluded.part_id,'+
          'excluded=0,updated_at=CURRENT_TIMESTAMP'
        ).bind(targetRow,partId);
      }
      await env.DB.batch([stmt,env.DB.prepare(
        'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
        'VALUES(?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),session.id,action.toUpperCase(),
        'VEHICLE_CATALOG',String(targetRow),JSON.stringify({
          partId:action==='removeVehiclePart'?current?.id:partId,
          sourceName:current?.name||''
        }))]);
      return respond({ok:true,source_row:targetRow});
    }catch(error){
      const msg=String(error?.message||'').toLowerCase();
      if(msg.includes('unique'))return fail('Ta część już należy do katalogu samochodowego.',409);
      console.error('Vehicle category membership update',error?.name||'Error');
      return fail('Nie udało się zaktualizować katalogu samochodowego.',503);
    }
  }
  if(body?.action==='setVehicleRequirement') {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    const row=Number(body.sourceRow);
    const visible=(await getVehicleCatalogue(env.DB)).parts;
    const source=visible.find(item=>item.source_row===row);
    const number=body.requiredQuantity;
    const required=number===null?null:Number(number);
    if(!source||!Number.isSafeInteger(row)||(
      required!==null&&(!Number.isSafeInteger(required)||required<0||required>100000)
    ))return fail('Nieprawidłowa część lub wymagana ilość.',400);
    try{
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS vehicle_catalog_requirements ('+
        'source_row INTEGER PRIMARY KEY,'+
        'required_quantity INTEGER CHECK(required_quantity IS NULL OR '+
          '(required_quantity>=0 AND required_quantity<=100000)),'+
        'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
      ).run();
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO vehicle_catalog_requirements(source_row,required_quantity) VALUES(?,?) '+
          'ON CONFLICT(source_row) DO UPDATE SET required_quantity=excluded.required_quantity,'+
          'updated_at=CURRENT_TIMESTAMP'
        ).bind(row,required),
        env.DB.prepare(
          'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
          'VALUES(?,?,?,?,?,?)'
        ).bind(crypto.randomUUID(),session.id,'VEHICLE_REQUIREMENT_UPDATE',
          'VEHICLE_CATALOG',String(row),JSON.stringify({
            name:source.source_name,required_quantity:required
          }))
      ]);
      return respond({ok:true,required_quantity:required});
    }catch(error){
      console.error('Vehicle catalogue minimum update',error?.name||'Error');
      return fail('Nie udało się zapisać wymaganej ilości.',503);
    }
  }
  if(body?.action==='updatePart') {
    try {
      const id=String(body.partId||'');
      const name=String(body.name||'').trim();
      const number=String(body.number||'').trim().toUpperCase();
      const sap=String(body.sap||'').trim().toUpperCase();
      const verify=body.verify===true;
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||
        name.length<2||name.length>120||number.length<2||number.length>100||
        sap.length>100||/[\r\n]/.test(name+number+sap))
        return fail('Podaj poprawną nazwę, indeks i SAP.',400);
      const indexTable=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_index_migrations'"
      ).first();
      const migration=indexTable?await env.DB.prepare(
        'SELECT new_index FROM pl_part_index_migrations WHERE part_id=?'
      ).bind(id).first():null;
      if(migration&&number!==migration.new_index)
        return fail('Nowy indeks jest przypisany na stałe i nie można go zmienić w edycji części.',409);
      const exists=await env.DB.prepare('SELECT id FROM parts WHERE id=? AND active=1')
        .bind(id).first();
      if(!exists)return fail('Część nie istnieje.',404);
      if(verify) {
        const hasReviewTable=await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_verifications'"
        ).first();
        if(!hasReviewTable)return fail('Brak tabeli weryfikacji części.',503);
      }
      const statements=[
        env.DB.prepare(
          migration?'UPDATE parts SET name=?,sap_number=? WHERE id=?':
            'UPDATE parts SET name=?,part_number=?,sap_number=? WHERE id=?'
        ).bind(...(migration?[name,sap||null,id]:[name,number,sap||null,id]))
      ];
      if(verify)statements.push(env.DB.prepare(
        "UPDATE pl_part_verifications SET status='VERIFIED',verified_by=?,verified_at=CURRENT_TIMESTAMP "+
        "WHERE part_id=? AND status='PENDING'"
      ).bind(session.id,id));
      statements.push(env.DB.prepare(
        'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) '+
        'VALUES (?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(),session.id,
        verify?'PART_VERIFY':'PART_UPDATE','PART',id,
        JSON.stringify({name,number,sap,verified:verify})));
      await env.DB.batch(statements);
      return respond({ok:true,message:verify
        ?'Zapisano dane i zatwierdzono część.'
        :'Zapisano dane części. Status weryfikacji bez zmian.'});
    }catch(error) {
      if(String(error?.message||'').toLowerCase().includes('unique'))
        return fail('Podany indeks lub numer SAP jest już zajęty.',409);
      console.error('panel part update',error?.name||'Error');
      return fail('Nie udało się zapisać danych części.',503);
    }
  }
  if(body?.action==='createUser') {
    try{return await addUser(env,body,session.id);}
    catch(e){
      console.error('panel create user',e?.name||'Error');
      return fail('Nie udało się dodać użytkownika.',500);
    }
  }
  if(body?.action==='updateUser') {
    try{return await updateUser(env,body,session.id);}
    catch(e){console.error('panel user edit',e?.name||'Error');return fail('Błąd zapisu danych użytkownika.',500);}
  }
  return fail('Nieznana operacja panelu.',400);
}

export async function onRequestGet({request,env}) {
  return route(request,env);
}
export async function onRequestPost({request,env}) {
  return route(request,env);
}
