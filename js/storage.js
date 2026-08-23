const STATE_KEY = 'selfstorage_state_v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Nie udało się odczytać stanu lokalnego.', error);
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Nie udało się zapisać stanu lokalnego.', error);
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch (error) {
    console.warn('Nie udało się usunąć stanu lokalnego.', error);
  }
}
