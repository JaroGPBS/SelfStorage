import { api } from './api.js';

const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';
let syncRunning = false;
let offlineSendBusy = false;

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
    button.addEventListener('click', () => flushQueue(true));

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
    text.textContent = failed
      ? `${queue.length} oper. w pamięci telefonu • ${failed} wymaga ponowienia`
      : `${queue.length} oper. zapisana lokalnie`;
  }

  const button = $('offlineSyncNowBtn');
  if (button) {
    button.disabled = syncRunning || !navigator.onLine;
    button.textContent = syncRunning ? 'Wysyłam…' : 'Wyślij teraz';
  }

  updateNetworkText();
}

function updateNetworkText() {
  const text = $('networkText');
  const badge = $('networkBadge');
  if (!text || !badge) return;

  const count = loadQueue().length;
  badge.classList.toggle('offline', !navigator.onLine);

  if (!navigator.onLine) {
    text.textContent = count ? `Offline • ${count}` : 'Offline';
  } else if (count) {
    text.textContent = `Online • ${count}`;
  } else {
    text.textContent = 'Online';
  }
}

function queueCurrentDraftOffline() {
  if (offlineSendBusy) return;
  offlineSendBusy = true;

  const state = loadState();
  const payload = buildPayloadFromState(state);

  if (!payload) {
    offlineSendBusy = false;
    showToast('Nie udało się przygotować operacji do zapisu offline.', true);
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

  showToast('Brak internetu. Operacja zapisana w telefonie i czeka na wysłanie.');
  updateNetworkText();

  window.setTimeout(() => {
    window.location.reload();
  }, 950);
}

async function flushQueue(manual = false) {
  if (syncRunning) return;

  if (!navigator.onLine) {
    if (manual) showToast('Brak internetu. Operacje pozostają bezpiecznie w telefonie.', true);
    renderQueueNotice();
    return;
  }

  let queue = loadQueue();
  if (!queue.length) {
    if (manual) showToast('Nie ma operacji oczekujących na wysłanie.');
    renderQueueNotice();
    return;
  }

  syncRunning = true;
  renderQueueNotice();

  let sent = 0;

  for (const item of [...queue]) {
    const current = loadQueue();
    const currentIndex = current.findIndex(entry => entry.idSesji === item.idSesji);
    if (currentIndex < 0) continue;

    current[currentIndex].status = 'WYSYŁANIE';
    current[currentIndex].lastError = null;
    saveQueue(current);
    renderQueueNotice();

    try {
      await api.saveSession(item.payload);

      const afterSuccess = loadQueue().filter(entry => entry.idSesji !== item.idSesji);
      saveQueue(afterSuccess);
      sent += 1;
      renderQueueNotice();
    } catch (error) {
      const afterError = loadQueue();
      const failedIndex = afterError.findIndex(entry => entry.idSesji === item.idSesji);

      if (failedIndex >= 0) {
        afterError[failedIndex].status = 'BŁĄD';
        afterError[failedIndex].lastError = messageFromError(error);
        afterError[failedIndex].lastTryAt = new Date().toISOString();
        saveQueue(afterError);
      }

      renderQueueNotice();

      if (manual) {
        showToast(`Nie udało się wysłać. ${messageFromError(error)}`, true);
      }
      break;
    }
  }

  syncRunning = false;
  renderQueueNotice();

  if (sent > 0) {
    const left = loadQueue().length;
    showToast(
      left
        ? `Wysłano ${sent} oper. • ${left} nadal oczekuje.`
        : `Synchronizacja zakończona. Wysłano ${sent} oper.`
    );
  }
}

function interceptCriticalClicks(event) {
  const sendButton = event.target.closest?.('#reviewSendBtn');

  if (sendButton && !navigator.onLine) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    queueCurrentDraftOffline();
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
    flushQueue(true);
  } else {
    showToast('Masz niewysłane operacje. Zakończenie wizyty wymaga najpierw synchronizacji.', true);
  }
}

function initOfflineQueue() {
  document.addEventListener('click', interceptCriticalClicks, true);
  renderQueueNotice();
  updateNetworkText();

  window.addEventListener('online', () => {
    updateNetworkText();
    window.setTimeout(() => flushQueue(false), 350);
  });

  window.addEventListener('offline', () => {
    updateNetworkText();
    renderQueueNotice();
  });

  window.addEventListener('pageshow', () => {
    renderQueueNotice();
    updateNetworkText();
  });

  if (navigator.onLine && loadQueue().length) {
    window.setTimeout(() => flushQueue(false), 700);
  }
}

document.addEventListener('DOMContentLoaded', initOfflineQueue);
