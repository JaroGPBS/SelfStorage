import { api } from './api.js';

const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';
const SYNC_LOCK_KEY = 'selfstorage_sync_lock_v1';
const AUTO_SYNC_DELAY_MS = 5000;
const RETRY_DELAYS_MS = [5000, 5000, 10000, 15000, 30000];
const SYNC_LOCK_TTL_MS = 75000;
const INSTANCE_ID = window.crypto?.randomUUID
  ? window.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let syncRunning = false;
let connectionCheckRunning = false;
let offlineSendBusy = false;
let autoSyncTimer = null;
let retryIndex = 0;

function $(id) {
  return document.getElementById(id);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Nie udało się odczytać ${key}.`, error);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Nie udało się zapisać ${key}.`, error);
    return false;
  }
}

function loadState() {
  return readJson(STATE_KEY, null);
}

function saveState(state) {
  return writeJson(STATE_KEY, state);
}

function loadQueue() {
  const queue = readJson(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

function saveQueue(queue) {
  return writeJson(QUEUE_KEY, queue);
}

function acquireSyncLock() {
  const now = Date.now();
  const current = readJson(SYNC_LOCK_KEY, null);

  if (
    current?.ownerId &&
    current.ownerId !== INSTANCE_ID &&
    Number(current.expiresAt || 0) > now
  ) {
    return false;
  }

  const lock = {
    ownerId: INSTANCE_ID,
    expiresAt: now + SYNC_LOCK_TTL_MS
  };

  if (!writeJson(SYNC_LOCK_KEY, lock)) {
    return true;
  }

  const confirmed = readJson(SYNC_LOCK_KEY, null);
  return confirmed?.ownerId === INSTANCE_ID;
}

function refreshSyncLock() {
  const current = readJson(SYNC_LOCK_KEY, null);
  if (current?.ownerId !== INSTANCE_ID) return;

  writeJson(SYNC_LOCK_KEY, {
    ownerId: INSTANCE_ID,
    expiresAt: Date.now() + SYNC_LOCK_TTL_MS
  });
}

function releaseSyncLock() {
  try {
    const current = readJson(SYNC_LOCK_KEY, null);
    if (current?.ownerId === INSTANCE_ID) {
      localStorage.removeItem(SYNC_LOCK_KEY);
    }
  } catch (error) {
    console.warn('Nie udało się zwolnić blokady synchronizacji.', error);
  }
}

function messageFromError(error) {
  if (!error) return 'Nieznany błąd.';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function showToast(message, isError = false) {
  const toast = $('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  window.setTimeout(() => {
    toast.classList.remove('show');
  }, 3800);
}

function showSendingWindow() {
  const loading = $('loading');
  const text = $('loadingText');
  if (!loading || !text) return;

  text.innerHTML = '<strong>Wysyłanie</strong><br>Proszę o cierpliwość :)';
  loading.classList.add('show');
  loading.setAttribute('aria-hidden', 'false');
}

function hideSendingWindow() {
  const loading = $('loading');
  if (!loading) return;

  loading.classList.remove('show');
  loading.setAttribute('aria-hidden', 'true');
}

function createOfflineSavedModal() {
  let modal = $('offlineSavedModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'offlineSavedModal';
  modal.className = 'modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'offlineSavedTitle');

  const card = document.createElement('div');
  card.className = 'modal-card compact';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'ZAPIS OFFLINE';

  const title = document.createElement('h3');
  title.id = 'offlineSavedTitle';
  title.textContent = 'Operacja zapisana w telefonie';

  const text = document.createElement('p');
  text.textContent = 'Brak internetu. Operacja jest bezpiecznie zapisana i czeka na wysłanie. Po odzyskaniu połączenia aplikacja wyśle ją automatycznie.';

  const info = document.createElement('div');
  info.className = 'existing-info';
  info.textContent = 'Nie wyłączaj pamięci aplikacji ani nie czyść danych przeglądarki przed synchronizacją.';

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const button = document.createElement('button');
  button.id = 'offlineSavedOkBtn';
  button.type = 'button';
  button.className = 'btn btn-primary';
  button.textContent = 'OK';
  button.addEventListener('click', () => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    window.location.reload();
  });

  actions.appendChild(button);
  card.append(eyebrow, title, text, info, actions);
  modal.appendChild(card);
  document.body.appendChild(modal);

  return modal;
}

function showOfflineSavedModal() {
  const modal = createOfflineSavedModal();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => $('offlineSavedOkBtn')?.focus(), 80);
}

function createSyncSuccessModal() {
  let modal = $('syncSuccessModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'syncSuccessModal';
  modal.className = 'modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'syncSuccessTitle');

  const card = document.createElement('div');
  card.className = 'modal-card compact';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'SYNCHRONIZACJA ZAKOŃCZONA';

  const title = document.createElement('h3');
  title.id = 'syncSuccessTitle';
  title.textContent = 'Wysłano';

  const text = document.createElement('p');
  text.textContent = 'Wszystkie oczekujące operacje zostały poprawnie wysłane i zapisane w systemie.';

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const button = document.createElement('button');
  button.id = 'syncSuccessOkBtn';
  button.type = 'button';
  button.className = 'btn btn-success';
  button.textContent = 'OK';
  button.addEventListener('click', () => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  });

  actions.appendChild(button);
  card.append(eyebrow, title, text, actions);
  modal.appendChild(card);
  document.body.appendChild(modal);

  return modal;
}

function showSyncSuccessModal() {
  hideSendingWindow();

  const offlineModal = $('offlineSavedModal');
  offlineModal?.classList.remove('show');
  offlineModal?.setAttribute('aria-hidden', 'true');

  const modal = createSyncSuccessModal();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => $('syncSuccessOkBtn')?.focus(), 80);
}

