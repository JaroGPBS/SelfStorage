// GPBS Storage PL: read-only, admin-gated catalog.
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return reply({ ok: false, error: 'Niedozwolone pochodzenie żądania.' }, 403);
  }

  if (!env.DB) {
    return reply({ ok: false, error: 'Brak połączenia D1.' }, 503);
  }

  let pin;
  try {
    const data = await request.json();
    pin = data?.pin;
  } catch {
    return reply({ ok: false, error: 'Nieprawidłowe dane logowania.' }, 400);
  }

  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return reply({ ok: false, error: 'Wpisz czterocyfrowy PIN administratora.' }, 400);
  }

  try {
    // Server-side verification: the existing GPBS login service remains the
    // sole authority for admin role. No trust is placed in browser localStorage.
    const authResponse = await fetch(env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'LOGIN', payload: { pin } }),
      redirect: 'follow'
    });

    if (!authResponse.ok) {
      return reply({ ok: false, error: 'Nie udało się zweryfikować uprawnień.' }, 503);
    }

    const auth = await authResponse.json();
    if (!auth?.ok || String(auth?.ekipa?.rola || '').trim().toUpperCase() !== 'ADMIN') {
      return reply({ ok: false, error: 'Brak uprawnień administratora.' }, 403);
    }

    const result = await env.DB.prepare(
      'SELECT id, part_number, name, sap_number FROM parts WHERE active = 1 ORDER BY name COLLATE NOCASE LIMIT 1000'
    ).all();

    return reply({ ok: true, parts: result.results || [], source: 'D1', warehouse: 'Tychy' });
  } catch (error) {
    console.error('GPBS D1 admin catalog failed:', error);
    return reply({ ok: false, error: 'Nie udało się pobrać katalogu części.' }, 500);
  }
}

export function onRequestGet() {
  return reply({ ok: false, error: 'Użyj bezpiecznego żądania POST.' }, 405);
}
