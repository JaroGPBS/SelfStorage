// GPBS Storage — D1 PIN generator for the future administrative panel.
// DOES NOT modify production French authentication or mobile GPBS Storage.
// Security: disabled until explicitly configured, legacy ADMIN verification
// plus a separate long administrator setup secret. Avoid deploying a public
// 4-digit-only administrative endpoint.
//
// Required Cloudflare Pages configuration:
//   PL_PIN_GENERATOR_ENABLED = true    (Text, opt-in)
//   PIN_PEPPER                 = <random 32+ byte secret> (Secret)
//   PIN_ADMIN_SETUP_KEY        = <distinct long random secret> (Secret)
//   DB                         = gpbs-storage (existing D1 binding)
//
// Database: users, user_roles, user_pin_credentials as agreed.
// IMPORTANT: uniqueness is guaranteed within D1 only; reconcile existing
// Google Sheets/FR PINs before merging the two login namespaces.

const APPS_SCRIPT_FALLBACK =
  'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';

const ROLES = new Set(['ADMIN', 'KIEROWNIK', 'KOORDYNATOR', 'MAGAZYNIER', 'EKIPA']);
const MAX_BULK = 100;
const MAX_ATTEMPTS_PER_USER = 200;
const RESERVED_PINS = new Set(['0000']);

function answer(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function error(message, status = 400) {
  return answer({ ok: false, error: message }, status);
}

function hex(array) {
  return Array.from(new Uint8Array(array), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Random 0000-9999 without modulo bias, reserving demo PIN 0000.
function randomPin() {
  const bytes = new Uint16Array(1);
  while (true) {
    crypto.getRandomValues(bytes);
    if (bytes[0] >= 60000) continue;
    const pin = String(bytes[0] % 10000).padStart(4, '0');
    if (!RESERVED_PINS.has(pin)) return pin;
  }
}

async function pinKey(pepper) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function pinDigest(key, pin) {
  const result = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('GPBS:D1:PIN:v1:' + pin));
  return hex(result);
}

// Constant-length SHA-256 comparison prevents easy timing differences.
async function safeSecretEquals(received, expected) {
  if (typeof received !== 'string') return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function verifyLegacyAdmin(pin, env) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(env.APPS_SCRIPT_URL || APPS_SCRIPT_FALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'LOGIN', payload: { pin } }),
      signal: abort.signal,
      redirect: 'follow'
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true &&
      String(payload?.ekipa?.rola || '').trim().toUpperCase() === 'ADMIN' &&
      Boolean(String(payload?.ekipa?.id || '').trim());
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Error('Nieprawidłowe dane żądania.');
  }

  const action = String(body.action || '').trim();
  if (!['generate_missing', 'generate_one', 'reset_one'].includes(action)) {
    throw Error('Nieznana operacja generatora.');
  }

  const userId = String(body.userId || '').trim();
  if (action !== 'generate_missing' && !/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) {
    throw Error('Nieprawidłowy identyfikator użytkownika.');
  }

  let role = String(body.role || '').trim().toUpperCase();
  if (action === 'generate_missing' && role && !ROLES.has(role)) {
    throw Error('Nieprawidłowa rola.');
  }
  if (action !== 'generate_missing') role = '';
  return { action, userId, role };
}

async function loadUser(db, userId) {
  return db.prepare(
    'SELECT u.id, u.name, u.role_code FROM users u ' +
    'JOIN user_roles r ON r.code = u.role_code ' +
    'WHERE u.id = ? AND u.active = 1 LIMIT 1'
  ).bind(userId).first();
}

async function credential(db, userId) {
  return db.prepare('SELECT pin_digest FROM user_pin_credentials WHERE user_id = ? LIMIT 1')
    .bind(userId).first();
}