function currentVisitId() {
  return loadState()?.visit?.idWizyty || null;
}

function queueForCurrentVisit() {
  const visitId = currentVisitId();
  if (!visitId) return [];
  return loadQueue().filter(item => item?.payload?.idWizyty === visitId);
}

function buildPayloadFromState(state) {
  const draft = state?.operationDraft;
  const team = state?.team;
  const visit = state?.visit;

  if (!draft || !team || !visit) return null;
  if (!Array.isArray(draft.pobranie) || !Array.isArray(draft.zwrot)) return null;
  if (draft.pobranie.length + draft.zwrot.length === 0) return null;

  if (!draft.operationTime) {
    draft.operationTime = new Date().toISOString();
  }

  return {
    idSesji: draft.idSesji,
    idWizyty: visit.idWizyty,
    dataCzasOperacji: draft.operationTime,
    idEkipy: team.id,
    idMagazynu: visit.magazyn?.id,
    komentarz: String(draft.komentarz || '').trim(),
    pobranie: draft.pobranie.map(item => ({
      kod: item.kod,
      ilosc: item.ilosc
    })),
    zwrot: draft.zwrot.map(item => ({
      kod: item.kod,
      ilosc: item.ilosc
    }))
  };
}

function updateNetworkText() {
  const text = $('networkText');
  const badge = $('networkBadge');
  if (!text || !badge) return;

  const count = loadQueue().length;
  badge.classList.toggle('offline', !navigator.onLine);

  if (!navigator.onLine) {
    text.textContent = count ? `Offline • ${count}` : 'Offline';
  } else if (connectionCheckRunning && count) {
    text.textContent = `Sprawdzam • ${count}`;
  } else if (syncRunning && count) {
    text.textContent = `Wysyłam • ${count}`;
  } else if (count) {
    text.textContent = `Online • ${count}`;
  } else {
    text.textContent = 'Online';
  }
}

function renderQueueNotice() {
  const visitScreen = $('screenVisit');
  if (!visitScreen) return;

  const queue = queueForCurrentVisit();
  let notice = $('offlineQueueNotice');

  if (!queue.length) {
    if (notice) notice.remove();
    updateNetworkText();
    return;
  }

  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'offlineQueueNotice';
    notice.className = 'draft-notice';
    notice.style.borderColor = 'rgba(217,138,40,.34)';
    notice.style.marginBottom = '14px';

    const copy = document.createElement('div');
    copy.innerHTML = '<strong>Oczekuje na wysłanie</strong><span id="offlineQueueText"></span>';

    const button = document.createElement('button');
    button.id = 'offlineSyncNowBtn';
    button.type = 'button';
    button.className = 'small-btn';
    button.textContent = 'Wyślij teraz';
    button.addEventListener('click', () => {
      retryIndex = 0;
      clearAutoSyncTimer();
      flushQueue(true);
    });

    notice.append(copy, button);

    const draftNotice = $('draftNotice');
    if (draftNotice) {
      draftNotice.insertAdjacentElement('afterend', notice);
    } else {
      visitScreen.prepend(notice);
    }
  }

  const failed = queue.filter(item => item.status === 'BŁĄD').length;
  const text = $('offlineQueueText');
  if (text) {
    if (connectionCheckRunning) {
      text.textContent = `${queue.length} oper. • sprawdzam połączenie z serwerem`;
    } else if (syncRunning) {
      text.textContent = `${queue.length} oper. • trwa synchronizacja`;
    } else if (failed) {
      text.textContent = `${queue.length} oper. w pamięci telefonu • ponawiam automatycznie`;
    } else if (navigator.onLine) {
      text.textContent = `${queue.length} oper. zapisana lokalnie • trwa wysyłanie w tle`;
    } else {
      text.textContent = `${queue.length} oper. zapisana lokalnie`;
    }
  }

  const button = $('offlineSyncNowBtn');
  if (button) {
    button.disabled = syncRunning || connectionCheckRunning || !navigator.onLine;
    button.textContent = syncRunning || connectionCheckRunning ? 'Proszę czekać…' : 'Wyślij teraz';
  }

  updateNetworkText();
}

