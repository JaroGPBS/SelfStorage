// GPBS Storage: guarded web-panel API, independent from production /api.
// Bootstrap administrator access: strong secret PLUS legacy administrator PIN.
// Later: migrate to scoped D1 users, passwordless/2FA and per-permission access.
const COOKIE_NAME = '__Host-gpbs_panel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SCRIPT_FALLBACK = 'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';
const ALLOWED_ROLES = new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER','EKIPA']);
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
    env.PANEL_ADMIN_PASSWORD.length >= 32 &&
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
async function createToken(secret, actor) {
  const payload = enc.encode(JSON.stringify({
    id:actor,role:'ADMIN',exp:Date.now()+SESSION_TTL_MS,
    nonce:crypto.randomUUID()
  }));
  const key=await signingKey(secret);
  const sig=await crypto.subtle.sign('HMAC',key,payload);
  return b64(payload)+'.'+b64(sig);
}
async function readSession(request, secret) {
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
    if (session.role!=='ADMIN'||!session.id||
      !Number.isFinite(session.exp)||session.exp<Date.now()||
      session.exp>Date.now()+SESSION_TTL_MS) return null;
    return session;
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

async function queryPanel(env,view,url) {
  if(view==='summary') {
    const [warehouses, operations, parts, users]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM warehouses WHERE country_code='PL' AND active=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM warehouse_operations").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM parts WHERE active=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE active=1").first()
    ]);
    return {warehouses:warehouses?.n||0,operations:operations?.n||0,
      parts:parts?.n||0,users:users?.n||0};
  }
  if(view==='warehouses') {
    const rows=await env.DB.prepare(
      "SELECT w.id, w.name,w.country_code,w.active,COUNT(s.part_id) AS positions,"+
      "COALESCE(SUM(s.quantity),0) AS units FROM warehouses w "+
      "LEFT JOIN warehouse_stock s ON s.warehouse_id=w.id "+
      "WHERE w.country_code='PL' GROUP BY w.id,w.name,w.country_code,w.active "+
      "ORDER BY w.active DESC,w.name"
    ).all();
    return rows.results||[];
  }
  if(view==='parts') {
    const warehouse=url.searchParams.get('warehouse')||'PL-TYCHY';
    const allowed=await env.DB.prepare(
      "SELECT id FROM warehouses WHERE id=? AND country_code='PL'"
    ).bind(warehouse).first();
    if(!allowed) throw new Error('Nieprawidłowy magazyn.');
    const rows=await env.DB.prepare(
      'SELECT p.id,p.part_number,p.name,p.sap_number,s.quantity '+
      'FROM parts p LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
      'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE LIMIT 1000'
    ).bind(warehouse).all();
    return {warehouse,parts:rows.results||[]};
  }
  if(view==='movements') {
    const rows=await env.DB.prepare(
      'SELECT o.id,o.operation_type,o.warehouse_id,o.operator_id,o.recipient_name,'+
      'o.created_at,p.name AS part_name,p.part_number,l.quantity_delta,'+
      'l.quantity_before,l.quantity_after '+
      'FROM warehouse_operations o JOIN warehouse_operation_lines l ON l.operation_id=o.id '+
      'JOIN parts p ON p.id=l.part_id ORDER BY o.created_at DESC,o.id DESC LIMIT 250'
    ).all();
    return rows.results||[];
  }
  if(view==='users') {
    const rows=await env.DB.prepare(
      'SELECT u.id,u.name,u.role_code,u.active,u.created_at,'+
      'CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS has_pin, '+
      "COALESCE((SELECT GROUP_CONCAT(a.warehouse_id, ', ') FROM user_warehouse_access a WHERE a.user_id=u.id),'') AS warehouses "+
      'FROM users u LEFT JOIN user_pin_credentials p ON p.user_id=u.id '+
      'ORDER BY u.active DESC,u.name COLLATE NOCASE LIMIT 500'
    ).all();
    return rows.results||[];
  }
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
  await env.DB.batch(statements);
  return respond({ok:true,user:{id,name,role,warehouses},pinAssigned:false});
}

async function route(request,env) {
  if(!ready(env)) return fail('Panel nie jest jeszcze aktywowany przez administratora.',503);
  const url=new URL(request.url);
  if(request.method==='GET') {
    const session=await readSession(request,env.PANEL_SESSION_SECRET);
    if(!session) return fail('Zaloguj się do panelu.',401);
    const view=url.searchParams.get('view')||'summary';
    try {
      return respond({ok:true,view,data:await queryPanel(env,view,url),user:{role:'ADMIN'}});
    } catch(e) {
      console.error('panel GET',e?.name||'Error');
      return fail('Nie udało się pobrać danych panelu.',500);
    }
  }
  if(request.method!=='POST') return fail('Niedozwolona metoda.',405);
  const origin=request.headers.get('Origin');
  if(!origin||origin!==url.origin) return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  let body;
  try {
    const raw=await request.text();
    if(raw.length>12000) return fail('Zbyt duże żądanie.',413);
    body=JSON.parse(raw);
  }catch{return fail('Niepoprawne dane JSON.',400);}
  if(body?.action==='login') {
    if(!await equalSecret(body.password,env.PANEL_ADMIN_PASSWORD))
      return fail('Nieprawidłowe dane logowania.',401);
    let actor=null;
    try{actor=await verifyLegacyAdmin(body.pin,env);}catch{ return fail('Logowanie chwilowo niedostępne.',503);}
    if(!actor) return fail('Nieprawidłowe dane logowania.',401);
    const token=await createToken(env.PANEL_SESSION_SECRET,actor);
    return respond({ok:true,role:'ADMIN'},200,{
      'Set-Cookie':COOKIE_NAME+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
    });
  }
  const session=await readSession(request,env.PANEL_SESSION_SECRET);
  if(!session) return fail('Sesja wygasła. Zaloguj się ponownie.',401);
  if(body?.action==='logout')
    return respond({ok:true},200,{
      'Set-Cookie':COOKIE_NAME+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
    });
  if(body?.action==='createUser') {
    try{return await addUser(env,body,session.id);}
    catch(e){
      console.error('panel create user',e?.name||'Error');
      return fail('Nie udało się dodać użytkownika.',500);
    }
  }
  return fail('Nieznana operacja panelu.',400);
}

export async function onRequestGet({request,env}) {
  return route(request,env);
}
export async function onRequestPost({request,env}) {
  return route(request,env);
}
