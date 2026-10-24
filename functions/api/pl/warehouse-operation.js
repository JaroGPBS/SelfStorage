// GPBS Storage — warehouse PZ/WZ test operations against Cloudflare D1.
// This endpoint is separate from the production French /api gateway.
// Fail-closed: it is disabled unless PL_TEST_WRITES_ENABLED=true is configured
// in Cloudflare Pages. It ONLY accepts warehouse PL-TEST (never PL-TYCHY).
// For now, only a current ADMIN PIN validated server-side by Apps Script may
// execute test operations. Replace this with scoped web sessions before go-live.

const APPS_SCRIPT_FALLBACK =
  'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';

const TEST_WAREHOUSE = 'PL-TEST';
const MAX_LINES = 100;
const MAX_QUANTITY = 100000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function bad(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function normalizeOperation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('Nieprawidłowa operacja.');
  }

  const operationId = String(input.operationId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(operationId)) {
    throw Error('Brak poprawnego identyfikatora operacji.');
  }

  const warehouseId = String(input.warehouseId || '').trim();
  if (warehouseId !== TEST_WAREHOUSE) {
    throw Error('Operacje są obecnie dozwolone tylko w PL-TEST.');
  }

  const type = String(input.type || '').trim().toUpperCase();
  if (type !== 'PZ' && type !== 'WZ') {
    throw Error('Dozwolone rodzaje operacji: PZ i WZ.');
  }

  const recipientName = String(input.recipientName || '').trim();
  const notes = String(input.notes || '').trim();
  if (recipientName.length > 120 || notes.length > 500) {
    throw Error('Zbyt długi opis operacji.');
  }
  if (type === 'WZ' && recipientName.length < 2) {
    throw Error('Podaj nazwę odbiorcy dla wydania WZ.');
  }

  if (!Array.isArray(input.lines) || input.lines.length < 1 ||
      input.lines.length > MAX_LINES) {
    throw Error('Podaj od 1 do 100 pozycji części.');
  }

  const seen = new Set();
  const lines = input.lines.map(line => {
    const partId = String(line?.partId || '').trim();
    const quantity = line?.quantity;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(partId)) {
      throw Error('Nieprawidłowy identyfikator części.');
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw Error('Ilość musi być liczbą całkowitą od 1 do 100000.');
    }
    if (seen.has(partId)) {
      throw Error('Ta sama część występuje dwa razy. Połącz ilości.');
    }
    seen.add(partId);
    return { partId, quantity };
  });

  return { operationId, warehouseId, type, recipientName, notes, lines };
}

