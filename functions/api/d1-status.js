// Read-only Cloudflare D1 connectivity check for the GPBS Storage rollout.
// No shared Google Sheets API routes or production warehouse records are modified.
export async function onRequestGet({ env }) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff'
  };

  if (!env.DB) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Brak polaczenia z baza D1 (binding DB).'
    }), { status: 503, headers });
  }

  try {
    const parts = await env.DB.prepare('SELECT COUNT(*) AS total FROM parts').first();
    const tychy = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM warehouses WHERE id = 'PL-TYCHY' AND active = 1"
    ).first();

    return new Response(JSON.stringify({
      ok: true,
      database: 'gpbs-storage',
      parts_count: Number(parts?.total ?? 0),
      tychy_configured: Number(tychy?.total ?? 0) === 1,
      mode: 'read-only'
    }), { status: 200, headers });
  } catch (error) {
    console.error('GPBS D1 connectivity check failed:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Nie udalo sie odczytac danych z D1.'
    }), { status: 500, headers });
  }
}

export function onRequestPost() {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
  });
}