function clearAutoSyncTimer() {
  if (autoSyncTimer) {
    window.clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
}

function scheduleAutoSync(delay = AUTO_SYNC_DELAY_MS, force = false) {
  if (!navigator.onLine || !loadQueue().length || syncRunning || connectionCheckRunning) return;
  if (autoSyncTimer && !force) return;

  if (force) clearAutoSyncTimer();

  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = null;
    flushQueue(false);
  }, delay);
}

function scheduleRetry() {
  if (!navigator.onLine || !loadQueue().length) return;

  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS_MS.length - 1);
  scheduleAutoSync(delay, true);
}

function queueCurrentDraft() {
  if (offlineSendBusy) return;
  offlineSendBusy = true;

  const state = loadState();
  const payload = buildPayloadFromState(state);

  if (!payload) {
    offlineSendBusy = false;
    showToast('Nie udało się przygotować operacji do zapisu.', true);
    return;
  }

  const queue = loadQueue();
  const existingIndex = queue.findIndex(item => item.idSesji === payload.idSesji);
  const queuedItem = {
    idSesji: payload.idSesji,
    payload,
    status: 'OCZEKUJE_NA_WYSŁANIE',
    createdAt: new Date().toISOString(),
    lastError: null
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = queuedItem;
  } else {
    queue.push(queuedItem);
  }

  if (!saveQueue(queue)) {
    offlineSendBusy = false;
    showToast('Nie udało się zapisać operacji w pamięci telefonu.', true);
    return;
  }

  state.operationDraft = null;
  saveState(state);

  const reviewModal = $('reviewModal');
  reviewModal?.classList.remove('show');
  reviewModal?.setAttribute('aria-hidden', 'true');

  document.dispatchEvent(new CustomEvent('selfstorage:draft-queued', {
    detail: { online: navigator.onLine }
  }));

  retryIndex = 0;
  updateNetworkText();
  renderQueueNotice();
  offlineSendBusy = false;

  if (!navigator.onLine) {
    showOfflineSavedModal();
    return;
  }

  showSendingWindow();
  window.setTimeout(() => flushQueue(true), 80);
}

async function verifyServerConnection() {
  connectionCheckRunning = true;
  renderQueueNotice();

  try {
    await api.ping();
    return true;
  } catch (error) {
    console.warn('Internet zgłoszony jako online, ale API nie jest jeszcze osiągalne.', error);
    return false;
  } finally {
    connectionCheckRunning = false;
    renderQueueNotice();
  }
}