// Never replace an already-assigned PIN unless an authorized explicit reset
// operation is requested. Unique digest index prevents duplicates under races.
async function generateForUser(db, key, user, reset = false) {
  const existing = await credential(db, user.id);
  if (Boolean(existing) !== Boolean(reset)) {
    return { status: reset ? 'NO_EXISTING_PIN' : 'ALREADY_HAS_PIN', userId: user.id };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_USER; attempt++) {
    const pin = randomPin();
    const digest = await pinDigest(key, pin);
    // A reset must not accidentally re-issue the same PIN.
    if (reset && digest === existing.pin_digest) continue;
    try {
      let result;
      if (reset) {
        result = await db.prepare(
          'UPDATE user_pin_credentials SET pin_digest = ?, updated_at = CURRENT_TIMESTAMP ' +
          'WHERE user_id = ? AND pin_digest = ?'
        ).bind(digest, user.id, existing.pin_digest).run();
      } else {
        result = await db.prepare(
          'INSERT OR IGNORE INTO user_pin_credentials(user_id, pin_digest) VALUES (?, ?)'
        ).bind(user.id, digest).run();
      }

      if (Number(result?.meta?.changes || 0) === 1) {
        return {
          status: reset ? 'RESET' : 'GENERATED',
          userId: user.id,
          name: user.name,
          role: user.role_code,
          pin // Returned exactly once; never persisted or logged.
        };
      }

      if (reset) {
        return { status: 'CHANGED_CONCURRENTLY', userId: user.id };
      }
      if (await credential(db, user.id)) {
        return { status: 'ALREADY_HAS_PIN', userId: user.id };
      }
    } catch (cause) {
      const message = String(cause?.message || '').toLowerCase();
      if (message.includes('unique constraint') || message.includes('constraint failed')) {
        if (reset) {
          const current = await credential(db, user.id);
          if (!current || current.pin_digest !== existing.pin_digest) {
            return { status: 'CHANGED_CONCURRENTLY', userId: user.id };
          }
        }
        continue; // PIN was used by another account, retry with new PIN.
      }
      throw cause;
    }
  }

  throw Error('Wyczerpano dostępne próby nadania unikalnego PIN-u.');
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || env.PL_PIN_GENERATOR_ENABLED !== 'true' ||
      typeof env.PIN_PEPPER !== 'string' || env.PIN_PEPPER.length < 32 ||
      typeof env.PIN_ADMIN_SETUP_KEY !== 'string' || env.PIN_ADMIN_SETUP_KEY.length < 32) {
    return error('Generator PIN nie jest jeszcze skonfigurowany.', 503);
  }

  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return error('Niedozwolone pochodzenie żądania.', 403);
  }
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return error('Oczekiwano danych JSON.', 415);
  }

  let body, input;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return error('Zbyt duże żądanie.', 413);
    body = JSON.parse(raw);
    input = normalizeBody(body);
  } catch (cause) {
    return error(cause?.message || 'Niepoprawne dane.', 400);
  }

  // Administrative setup secret must be valid before ANY PIN-based auth lookup.
  // This avoids a publicly enumerable 4-digit administrator login endpoint.
  const control = request.headers.get('X-GPBS-Admin-Setup');
  if (!await safeSecretEquals(control, env.PIN_ADMIN_SETUP_KEY)) {
    return error('Brak uprawnień.', 403);
  }

  try {
    if (!await verifyLegacyAdmin(body.adminPin, env)) {
      return error('Brak uprawnień administratora.', 403);
    }

    const key = await pinKey(env.PIN_PEPPER);

    if (input.action === 'generate_missing') {
      const query = (
        'SELECT u.id, u.name, u.role_code FROM users u ' +
        'JOIN user_roles r ON r.code = u.role_code ' +
        'LEFT JOIN user_pin_credentials p ON p.user_id = u.id ' +
        'WHERE u.active = 1 AND p.user_id IS NULL ' +
        (input.role ? 'AND u.role_code = ? ' : '') +
        'ORDER BY u.created_at, u.id LIMIT ?'
      );
      const statement = env.DB.prepare(query);
      const result = input.role
        ? await statement.bind(input.role, MAX_BULK).all()
        : await statement.bind(MAX_BULK).all();
      const issued = [];
      let concurrent = 0;
      for (const user of result.results || []) {
        const output = await generateForUser(env.DB, key, user);
        if (output.pin) issued.push(output);
        else concurrent++;
      }

      return answer({
        ok: true,
        generated: issued.length,
        skippedConcurrent: concurrent,
        maxBatch: MAX_BULK,
        pins: issued,
        note: 'PIN-y są widoczne tylko w tej odpowiedzi. Zachowaj je bezpiecznie.'
      });
    }

    const user = await loadUser(env.DB, input.userId);
    if (!user) return error('Nie znaleziono aktywnego użytkownika.', 404);

    const result = await generateForUser(
      env.DB,
      key,
      user,
      input.action === 'reset_one'
    );
    if (!result.pin) {
      return error(
        result.status === 'ALREADY_HAS_PIN'
          ? 'Użytkownik ma już PIN. Użyj świadomej operacji resetowania.'
          : result.status === 'NO_EXISTING_PIN'
            ? 'Użytkownik nie ma jeszcze PIN-u.'
            : 'Dane użytkownika zostały zmienione równocześnie. Odśwież widok.',
        409
      );
    }
    return answer({ ok: true, ...result });
  } catch (cause) {
    console.error('GPBS admin PIN generator error:', cause?.name || 'Error');
    return error('Nie można wykonać operacji generatora.', 500);
  }
}

export function onRequestGet() {
  return error('Operacja dostępna tylko po autoryzacji POST.', 405);
}
