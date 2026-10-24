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
  if(view==='warehouseOptions') {
    const rows=await env.DB.prepare(
      'SELECT id,name,country_code,active FROM warehouses ORDER BY country_code,name'
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
  // Only chief ADMIN accesses private contact fields in this combined view.
  if(view==='users') {
    const rows=await env.DB.prepare(
      'SELECT u.id,u.name,u.role_code,u.active,u.created_at,'+
      'pr.first_name,pr.last_name,pr.phone,pr.display_code, '+
      'CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS has_pin, '+
      "COALESCE((SELECT GROUP_CONCAT(a.warehouse_id, ', ') FROM user_warehouse_access a WHERE a.user_id=u.id),'') AS warehouses "+
      'FROM users u '+
      'LEFT JOIN user_pin_credentials p ON p.user_id=u.id '+
      'LEFT JOIN user_private_profiles pr ON pr.user_id=u.id '+
      'ORDER BY u.active DESC,u.name COLLATE NOCASE LIMIT 500'
    ).all();
    return rows.results||[];
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
    prior=(await db.prepare('SELECT warehouse_id FROM user_warehouse_access WHERE user_id=?')
      .bind(id).all()).results.map(r=>r.warehouse_id);
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
  // Audit stores the symbol, role and warehouse assignment, NEVER phone numbers.
  stmts.push(db.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),actor,edit?'STAFF_UPDATE':'STAFF_CREATE','USER',id,
    JSON.stringify({nickname:staff.nickname,code,role:staff.role,active:staff.active,warehouses:staff.warehouses})));
  await db.batch(stmts);
  return respond({ok:true,userId:id,nickname:staff.nickname,displayCode:code,pinUnchanged:true});
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
    const sql='SELECT u.id,u.name,u.role_code FROM users u '+
      'LEFT JOIN user_pin_credentials p ON p.user_id=u.id '+
      'WHERE u.active=1 AND p.user_id IS NULL '+
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

async function route(request,env) {
  if(!ready(env)) return fail('Panel nie jest jeszcze aktywowany przez administratora.',503);
  const url=new URL(request.url);
  if(request.method==='GET') {
    const session=await readSession(request,env.PANEL_SESSION_SECRET);
    if(!session) return fail('Zaloguj się do panelu.',401);
    const view=url.searchParams.get('view')||'summary';
    if(view==='users' && session.role!=='ADMIN') return fail('Brak uprawnień.',403);
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

      if(!await equalSecret(body.password,env.PANEL_ADMIN_PASSWORD))
        return fail('Nieprawidłowe dane logowania.',401);

      const adminKey='admin-pin:primary';
      const pinLock = await reserveLoginAttempt(
        env.DB, adminKey, ADMIN_PIN_MAX_ATTEMPTS, ADMIN_PIN_LOCK_SECONDS
      );
      if(pinLock>0) return blocked(pinLock);

      const actor=await verifyLegacyAdmin(body.pin,env);
      if(!actor) return fail('Nieprawidłowe dane logowania.',401);

      // A failed database cleanup must not issue a session: fail closed.
      await clearLoginAttempts(env.DB,[ipKey,adminKey]);
      const token=await createToken(env.PANEL_SESSION_SECRET,actor);
      return respond({ok:true,role:'ADMIN'},200,{
        'Set-Cookie':COOKIE_NAME+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
      });
    } catch(error) {
      console.error('GPBS panel login unavailable:',error?.name||'Error');
      return fail('Logowanie chwilowo niedostępne. Spróbuj ponownie później.',503);
    }
  }
  const session=await readSession(request,env.PANEL_SESSION_SECRET);
  if(!session) return fail('Sesja wygasła. Zaloguj się ponownie.',401);
  if(body?.action==='logout')
    return respond({ok:true},200,{
      'Set-Cookie':COOKIE_NAME+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
    });
  if(['pinGenerate','pinGenerateMissing','pinReset'].includes(body?.action)) {
    if(session.role!=='ADMIN')return fail('Brak uprawnień.',403);
    try {
      return await provisionStaffPins(env,body,session.id);
    } catch(error) {
      console.error('GPBS PIN provisioning error:',error?.name||'Error');
      return fail('Nie udało się wygenerować PIN-u. Sprawdź konfigurację i spróbuj ponownie.',500);
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
