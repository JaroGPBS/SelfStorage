import { api } from './api.js';
import { loadState, saveState, clearState } from './storage.js';
import { startWarehouseScanner, stopWarehouseScanner } from './scanner.js';

const state = {
  team: null,
  startData: null,
  visit: null,
  pendingStart: null
};

let toastTimer = null;

function $(id) {
  return document.getElementById(id);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === id);
  });
}

function persist() {
  saveState(state);
}

function restore() {
  const saved = loadState();
  if (!saved) return;

  state.team = saved.team || null;
  state.startData = saved.startData || null;
  state.visit = saved.visit || null;
  state.pendingStart = saved.pendingStart || null;
}

function resetState() {
  state.team = null;
  state.startData = null;
  state.visit = null;
  state.pendingStart = null;
  clearState();
}

function setLoading(show, text = 'Proszę czekać…') {
  $('loadingText').textContent = text;
  $('loading').classList.toggle('show', Boolean(show));
  $('loading').setAttribute('aria-hidden', show ? 'false' : 'true');
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);

  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function messageFromError(error) {
  if (!error) return 'Wystąpił nieznany błąd.';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function updateNetworkUi() {
  const online = navigator.onLine;
  $('networkBadge').classList.toggle('offline', !online);
  $('networkText').textContent = online ? 'Online' : 'Offline';
}

function renderWarehouse() {
  $('teamName').textContent = state.team?.nazwa || 'Ekipa';
  $('teamRole').textContent = state.team?.rola || '';
  showScreen('screenWarehouse');
}

function renderVisit() {
  const warehouseName = state.visit?.magazyn?.nazwa || 'Magazyn';

  $('visitWarehouse').textContent = warehouseName;
  $('visitWarehouseShort').textContent = warehouseName;
  $('visitTeam').textContent = state.team?.nazwa || '—';
  $('visitId').textContent = state.visit?.idWizyty || '—';

  const canInventory = ['KIEROWNIK', 'ADMIN'].includes(state.team?.rola);
  $('inventoryBtn').classList.toggle('hidden', !canInventory);

  showScreen('screenVisit');
}

function makeVisitId() {
  const random = window.crypto?.randomUUID
    ? window.crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    : Math.random().toString(36).slice(2, 14).toUpperCase();

  return `WIZ-APP-${Date.now()}-${random}`;
}

async function login() {
  const pin = $('pinInput').value.replace(/\D/g, '').slice(0, 4);

  if (!/^\d{4}$/.test(pin)) {
    showToast('PIN musi mieć 4 cyfry.', true);
    return;
  }

  if (!navigator.onLine) {
    showToast('Pierwsze logowanie wymaga połączenia z internetem.', true);
    return;
  }

  setLoading(true, 'Logowanie…');

  try {
    const loginResult = await api.login(pin);
    const startData = await api.getStartData(loginResult.ekipa.id);

    state.team = loginResult.ekipa;
    state.startData = startData;
    state.visit = null;
    state.pendingStart = null;
    persist();

    $('pinInput').value = '';
    $('loginBtn').disabled = true;
    renderWarehouse();
  } catch (error) {
    showToast(messageFromError(error), true);
  } finally {
    setLoading(false);
  }
}

async function startVisit(code) {
  const cleanCode = String(code || '').trim().toUpperCase();

  if (!cleanCode) {
    showToast('Wpisz lub zeskanuj kod magazynu.', true);
    return;
  }

  if (!state.team) {
    resetState();
    showScreen('screenLogin');
    return;
  }

  if (!navigator.onLine) {
    showToast('Rozpoczęcie nowej wizyty wymaga teraz internetu.', true);
    return;
  }

  if (!state.pendingStart || state.pendingStart.code !== cleanCode) {
    state.pendingStart = {
      code: cleanCode,
      idWizyty: makeVisitId()
    };
    persist();
  }

  setLoading(true, 'Rozpoczynanie wizyty…');

  try {
    const result = await api.startVisit({
      idEkipy: state.team.id,
      kodMagazynu: cleanCode,
      idWizyty: state.pendingStart.idWizyty
    });

    state.visit = {
      idWizyty: result.idWizyty,
      start: result.start || null,
      status: result.status || 'AKTYWNA',
      magazyn: result.magazyn
    };
    state.pendingStart = null;
    persist();

    $('warehouseCodeInput').value = '';
    renderVisit();
    showToast(`Zalogowano: ${state.team.nazwa}, magazyn: ${state.visit.magazyn.nazwa}`);
  } catch (error) {
    showToast(messageFromError(error), true);
  } finally {
    setLoading(false);
  }
}

async function openScanner() {
  $('scannerModal').classList.add('show');
  $('scannerModal').setAttribute('aria-hidden', 'false');

  try {
    await startWarehouseScanner(async code => {
      await closeScanner();
      await startVisit(code);
    });
  } catch (error) {
    await closeScanner();
    showToast(`Nie udało się uruchomić aparatu. ${messageFromError(error)}`, true);
  }
}

async function closeScanner() {
  try {
    await stopWarehouseScanner();
  } catch (error) {
    console.warn('Błąd przy zamykaniu skanera.', error);
  }

  $('scannerModal').classList.remove('show');
  $('scannerModal').setAttribute('aria-hidden', 'true');
}

async function finishVisit() {
  if (!state.team || !state.visit) return;

  if (!navigator.onLine) {
    showToast('Zakończenie wizyty wymaga teraz internetu.', true);
    return;
  }

  $('finishModal').classList.remove('show');
  $('finishModal').setAttribute('aria-hidden', 'true');
  setLoading(true, 'Zamykanie wizyty…');

  try {
    await api.endVisit({
      idEkipy: state.team.id,
      idWizyty: state.visit.idWizyty
    });

    resetState();
    showScreen('screenDone');

    setTimeout(() => {
      showScreen('screenLogin');
    }, 2200);
  } catch (error) {
    showToast(messageFromError(error), true);
  } finally {
    setLoading(false);
  }
}

function logout() {
  if (state.visit) {
    showToast('Najpierw zakończ aktywną wizytę.', true);
    return;
  }

  resetState();
  $('warehouseCodeInput').value = '';
  showScreen('screenLogin');
}

function bindEvents() {
  $('pinInput').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
    $('loginBtn').disabled = event.target.value.length !== 4;
  });

  $('pinInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.value.length === 4) login();
  });

  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', logout);
  $('openScannerBtn').addEventListener('click', openScanner);
  $('closeScannerBtn').addEventListener('click', closeScanner);

  $('manualWarehouseBtn').addEventListener('click', () => {
    startVisit($('warehouseCodeInput').value);
  });

  $('warehouseCodeInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') startVisit(event.target.value);
  });

  $('finishVisitBtn').addEventListener('click', () => {
    $('finishModal').classList.add('show');
    $('finishModal').setAttribute('aria-hidden', 'false');
  });

  $('finishNoBtn').addEventListener('click', () => {
    $('finishModal').classList.remove('show');
    $('finishModal').setAttribute('aria-hidden', 'true');
  });

  $('finishYesBtn').addEventListener('click', finishVisit);

  $('pobranieBtn').addEventListener('click', () => {
    showToast('Pobranie dołączymy w następnym etapie.');
  });

  $('zwrotBtn').addEventListener('click', () => {
    showToast('Zwrot dołączymy w następnym etapie.');
  });

  $('inventoryBtn').addEventListener('click', () => {
    showToast('Inwentaryzację dołączymy po Pobranie / Zwrot.');
  });

  window.addEventListener('online', updateNetworkUi);
  window.addEventListener('offline', updateNetworkUi);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (error) {
    console.warn('Nie udało się zarejestrować Service Workera.', error);
  }
}

function init() {
  restore();
  bindEvents();
  updateNetworkUi();
  registerServiceWorker();

  if (state.team && state.visit?.idWizyty) {
    renderVisit();
  } else if (state.team) {
    renderWarehouse();
  } else {
    showScreen('screenLogin');
  }
}

document.addEventListener('DOMContentLoaded', init);
