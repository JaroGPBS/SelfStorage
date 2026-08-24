let scanner = null;
let locked = false;
let loaderPromise = null;
let audioContext = null;

const SCANNER_SRC = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

function prepareScanAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn('Nie udało się przygotować dźwięku skanera.', error);
  }
}

function playScanBeep() {
  try {
    if (!audioContext) {
      prepareScanAudio();
    }

    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1050, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.125);
  } catch (error) {
    console.warn('Nie udało się odtworzyć dźwięku skanera.', error);
  }
}

function loadScannerLibrary() {
  if (typeof window.Html5Qrcode !== 'undefined') {
    return Promise.resolve();
  }

  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCANNER_SRC}"]`);

    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Nie udało się załadować modułu skanera.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SCANNER_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nie udało się załadować modułu skanera.'));
    document.head.appendChild(script);
  }).catch(error => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
}

function getFormats() {
  const formats = window.Html5QrcodeSupportedFormats;
  if (!formats) return undefined;

  return [
    formats.QR_CODE,
    formats.CODE_128
  ];
}

function buildQrBox(mode) {
  return (viewfinderWidth, viewfinderHeight) => {
    if (mode === 'warehouse') {
      const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
      return { width: edge, height: edge };
    }

    const width = Math.floor(Math.min(viewfinderWidth * 0.9, 380));
    const height = Math.floor(Math.min(viewfinderHeight * 0.42, 220));
    return {
      width: Math.max(width, 220),
      height: Math.max(height, 130)
    };
  };
}

export async function startScanner(onCode, options = {}) {
  prepareScanAudio();
  await loadScannerLibrary();

  if (typeof window.Html5Qrcode === 'undefined') {
    throw new Error('Moduł skanera nie został załadowany.');
  }

  const mode = options.mode === 'warehouse' ? 'warehouse' : 'part';

  if (!scanner) {
    const formatsToSupport = getFormats();
    scanner = formatsToSupport
      ? new window.Html5Qrcode('reader', { formatsToSupport, verbose: false })
      : new window.Html5Qrcode('reader');
  }

  locked = false;

  await scanner.start(
    { facingMode: 'environment' },
    {
      fps: 12,
      qrbox: buildQrBox(mode),
      disableFlip: false
    },
    async decodedText => {
      if (locked) return;

      const code = String(decodedText || '').replace(/\u0000/g, '').trim();
      if (!code) return;

      locked = true;

      try {
        const accepted = await onCode(code);

        if (accepted === false) {
          setTimeout(() => {
            locked = false;
          }, 650);
          return;
        }

        playScanBeep();

        if (navigator.vibrate) {
          navigator.vibrate(45);
        }
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