async function flushQueue(manual = false) {
  if (syncRunning || connectionCheckRunning) return;

  if (!navigator.onLine) {
    hideSendingWindow();
    if (manual) showToast('Brak internetu. Operacje pozostają bezpiecznie w telefonie.', true);
    renderQueueNotice();
    return;
  }

  const queue = loadQueue();
  if (!queue.length) {
    hideSendingWindow();
    retryIndex = 0;
    clearAutoSyncTimer();
    if (manual) showToast('Nie ma operacji oczekujących na wysłanie.');
    renderQueueNotice();
    return;
  }

  if (!acquireSyncLock()) {
    hideSendingWindow();
    if (manual) showToast('Synchronizacja już trwa.');
    renderQueueNotice();
    return;
  }

  try {
    clearAutoSyncTimer();

    if (!manual) {
      const serverReady = await verifyServerConnection();
      if (!serverReady) {
        scheduleRetry();
        return;
      }
    }

    syncRunning = true;
    renderQueueNotice();

    let sent = 0;
    let failed = false;

    for (const item of [...queue]) {
      const current = loadQueue();
      const currentIndex = current.findIndex(entry => entry.idSesji === item.idSesji);
      if (currentIndex < 0) continue;

      current[currentIndex].status = 'WYSYŁANIE';
      current[currentIndex].lastError = null;
      current[currentIndex].lastTryAt = new Date().toISOString();
      saveQueue(current);
      refreshSyncLock();
      renderQueueNotice();

      try {
        await api.saveSession(item.payload);

        const afterSuccess = loadQueue().filter(entry => entry.idSesji !== item.idSesji);
        saveQueue(afterSuccess);
        sent += 1;
        retryIndex = 0;
        refreshSyncLock();
        renderQueueNotice();
      } catch (error) {
        const afterError = loadQueue();
        const failedIndex = afterError.findIndex(entry => entry.idSesji === item.idSesji);

        if (failedIndex >= 0) {
          afterError[failedIndex].status = manual ? 'BŁĄD' : 'OCZEKUJE_NA_WYSŁANIE';
          afterError[failedIndex].lastError = messageFromError(error);
          afterError[failedIndex].lastTryAt = new Date().toISOString();
          saveQueue(afterError);
        }

        failed = true;
        renderQueueNotice();

        if (manual) {
          hideSendingWindow();
          showToast(`Nie udało się wysłać. ${messageFromError(error)} Aplikacja będzie próbować dalej.`, true);
        }
        break;
      }
    }

    syncRunning = false;
    renderQueueNotice();

    if (sent > 0) {
      const left = loadQueue().length;
      if (left) {
        hideSendingWindow();
        showToast(`Wysłano ${sent} oper. • ${left} nadal oczekuje.`);
      } else {
        showSyncSuccessModal();
      }
    } else if (manual) {
      hideSendingWindow();
    }

    if (!loadQueue().length) {
      retryIndex = 0;
      clearAutoSyncTimer();
      return;
    }

    if (failed && navigator.onLine) {
      scheduleRetry();
    } else if (navigator.onLine) {
      scheduleAutoSync(AUTO_SYNC_DELAY_MS);
    }
  } finally {
    syncRunning = false;
    releaseSyncLock();
    renderQueueNotice();
  }
}

function interceptCriticalClicks(event) {
  const sendButton = event.target.closest?.('#reviewSendBtn');

  if (sendButton) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    queueCurrentDraft();
    return;
  }

  const finishButton = event.target.closest?.('#finishVisitBtn');
  if (!finishButton) return;

  const pending = queueForCurrentVisit();
  if (!pending.length) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (navigator.onLine) {
    showToast('Najpierw wysyłam operacje zapisane w telefonie.');
    retryIndex = 0;
    clearAutoSyncTimer();
    flushQueue(true);
  } else {
    showToast('Masz niewysłane operacje. Zakończenie wizyty wymaga najpierw synchronizacji.', true);
  }
}

function requestAutomaticSync(force = false) {
  renderQueueNotice();
  updateNetworkText();
  scheduleAutoSync(AUTO_SYNC_DELAY_MS, force);
}

function initOfflineQueue() {
  createOfflineSavedModal();
  createSyncSuccessModal();
  document.addEventListener('click', interceptCriticalClicks, true);
  renderQueueNotice();
  updateNetworkText();

  window.addEventListener('online', () => {
    retryIndex = 0;
    requestAutomaticSync(true);
  });

  window.addEventListener('offline', () => {
    hideSendingWindow();
    clearAutoSyncTimer();
    retryIndex = 0;
    updateNetworkText();
    renderQueueNotice();
  });

  window.addEventListener('pageshow', () => {
    requestAutomaticSync(false);
  });

  window.addEventListener('focus', () => {
    requestAutomaticSync(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    requestAutomaticSync(false);
  });

  window.addEventListener('storage', event => {
    if (event.key !== QUEUE_KEY && event.key !== SYNC_LOCK_KEY) return;
    renderQueueNotice();
    updateNetworkText();
  });

  window.setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      navigator.onLine &&
      loadQueue().length &&
      !syncRunning &&
      !connectionCheckRunning &&
      !autoSyncTimer
    ) {
      scheduleAutoSync(AUTO_SYNC_DELAY_MS);
    }
  }, 10000);

  requestAutomaticSync(false);
}

document.addEventListener('DOMContentLoaded', initOfflineQueue);
