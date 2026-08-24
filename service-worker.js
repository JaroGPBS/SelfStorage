const CACHE_NAME = 'selfstorage-shell-v14';
const SCANNER_LIBRARY_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

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
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.href === SCANNER_LIBRARY_URL) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(SCANNER_LIBRARY_URL);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          await cache.put(SCANNER_LIBRARY_URL, response.clone());
          return response;
        } catch (error) {
          return Response.error();
        }
      })
    );
    return;
  }

  if (url.pathname.startsWith('/api')) return;
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