async function verifyAdmin(pin, env) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return { ok: false, status: 401, error: 'Wymagany jest PIN administratora.' };
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25000);
  try {
    const response = await fetch(env.APPS_SCRIPT_URL || APPS_SCRIPT_FALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'LOGIN', payload: { pin } }),
      redirect: 'follow',
      signal: abort.signal
    });
    if (!response.ok) {
      return { ok: false, status: 503, error: 'Nie udało się zweryfikować logowania.' };
    }

    const data = await response.json();
    const team = data?.ekipa;
    const role = String(team?.rola || '').trim().toUpperCase();
    const actorId = String(team?.id || '').trim();
    if (!data?.ok || role !== 'ADMIN' || !actorId) {
      return { ok: false, status: 403, error: 'Brak uprawnień administratora.' };
    }
    return { ok: true, actorId };
  } catch {
    return { ok: false, status: 503, error: 'Usługa weryfikacji PIN jest niedostępna.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDuplicate(db, input, actorId) {
  const existing = await db.prepare(
    'SELECT id, warehouse_id, operation_type, operator_id, recipient_name, notes FROM warehouse_operations WHERE id = ?'
  ).bind(input.operationId).first();

  if (!existing) return null;

  const savedLines = (await db.prepare(
    'SELECT part_id, quantity_delta FROM warehouse_operation_lines WHERE operation_id = ?'
  ).bind(input.operationId).all()).results || [];

  const requested = new Map(input.lines.map(line => [
    line.partId,
    (input.type === 'PZ' ? 1 : -1) * line.quantity
  ]));

  const same =
    existing.warehouse_id === input.warehouseId &&
    existing.operation_type === input.type &&
    existing.operator_id === actorId &&
    String(existing.recipient_name || '') === input.recipientName &&
    String(existing.notes || '') === input.notes &&
    savedLines.length === requested.size &&
    savedLines.every(row => requested.get(row.part_id) === row.quantity_delta);

  if (!same) {
    return bad('Identyfikator tej operacji jest już używany dla innych danych.', 409);
  }

  return json({
    ok: true,
    operationId: input.operationId,
    warehouseId: input.warehouseId,
    type: input.type,
    alreadySaved: true,
    message: 'Ta operacja była już zapisana. Stanów nie zmieniono ponownie.'
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return bad('Brak połączenia D1.', 503);

  // Disabled by default, independently of the existing production API.
  if (env.PL_TEST_WRITES_ENABLED !== 'true') {
    return bad('Testowe PZ/WZ są jeszcze wyłączone w konfiguracji.', 503);
  }

  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return bad('Żądanie z niedozwolonej strony.', 403);
  }

  if (!(request.headers.get('Content-Type') || '').toLowerCase()
      .startsWith('application/json')) {
    return bad('Oczekiwano application/json.', 415);
  }

  let data;
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 40000) return bad('Zbyt duże żądanie.', 413);
    data = JSON.parse(raw);
    input = normalizeOperation(data);
  } catch (error) {
    return bad(error?.message || 'Nieprawidłowe dane.');
  }

  const verified = await verifyAdmin(data?.pin, env);
  if (!verified.ok) return bad(verified.error, verified.status);
  const actorId = verified.actorId;

  try {
    const duplicate = await checkDuplicate(env.DB, input, actorId);
    if (duplicate) return duplicate;

    // Confirm warehouse and active part identifiers before any write.
    const wh = await env.DB.prepare(
      'SELECT id FROM warehouses WHERE id = ?'
    ).bind(TEST_WAREHOUSE).first();
    if (!wh) return bad('Brak magazynu PL-TEST.', 404);

    const placeholders = input.lines.map(() => '?').join(', ');
    const partIds = input.lines.map(line => line.partId);
    const result = await env.DB.prepare(
      `SELECT id FROM parts WHERE active = 1 AND id IN (${placeholders})`
    ).bind(...partIds).all();

    if ((result.results || []).length !== partIds.length) {
      return bad('Niektóre części nie istnieją lub są nieaktywne.', 400);
    }

    // D1 batch() runs as one transaction; a failed CHECK rolls back
    // the operation header, its lines and all stock updates.
    const statements = [
      env.DB.prepare(
        'INSERT INTO warehouse_operations ' +
        '(id, warehouse_id, operation_type, operator_id, recipient_name, notes) ' +
        'VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        input.operationId,
        input.warehouseId,
        input.type,
        actorId,
        input.recipientName || null,
        input.notes || null
      )
    ];

    for (const [index, line] of input.lines.entries()) {
      const delta = (input.type === 'PZ' ? 1 : -1) * line.quantity;

      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO warehouse_stock (warehouse_id, part_id, quantity) ' +
          'VALUES (?, ?, 0)'
        ).bind(input.warehouseId, line.partId)
      );

      // Snapshot before/after is calculated *inside* the transaction.
      // When stock is insufficient, quantity_after violates the existing
      // CHECK(quantity_after >= 0), rolling the entire batch back.
      statements.push(
        env.DB.prepare(
          'INSERT INTO warehouse_operation_lines ' +
          '(id, operation_id, part_id, quantity_delta, quantity_before, quantity_after) ' +
          'SELECT ?, ?, ?, ?, quantity, quantity + ? ' +
          'FROM warehouse_stock WHERE warehouse_id = ? AND part_id = ?'
        ).bind(
          input.operationId + ':' + (index + 1),
          input.operationId,
          line.partId,
          delta,
          delta,
          input.warehouseId,
          line.partId
        )
      );

      statements.push(
        env.DB.prepare(
          'UPDATE warehouse_stock SET quantity = quantity + ?, ' +
          'updated_at = CURRENT_TIMESTAMP ' +
          'WHERE warehouse_id = ? AND part_id = ?'
        ).bind(delta, input.warehouseId, line.partId)
      );
    }

    statements.push(
      env.DB.prepare(
        `SELECT part_id, quantity FROM warehouse_stock WHERE warehouse_id = ? AND part_id IN (${placeholders})`
      ).bind(input.warehouseId, ...partIds)
    );

    const output = await env.DB.batch(statements);
    const finalRows = output[output.length - 1]?.results || [];
    const endingStock = new Map(finalRows.map(row => [row.part_id, row.quantity]));

    return json({
      ok: true,
      operationId: input.operationId,
      warehouseId: input.warehouseId,
      type: input.type,
      alreadySaved: false,
      lines: input.lines.map(line => ({
        partId: line.partId,
        quantity: line.quantity,
        stockAfter: endingStock.get(line.partId)
      }))
    });
  } catch (error) {
    // Idempotent retry if the request was committed but the response lost.
    const existing = await checkDuplicate(env.DB, input, actorId).catch(() => null);
    if (existing) return existing;

    const message = String(error?.message || '').toLowerCase();
    if (message.includes('check constraint failed')) {
      return bad('Nie można wydać więcej części niż jest na stanie.', 409);
    }
    console.error('GPBS PL test PZ/WZ failed:', error);
    return bad('Operacja nie została zapisana. Sprawdź dane i spróbuj ponownie.', 500);
  }
}

export function onRequestGet() {
  return bad('Endpoint przyjmuje wyłącznie POST.', 405);
}
