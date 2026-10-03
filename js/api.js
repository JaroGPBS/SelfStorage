const API_URL = '/api';
const REQUEST_TIMEOUT_MS = 25000;
const SAVE_SESSION_TIMEOUT_MS = 60000;
const VEHICLE_META_TIMEOUT_MS = 8000;
const ADMIN_DATA_TIMEOUT_MS = 60000;

function isSafeDuplicateSessionResponse(action, data) {
  if (action !== 'ZAPISZ_SESJE') return false;

  const status = String(data?.status || '').trim().toUpperCase();
  const message = String(data?.error || data?.message || data?.szczegoly || '').trim().toLowerCase();

  if (status === 'DUPLIKAT' && !message.includes('zawartość sesji jest inna')) {
    return true;
  }

  return message.includes('sesja była już zapisana') &&
    !message.includes('zawartość sesji jest inna');
}

async function request(action, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Serwer zwrócił nieprawidłową odpowiedź.');
    }

    if (!response.ok) {
      throw new Error(data?.error || `Błąd HTTP ${response.status}`);
    }

    if (!data?.ok) {
      if (isSafeDuplicateSessionResponse(action, data)) {
        return {
          ...data,
          ok: true,
          duplicate: true
        };
      }

      throw new Error(data?.error || 'Operacja nie powiodła się.');
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Przekroczono czas oczekiwania na serwer.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  login(pin) {
    return request('LOGIN', { pin });
  },

  getStartData(idEkipy, fresh = false) {
    return request(
      'POBIERZ_DANE_STARTOWE',
      { idEkipy, fresh: Boolean(fresh) },
      fresh ? ADMIN_DATA_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    );
  },

  getVehicleSyncMeta(idEkipy, nazwaEkipy = '', idUrzadzenia = '') {
    return request(
      'SPRAWDZ_SYNC_AUTA',
      { idEkipy, nazwaEkipy, idUrzadzenia },
      VEHICLE_META_TIMEOUT_MS
    );
  },

  getVehicleStock(idEkipy, nazwaEkipy = '', idUrzadzenia = '') {
    return request('POBIERZ_STAN_AUTA', {
      idEkipy,
      nazwaEkipy,
      idUrzadzenia
    });
  },

  updateVehicleStock({ idEkipy, nazwaEkipy = '', idUrzadzenia = '', idZmiany, zmiany = [] }) {
    return request('AKTUALIZUJ_STAN_AUTA', {
      idEkipy,
      nazwaEkipy,
      idUrzadzenia,
      idZmiany,
      zmiany
    });
  },

  startVisit({ idEkipy, kodMagazynu, idWizyty }) {
    return request('SKAN_MAGAZYNU', {
      idEkipy,
      kodMagazynu,
      idWizyty
    });
  },

  saveSession(payload) {
    return request('ZAPISZ_SESJE', payload, SAVE_SESSION_TIMEOUT_MS);
  },

  endVisit({ idEkipy, idWizyty }) {
    return request('ZAKONCZ_WIZYTE', {
      idEkipy,
      idWizyty
    });
  },

  ping() {
    return request('PING');
  }
};
