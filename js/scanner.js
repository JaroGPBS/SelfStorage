let scanner = null;
let locked = false;

export async function startScanner(onCode) {
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

// Zgodność z pierwszą wersją aplikacji.
export const startWarehouseScanner = startScanner;
export const stopWarehouseScanner = stopScanner;
