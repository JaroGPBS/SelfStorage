// GPBS Storage — shared verification for the isolated Polish worker API.
// DO NOT use this module to authenticate the legacy French /api gateway.
const textEncoder = new TextEncoder();
const COOKIE = '__Host-gpbs_pl_worker';
const LIFETIME_MS = 8 * 60 * 60 * 1000;
const AUDIENCE = 'GPBS-PL-WORKER-v1';

function base64url(bytes) {
  let str = '';
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw Error('Invalid token');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function sessionKey(secret) {
  return crypto.subtle.importKey(
    'raw', textEncoder.encode('GPBS:PL:WORKER:SESSION:v1:' + secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function credentialStamp(key, pinDigest) {
  // PIN hash never goes into the cookie. Changing or removing the PIN
  // invalidates every previously issued session for this particular user.
  const tag = await crypto.subtle.sign('HMAC', key,
    textEncoder.encode('GPBS:PL:WORKER:CREDENTIAL:' + pinDigest));
  return base64url(new Uint8Array(tag).slice(0, 16));
}

async function loadUserWithWarehouses(env, userId) {
  // Fail closed if the archive table does not exist.
  const user = await env.DB.prepare(
    'SELECT u.id,u.name,u.role_code,u.active,c.pin_digest,ar.user_id AS archived ' +
    'FROM users u ' +
    'LEFT JOIN user_pin_credentials c ON c.user_id=u.id ' +
    'LEFT JOIN user_archives ar ON ar.user_id=u.id ' +
    'WHERE u.id=? LIMIT 1'
  ).bind(userId).first();
  if (!user || user.active !== 1 || user.archived || !user.pin_digest) return null;

  const response = await env.DB.prepare(
    "SELECT w.id,w.name,w.country_code FROM user_warehouse_access a " +
    "JOIN warehouses w ON w.id=a.warehouse_id " +
    "WHERE a.user_id=? AND w.active=1 AND w.country_code='PL' " +
    "ORDER BY w.name"
  ).bind(user.id).all();

  const warehouses = response.results || [];
  if (warehouses.length === 0) return null;

  return {
    id: user.id,
    nickname: user.name,
    role: user.role_code,
    warehouses: warehouses.map(w => ({ id: w.id, name: w.name })),
    pinDigest: user.pin_digest
  };
}

export function workerAuthReady(env) {
  return Boolean(env?.DB &&
    typeof env.PIN_PEPPER === 'string' && env.PIN_PEPPER.length >= 32 &&
    typeof env.PANEL_SESSION_SECRET === 'string' && env.PANEL_SESSION_SECRET.length >= 32);
}

export function workerCookie(value, maxAge = 8 * 60 * 60) {
  return COOKIE + '=' + value +
    '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + maxAge;
}

export async function createWorkerSession(env, user) {
  const key = await sessionKey(env.PANEL_SESSION_SECRET);
  const issuedAt = Date.now();
  const payload = textEncoder.encode(JSON.stringify({
    v: 1,
    aud: AUDIENCE,
    uid: user.id,
    stamp: await credentialStamp(key, user.pinDigest),
    iat: issuedAt,
    exp: issuedAt + LIFETIME_MS,
    nonce: crypto.randomUUID()
  }));
  const signature = await crypto.subtle.sign('HMAC', key, payload);
  return base64url(payload) + '.' + base64url(signature);
}

export async function loadActiveWorker(env, userId) {
  if (!workerAuthReady(env)) return null;
  if (!/^GPBS-U-[a-f0-9-]{36}$/.test(String(userId || ''))) return null;
  return loadUserWithWarehouses(env, userId);
}

export async function verifyWorkerSession(request, env) {
  if (!workerAuthReady(env)) return null;
  const header = request.headers.get('Cookie') || '';
  const cookie = header.split(';').map(x => x.trim())
    .find(x => x.startsWith(COOKIE + '='));
  if (!cookie) return null;
  const value = cookie.slice(COOKIE.length + 1);
  if (value.length > 2400) return null;
  const pair = value.split('.');
  if (pair.length !== 2) return null;

  try {
    const raw = fromBase64url(pair[0]);
    const signature = fromBase64url(pair[1]);
    const key = await sessionKey(env.PANEL_SESSION_SECRET);
    if (!await crypto.subtle.verify('HMAC', key, signature, raw)) return null;
    const payload = JSON.parse(new TextDecoder().decode(raw));
    const now = Date.now();
    if (payload.v !== 1 || payload.aud !== AUDIENCE ||
      !/^GPBS-U-[a-f0-9-]{36}$/.test(payload.uid || '') ||
      !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) ||
      payload.iat > now + 60000 || payload.exp <= now ||
      payload.exp > payload.iat + LIFETIME_MS ||
      typeof payload.stamp !== 'string') return null;

    const user = await loadUserWithWarehouses(env, payload.uid);
    if (!user) return null;
    if (payload.stamp !== await credentialStamp(key, user.pinDigest)) return null;
    // Never expose the credential digest to clients or other endpoints.
    const { pinDigest, ...safeUser } = user;
    return safeUser;
  } catch {
    return null;
  }
}

export function workerJson(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extra
    }
  });
}
