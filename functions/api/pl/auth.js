// GPBS Storage — Polish staff PIN login only. The French /api remains untouched.
// POST {action:'login',pin:'1234'} or {action:'logout'}.
// GET returns the current account/allowed PL warehouses for a signed cookie.
import {
  workerAuthReady, workerCookie, createWorkerSession,
  verifyWorkerSession, loadActiveWorker, workerJson
} from '../../../lib/pl-worker-auth.js';

const IP_MAX_ATTEMPTS = 7;
const IP_WINDOW_SECONDS = 15 * 60;
const IP_LOCK_SECONDS = 15 * 60;
const GLOBAL_MAX_ATTEMPTS = 60;
const GLOBAL_WINDOW_SECONDS = 15 * 60;
const GLOBAL_LOCK_SECONDS = 15 * 60;

function fail(error, status = 400, extra = {}) {
  return workerJson({ok:false,error},status,extra);
}

async function hashLabel(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']
  );
  const bytes=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('GPBS:PL:RATE:v1:'+value));
  return Array.from(new Uint8Array(bytes).slice(0,20),
    b=>b.toString(16).padStart(2,'0')).join('');
}

async function pinLookupDigest(pepper, pin) {
  const key=await crypto.subtle.importKey(
    'raw',new TextEncoder().encode(pepper),
    {name:'HMAC',hash:'SHA-256'},false,['sign']
  );
  const signed=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('GPBS:D1:PIN:v1:'+pin));
  return Array.from(new Uint8Array(signed),
    b=>b.toString(16).padStart(2,'0')).join('');
}

async function rateTablePresent(db) {
  const result=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_login_rate_limits'"
  ).first();
  return Boolean(result);
}

async function reserveAttempt(db,identifier,now,windowSeconds,limit,lockSeconds) {
  // Upsert is atomic in D1: parallel requests cannot avoid the counter.
  // An attempt is consumed BEFORE any lookup of the submitted PIN.
  const record=await db.prepare(
    'INSERT INTO pl_login_rate_limits '+
      '(identifier,attempts,window_expires,locked_until,updated_at) '+
    'VALUES (?,1,?,0,?) '+
    'ON CONFLICT(identifier) DO UPDATE SET '+
      'attempts=CASE WHEN pl_login_rate_limits.window_expires<=? THEN 1 '+
        'ELSE pl_login_rate_limits.attempts+1 END, '+
      'window_expires=CASE WHEN pl_login_rate_limits.window_expires<=? '+
        'THEN excluded.window_expires ELSE pl_login_rate_limits.window_expires END, '+
      'locked_until=CASE '+
        'WHEN pl_login_rate_limits.locked_until>? THEN pl_login_rate_limits.locked_until '+
        'WHEN pl_login_rate_limits.window_expires<=? THEN 0 '+
        'WHEN pl_login_rate_limits.attempts+1>? THEN ? ELSE 0 END, '+
      'updated_at=excluded.updated_at '+
    'RETURNING attempts,locked_until'
  ).bind(
    identifier,now+windowSeconds,now,
    now,now,now,now,limit,now+lockSeconds
  ).first();
  return record && record.locked_until>now ?
    Math.max(1,record.locked_until-now) : 0;
}

async function throttle(request,env) {
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip || ip.length>64) return fail('Nie można zweryfikować połączenia.',503);
  if(!await rateTablePresent(env.DB))
    return fail('Logowanie PL wymaga migracji D1: db/07-pl-login-limits.sql.',503);

  const now=Math.floor(Date.now()/1000);
  // Global budget protects a PIN-only 10,000-code space against
  // attacks spread across many IP addresses.
  const globalWait=await reserveAttempt(env.DB,'global:pl-worker-v1',
    now,GLOBAL_WINDOW_SECONDS,GLOBAL_MAX_ATTEMPTS,GLOBAL_LOCK_SECONDS);
  if(globalWait) return fail('Zbyt wiele prób logowania. Spróbuj później.',429,
    {'Retry-After':String(globalWait)});

  const ipKey='ip:'+await hashLabel(env.PANEL_SESSION_SECRET,ip);
  const ipWait=await reserveAttempt(env.DB,ipKey,
    now,IP_WINDOW_SECONDS,IP_MAX_ATTEMPTS,IP_LOCK_SECONDS);
  if(ipWait)return fail('Zbyt wiele prób logowania. Spróbuj później.',429,
    {'Retry-After':String(ipWait)});
  return null;
}

async function login(request,env,pin) {
  if(!workerAuthReady(env))
    return fail('Logowanie polskie nie jest skonfigurowane.',503);
  const blocked=await throttle(request,env);
  if(blocked)return blocked;
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))
    return fail('Wpisz czterocyfrowy PIN.',400);

  // Lookup uses the SAME HMAC domain as the existing ADMIN panel's
  // D1 PIN generator, but never accesses legacy French Apps Script.
  const digest=await pinLookupDigest(env.PIN_PEPPER,pin);
  const existing=await env.DB.prepare(
    'SELECT user_id FROM user_pin_credentials WHERE pin_digest=? LIMIT 1'
  ).bind(digest).first();
  if(!existing)return fail('Nieprawidłowy PIN lub brak dostępu.',401);

  // Current activation, archives and PL warehouse grants are mandatory.
  const user=await loadActiveWorker(env,existing.user_id);
  if(!user)return fail('Nieprawidłowy PIN lub brak dostępu.',401);
  const token=await createWorkerSession(env,user);
  const {pinDigest,...safeUser}=user;
  return workerJson({ok:true,user:safeUser,expiresInSeconds:8*60*60},200,
    {'Set-Cookie':workerCookie(token)});
}

export async function onRequestGet({request,env}) {
  if(!workerAuthReady(env))return fail('Logowanie polskie nie jest skonfigurowane.',503);
  try {
    const user=await verifyWorkerSession(request,env);
    if(!user)return fail('Zaloguj się ponownie.',401);
    return workerJson({ok:true,user});
  }catch(error) {
    console.error('PL worker session check failed',error?.name||'Error');
    return fail('Nie można teraz potwierdzić sesji.',503);
  }
}

export async function onRequestPost({request,env}) {
  if(!workerAuthReady(env))return fail('Logowanie polskie nie jest skonfigurowane.',503);
  const target=new URL(request.url);
  if(request.headers.get('Origin')!==target.origin)
    return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase()
      .startsWith('application/json'))
    return fail('Wymagany format JSON.',415);

  let body;
  try {
    const raw=await request.text();
    if(raw.length>1000)return fail('Zbyt dużo danych.',413);
    body=JSON.parse(raw);
    if(!body || typeof body!=='object' || Array.isArray(body))
      return fail('Niepoprawne dane.',400);
  }catch{return fail('Niepoprawne dane JSON.',400);}

  if(body.action==='logout') {
    return workerJson({ok:true},200,{'Set-Cookie':workerCookie('',0)});
  }
  if(body.action!=='login')return fail('Nieznana akcja.',400);

  try{return await login(request,env,body.pin);}
  catch(error){
    console.error('GPBS PL worker login failed',error?.name||'Error');
    return fail('Logowanie chwilowo niedostępne.',503);
  }
}
