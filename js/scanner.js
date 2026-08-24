let scanner = null;
let locked = false;
let loaderPromise = null;

const SCANNER_SRC = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

function loadScannerLibrary() {
  if (typeof window.Html5Qrcode !== 'undefined') {
    return Promise.resolve();
  }

  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCANNER_SRC}"]`);

    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Nie udało się pobrać modułu skanera.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SCANNER_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nie udało się pobrać modułu skanera.'));
    document.head.appendChild(script);
  }).catch(error => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
}

export async function startScanner(onCode) {
  await loadScannerLibrary();

  if (typeof window.Html5Qrcode === 'undefined') {
    throw new Error('Moduł skanera nie został załadowany.');
  }

  if (!scanner) {
    scanner = new window.Html5Qrcode('reader');
  }

  locked = false;

  await scanner.start(
    { facingMode: 'environment' },
    {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1
    },
    async decodedText => {
      if (locked) return;

      const code = String(decodedText || '').trim();
      if (!code) return;

      locked = true;

      try {
        await onCode(code);
      } catch (error) {
        locked = false;
        throw error;
      }
    },
    () => {}
  );
}

export async function stopScanner() {
  try {
    if (scanner && scanner.isScanning) {
      await scanner.stop();
    }
  } finally {
    locked = false;
  }
}

export const startWarehouseScanner = startScanner;
export const stopWarehouseScanner = stopScanner;
