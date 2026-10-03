const DEVICE_ID_KEY = 'selfstorage_device_id_v1';

export function getDeviceId() {
  try {
    const existing = String(localStorage.getItem(DEVICE_ID_KEY) || '').trim();
    if (existing) return existing;

    const generated = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `DEV-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch (error) {
    console.warn('Nie udało się zapisać ID urządzenia.', error);
    return 'DEV-SESSION';
  }
}
