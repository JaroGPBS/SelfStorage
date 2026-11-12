// GPBS Storage: optional per-user market and feature restrictions.
// Existing D1 warehouse grants remain intact; no retroactive migration is needed.
const FEATURES=['stocks','pz','wz','inventory','labels'];
export const ACCESS_FEATURES=Object.freeze(FEATURES);
// App access is independent of the job role. Missing settings keep the
// historical access of existing employees (no D1 migration or mass reset).
const APP_DEFAULTS={
  ADMIN:{mobile:true,office:true},
  KIEROWNIK:{mobile:true,office:true},
  KOORDYNATOR:{mobile:false,office:true},
  MAGAZYNIER:{mobile:true,office:true},
  EKIPA:{mobile:true,office:false}
};
function storedExtras(value){
  let parsed={};
  try{parsed=JSON.parse(value||'{}');}catch{}
  return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
}
export function parseAppAccess(role,value){
  const defaults=APP_DEFAULTS[String(role||'').toUpperCase()]||{mobile:false,office:false};
  const stored=storedExtras(value).apps;
  return {
    mobile:typeof stored?.mobile==='boolean'?stored.mobile:defaults.mobile,
    office:typeof stored?.office==='boolean'?stored.office:defaults.office
  };
}
export function validAppAccess(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')==='mobile,office'&&
    typeof value.mobile==='boolean'&&typeof value.office==='boolean';
}
export function serializeUserAccess(features,apps){
  return JSON.stringify({...features,apps:{mobile:apps.mobile,office:apps.office}});
}

export async function accessTableExists(db){
  return !!await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_access_settings'"
  ).first();
}

export async function ensureAccessTable(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS user_access_settings ('+
    'user_id TEXT PRIMARY KEY REFERENCES users(id),'+
    'pl_enabled INTEGER NOT NULL DEFAULT 0 CHECK(pl_enabled IN (0,1)),'+
    'fr_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fr_enabled IN (0,1)),'+
    "extra_permissions TEXT NOT NULL DEFAULT '{}',"+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}

export function parseExtraPermissions(value){
  const stored=storedExtras(value);
  return Object.fromEntries(FEATURES.map(k=>[k,stored[k]!==false]));
}
export function validExtraPermissions(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===FEATURES.length&&
    FEATURES.every(k=>typeof value[k]==='boolean');
}
export function ownerBySymbol(user){
  return String(user?.name||user?.nickname||'').trim().toUpperCase()==='JJ';
}
export async function deriveMarkets(db,userId){
  const rows=await db.prepare(
    "SELECT DISTINCT w.country_code FROM user_warehouse_access a "+
    "JOIN warehouses w ON w.id=a.warehouse_id "+
    "WHERE a.user_id=? AND w.country_code IN ('PL','FR')"
  ).bind(userId).all();
  const countries=new Set((rows.results||[]).map(r=>r.country_code));
  return {PL:countries.has('PL'),FR:countries.has('FR')};
}
export async function readUserAccess(db,user){
  if(ownerBySymbol(user))return {
    markets:{PL:true,FR:true},features:Object.fromEntries(FEATURES.map(k=>[k,true])),
    apps:{mobile:true,office:true},owner:true
  };
  const existing=await accessTableExists(db);
  const settings=existing?await db.prepare(
    'SELECT pl_enabled,fr_enabled,extra_permissions FROM user_access_settings WHERE user_id=?'
  ).bind(user.id).first():null;
  return {
    markets:settings?{PL:settings.pl_enabled===1,FR:settings.fr_enabled===1}
      :await deriveMarkets(db,user.id),
    features:parseExtraPermissions(settings?.extra_permissions),
    apps:parseAppAccess(user.role_code,settings?.extra_permissions),
    owner:false
  };
}
export async function effectiveAccessByUsers(db,users){
  const settings=await accessTableExists(db)
    ?(await db.prepare('SELECT user_id,pl_enabled,fr_enabled,extra_permissions FROM user_access_settings').all()).results||[]
    :[];
  const settingsById=new Map(settings.map(x=>[x.user_id,x]));
  return users.map(user=>{
    const row=settingsById.get(user.id);
    const derived=new Set(String(user.warehouse_countries||'').split(',').map(s=>s.trim()));
    const owner=ownerBySymbol(user);
    return {...user,
      market_pl:owner?1:row?Number(row.pl_enabled) :Number(derived.has('PL')),
      market_fr:owner?1:row?Number(row.fr_enabled) :Number(derived.has('FR')),
      extra_permissions:owner?Object.fromEntries(FEATURES.map(k=>[k,true])):
        parseExtraPermissions(row?.extra_permissions),
      app_mobile:owner?1:Number(parseAppAccess(user.role_code,row?.extra_permissions).mobile),
      app_office:owner?1:Number(parseAppAccess(user.role_code,row?.extra_permissions).office),
      owner_protected:owner?1:0};
  });
}
