let scanner = null;
let locked = false;

export async function startWarehouseScanner(onCode) {
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
      await onCode(code);
    },
    () => {}
  );
}

export async function stopWarehouseScanner() {
  try {
    if (scanner && scanner.isScanning) {
      await scanner.stop();
    }
  } finally {
    locked = false;
  }
}
