const CACHE_NAME = 'selfstorage-shell-v16';
const SCANNER_LIBRARY_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const LOCAL_DATA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const API_CACHE_DB = 'selfstorage-api-cache-v1';
const API_CACHE_STORE = 'entries';
const TEAM_CACHE_KEY = 'team';
const START_DATA_CACHE_KEY = 'startData';
const WAREHOUSE_CACHE_PREFIX = 'warehouse:';
const PENDING_VISIT_PREFIX = 'pendingVisit:';
const pendingVisitSyncs = new Map();

const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/storage.js',
  './js/scanner.js',
  './js/offline.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/gpbs-logo.svg',
  './icons/jaro-signature.svg'
];

function openApiCacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(API_CACHE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(API_CACHE_STORE)) {
        db.createObjectStore(API_CACHE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readApiCache(key) {
  const db = await openApiCacheDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(API_CACHE_STORE, 'readonly');
    const request = tx.objectStore(API_CACHE_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeApiCache(key, value) {
  const db = await openApiCacheDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(API_CACHE_STORE, 'readwrite');
    tx.objectStore(API_CACHE_STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function deleteApiCache(key) {
  const db = await openApiCacheDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(API_CACHE_STORE, 'readwrite');
    tx.objectStore(API_CACHE_STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function isFresh(entry) {
  const verifiedAt = Number(entry?.verifiedAt || 0);
  return verifiedAt > 0 && Date.now() - verifiedAt < LOCAL_DATA_MAX_AGE_MS;
}

async function hashPin(pin) {
  const value = `selfstorage-local-login:${String(pin || '')}`;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readResponseJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function normalizeWarehouseCode(value) {
  return String(value || '').trim().toUpperCase();
}

function pendingVisitKey(visitId) {
  return `${PENDING_VISIT_PREFIX}${String(visitId || '')}`;
}

async function postApiPayload(incoming) {
  return fetch('/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(incoming)
  });
}

async function cacheWarehouse(code, warehouse) {
  const cleanCode = normalizeWarehouseCode(code);
  if (!cleanCode || !warehouse) return;

  await writeApiCache(`${WAREHOUSE_CACHE_PREFIX}${cleanCode}`, {
    warehouse,
    verifiedAt: Date.now()
  });
}

async function syncPendingVisitStart(visitId) {
  const id = String(visitId || '').trim();
  if (!id) return true;

  if (pendingVisitSyncs.has(id)) {
    return pendingVisitSyncs.get(id);
  }

  const promise = (async () => {
    const key = pendingVisitKey(id);
    const pending = await readApiCache(key);
    if (!pending?.incoming) return true;

    try {
      const response = await postApiPayload(pending.incoming);
      const data = await readResponseJson(response);

      if (!response.ok || !data?.ok) {
        return false;
      }

      const code = pending.incoming?.payload?.kodMagazynu;
      if (data.magazyn) {
        await cacheWarehouse(code, data.magazyn);
      }

      await deleteApiCache(key);
      return true;
    } catch (error) {
      console.warn('Nie udało się zsynchronizować rozpoczęcia wizyty.', error);
      return false;
    }
  })().finally(() => {
    pendingVisitSyncs.delete(id);
  });

  pendingVisitSyncs.set(id, promise);
  return promise;
}

async function handleStartVisitRequest(request, incoming, event) {
  const code = normalizeWarehouseCode(incoming?.payload?.kodMagazynu);
  const visitId = String(incoming?.payload?.idWizyty || '').trim();

  if (code && visitId) {
    try {
      const cached = await readApiCache(`${WAREHOUSE_CACHE_PREFIX}${code}`);

      if (cached?.warehouse && isFresh(cached)) {
        await writeApiCache(pendingVisitKey(visitId), {
          incoming,
          createdAt: Date.now()
        });

        const syncPromise = syncPendingVisitStart(visitId);
        event?.waitUntil(syncPromise);

        return jsonResponse({
          ok: true,
          idWizyty: visitId,
          start: new Date().toISOString(),
          status: 'AKTYWNA',
          magazyn: cached.warehouse,
          localCache: true
        });
      }
    } catch (error) {
      console.warn('Nie udało się użyć lokalnej pamięci magazynu.', error);
    }
  }

  const response = await fetch(request);
  const data = await readResponseJson(response);

  if (response.ok && data?.ok && code && data?.magazyn) {
    try {
      await cacheWarehouse(code, data.magazyn);
    } catch (error) {
      console.warn('Nie udało się zapisać magazynu w pamięci telefonu.', error);
    }
  }

  return response;
}

async function ensureVisitStartBeforeRequest(incoming) {
  const visitId = String(incoming?.payload?.idWizyty || '').trim();
  if (!visitId) return true;
  return syncPendingVisitStart(visitId);
}

async function handleLoginRequest(request, incoming) {
  const pin = String(incoming?.payload?.pin || '').trim();

  if (/^\d{4}$/.test(pin)) {
    try {
      const pinHash = await hashPin(pin);
      const cached = await readApiCache(TEAM_CACHE_KEY);

      if (cached?.pinHash === pinHash && cached?.team && isFresh(cached)) {
        return jsonResponse({
          ok: true,
          ekipa: cached.team,
          localCache: true
        });
      }
    } catch (error) {
      console.warn('Nie udało się odczytać lokalnej pamięci ekipy.', error);
    }
  }

  const response = await fetch(request);
  const data = await readResponseJson(response);

  if (response.ok && data?.ok && data?.ekipa && /^\d{4}$/.test(pin)) {
    try {
      const pinHash = await hashPin(pin);
      const previousTeam = await readApiCache(TEAM_CACHE_KEY);
      const teamChanged = previousTeam?.team?.id && previousTeam.team.id !== data.ekipa.id;

      await writeApiCache(TEAM_CACHE_KEY, {
        pinHash,
        team: data.ekipa,
        verifiedAt: Date.now()
      });

      if (teamChanged) {
        await deleteApiCache(START_DATA_CACHE_KEY);
      }
    } catch (error) {
      console.warn('Nie udało się zapisać lokalnej pamięci ekipy.', error);
    }
  }

  return response;
}

async function handleStartDataRequest(request, incoming) {
  const teamId = String(incoming?.payload?.idEkipy || '').trim();

  if (teamId) {
    try {
      const cached = await readApiCache(START_DATA_CACHE_KEY);
      if (cached?.teamId === teamId && cached?.data && isFresh(cached)) {
        return jsonResponse(cached.data);
      }
    } catch (error) {
      console.warn('Nie udało się odczytać lokalnej listy części.', error);
    }
  }

  const response = await fetch(request);
  const data = await readResponseJson(response);

  if (response.ok && data?.ok && teamId) {
    try {
      await writeApiCache(START_DATA_CACHE_KEY, {
        teamId,
        data,
        verifiedAt: Date.now()
      });
    } catch (error) {
      console.warn('Nie udało się zapisać lokalnej listy części.', error);
    }
  }

  return response;
}

async function handleApiRequest(request, event) {
  let incoming;

  try {
    incoming = await request.clone().json();
  } catch {
    return fetch(request);
  }

  if (incoming?.action === 'LOGIN') {
    return handleLoginRequest(request, incoming);
  }

  if (incoming?.action === 'POBIERZ_DANE_STARTOWE') {
    return handleStartDataRequest(request, incoming);
  }

  if (incoming?.action === 'SKAN_MAGAZYNU') {
    return handleStartVisitRequest(request, incoming, event);
  }

  if (incoming?.action === 'ZAPISZ_SESJE' || incoming?.action === 'ZAKONCZ_WIZYTE') {
    const visitReady = await ensureVisitStartBeforeRequest(incoming);
    if (!visitReady) {
      return jsonResponse({
        ok: false,
        error: 'Rozpoczęcie wizyty nie zostało jeszcze potwierdzone przez serwer. Aplikacja ponowi próbę automatycznie.'
      });
    }
  }

  return fetch(request);
}

async function cacheScannerLibrary(cache) {
  try {
    const request = new Request(SCANNER_LIBRARY_URL, {
      mode: 'no-cors',
      cache: 'no-store'
    });
    const response = await fetch(request);
    await cache.put(SCANNER_LIBRARY_URL, response.clone());
  } catch (error) {
    console.warn('Nie udało się wstępnie zapisać biblioteki skanera w cache.', error);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL);
      await cacheScannerLibrary(cache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api')) {
    if (request.method === 'POST') {
      event.respondWith(handleApiRequest(request, event));
    }
    return;
  }

  if (request.method !== 'GET') return;

  if (url.href === SCANNER_LIBRARY_URL) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(SCANNER_LIBRARY_URL);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          await cache.put(SCANNER_LIBRARY_URL, response.clone());
          return response;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
