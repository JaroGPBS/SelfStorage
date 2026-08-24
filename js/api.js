const API_URL = '/api';
const REQUEST_TIMEOUT_MS = 25000;

async function request(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

  getStartData(idEkipy) {
    return request('POBIERZ_DANE_STARTOWE', { idEkipy });
  },

  startVisit({ idEkipy, kodMagazynu, idWizyty }) {
    return request('SKAN_MAGAZYNU', {
      idEkipy,
      kodMagazynu,
      idWizyty
    });
  },

  saveSession(payload) {
    return request('ZAPISZ_SESJE', payload);
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
