// GPBS Storage: one protected owner identity in D1. Never stores plaintext PINs/passwords.
const OWNER_CODE='JJ';
const OWNER_KEY='OWNER';
const ITERATIONS=310000;
const enc=new TextEncoder();
const eq=async(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string')return false;
  const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),crypto.subtle.digest('SHA-256',enc.encode(b))]);
  const aa=new Uint8Array(x),bb=new Uint8Array(y);let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
};
const hex=b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
const hexBytes=s=>new Uint8Array(s.match(/.{1,2}/g).map(x=>parseInt(x,16)));

async function d1PinDigest(env,pin){
  if(typeof env.PIN_PEPPER!=='string'||env.PIN_PEPPER.length<32)throw Error('Brak PIN_PEPPER');
  const key=await crypto.subtle.importKey('raw',enc.encode(env.PIN_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode('GPBS:D1:PIN:v1:'+pin)));
}
async function legacyAdminDigest(env,pin){
  const key=await crypto.subtle.importKey('raw',enc.encode('GPBS:PANEL:OWNER:PIN:SECRET:v1:'+env.PIN_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode('GPBS:PANEL:OWNER:PIN:v1:'+pin)));
}
async function derivedPassword(password,salt,iterations){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:hexBytes(salt),iterations},key,256));
}
async function hasTable(db,name){
  return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
}
async function ensureSecurityTable(db){
  if(!await hasTable(db,'panel_super_admin_security')){
    await db.prepare(
      'CREATE TABLE IF NOT EXISTS panel_super_admin_security ('+
      "id TEXT PRIMARY KEY CHECK(id='OWNER'),"+
      'owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),'+
      'password_hash TEXT,password_salt TEXT,password_iterations INTEGER,'+
      'revision INTEGER NOT NULL DEFAULT 0,unified_pin INTEGER NOT NULL DEFAULT 0,'+
      'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    ).run();
  }
}
// Only one existing D1 account bearing the owner's original unique symbol can be bound.
// Once recorded, the immutable owner_user_id is used for all PIN and password mutations.
export async function ownerContext(env){
  const db=env.DB;
  const found=await db.prepare(
    'SELECT u.id,u.name,u.role_code,u.active,c.pin_digest FROM users u '+
    'LEFT JOIN user_pin_credentials c ON c.user_id=u.id '+
    'WHERE UPPER(TRIM(u.name))=? LIMIT 2'
  ).bind(OWNER_CODE).all();
  const matches=found.results||[];
  if(matches.length!==1||matches[0].role_code!=='ADMIN'||Number(matches[0].active)!==1)return null;
  const owner=matches[0];
  if(await hasTable(db,'user_archives')){
    if(await db.prepare('SELECT 1 FROM user_archives WHERE user_id=?').bind(owner.id).first())return null;
  }
  await ensureSecurityTable(db);
  let config=await db.prepare(
    'SELECT owner_user_id,password_hash,password_salt,password_iterations,revision,unified_pin '+
    'FROM panel_super_admin_security WHERE id=?'
  ).bind(OWNER_KEY).first();
  if(!config){
    await db.prepare(
      'INSERT OR IGNORE INTO panel_super_admin_security(id,owner_user_id) VALUES(?,?)'
    ).bind(OWNER_KEY,owner.id).run();
    config=await db.prepare(
      'SELECT owner_user_id,password_hash,password_salt,password_iterations,revision,unified_pin '+
      'FROM panel_super_admin_security WHERE id=?'
    ).bind(OWNER_KEY).first();
  }
  if(!config||config.owner_user_id!==owner.id)throw Error('Owner identity conflict');
  return {owner,config};
}
export async function ownerPasswordMatches(env,password,ctx){
  if(typeof password!=='string')return false;
  if(ctx?.config?.password_hash){
    const c=ctx.config;
    if(!/^[a-f0-9]{32}$/.test(c.password_salt||'')||
       !Number.isInteger(c.password_iterations)||c.password_iterations<100000)return false;
    return eq(await derivedPassword(password,c.password_salt,c.password_iterations),c.password_hash);
  }
  return eq(password,env.PANEL_ADMIN_PASSWORD);
}
export async function ownerPinMatches(env,pin,ctx,verifyLegacy){
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
  // After the first unified change, only the single D1 PIN is accepted.
  if(ctx?.owner?.pin_digest){
    if(await eq(await d1PinDigest(env,pin),ctx.owner.pin_digest))return true;
  }
  if(ctx?.config?.unified_pin===1)return false;
  // A previous build used a separate Admin-only PIN: recognise it only
  // during transition so that the owner can still reach the unified form.
  if(await hasTable(env.DB,'panel_owner_credentials')){
    const row=await env.DB.prepare(
      'SELECT pin_digest FROM panel_owner_credentials WHERE owner_id=?'
    ).bind('ADMIN').first();
    if(row?.pin_digest&&await eq(await legacyAdminDigest(env,pin),row.pin_digest))return true;
  }
  // Legacy FR PIN remains a temporary bridge until a D1 unified PIN is chosen.
  return (await verifyLegacy(pin))==='ADMIN';
}
export async function changeOwnerCredential(env,ctx,body,verifyLegacy){
  if(!ctx||ctx.config.owner_user_id!==ctx.owner.id)return {error:'Nie znaleziono głównego konta JJ w D1.',status:503};
  const currentPassword=body.currentPassword;
  const currentPin=body.currentPin;
  const [pwOK,pinOK]=await Promise.all([
    ownerPasswordMatches(env,currentPassword,ctx),
    ownerPinMatches(env,currentPin,ctx,verifyLegacy)
  ]);
  if(!pwOK||!pinOK)return {error:'Nieprawidłowe aktualne hasło lub PIN.',status:401};
  const type=body.credentialType;
  const db=env.DB;
  const audit=(action)=>db.prepare(
    'INSERT INTO panel_audit_log(id,actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),ctx.owner.id,action,'USER',ctx.owner.id,'{}');
  if(type==='pin'){
    const pin=body.newPin;
    if(typeof pin!=='string'||!/^\d{4}$/.test(pin)||pin!==body.confirmPin||
       ['0000','1111','1234'].includes(pin))
      return {error:'Wpisz i potwierdź nowy 4-cyfrowy PIN (inny niż 0000, 1111 i 1234).',status:400};
    if(pin===currentPin)return {error:'Nowy PIN musi być inny niż aktualny.',status:400};
    const digest=await d1PinDigest(env,pin);
    const used=await db.prepare('SELECT user_id FROM user_pin_credentials WHERE pin_digest=?').bind(digest).first();
    if(used&&used.user_id!==ctx.owner.id)return {error:'Ten PIN jest już przypisany do innego konta.',status:409};
    try {
      await db.batch([
        db.prepare('INSERT INTO user_pin_credentials(user_id,pin_digest) VALUES(?,?) '+
          'ON CONFLICT(user_id) DO UPDATE SET pin_digest=excluded.pin_digest,updated_at=CURRENT_TIMESTAMP')
          .bind(ctx.owner.id,digest),
        db.prepare('UPDATE panel_super_admin_security SET unified_pin=1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_user_id=?')
          .bind(OWNER_KEY,ctx.owner.id),
        audit('SUPER_ADMIN_PIN_CHANGE')
      ]);
    }catch(e){
      if(String(e?.message||'').toLowerCase().includes('unique'))
        return {error:'Ten PIN jest już używany. Wybierz inny.',status:409};
      throw e;
    }
    return {ok:true,changed:'pin'};
  }
  if(type==='password'){
    const password=body.newPassword;
    if(typeof password!=='string'||password.length<12||password.length>128||
       password!==body.confirmPassword)return {error:'Nowe hasło musi mieć 12–128 znaków i być identyczne w obu polach.',status:400};
    if(await ownerPasswordMatches(env,password,ctx))return {error:'Nowe hasło musi być inne niż obecne.',status:400};
    const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
    const digest=await derivedPassword(password,salt,ITERATIONS);
    await db.batch([
      db.prepare('UPDATE panel_super_admin_security SET password_hash=?,password_salt=?,password_iterations=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_user_id=?')
        .bind(digest,salt,ITERATIONS,OWNER_KEY,ctx.owner.id),
      audit('SUPER_ADMIN_PASSWORD_CHANGE')
    ]);
    return {ok:true,changed:'password'};
  }
  return {error:'Nieznany typ zmiany danych logowania.',status:400};
}
