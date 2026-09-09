const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';
const PENDING_FINISH_KEY = 'selfstorage_pending_finish_v1';
const FINISH_RETRY_DELAYS = [0, 1500, 4000];

let finishBusy = false;
let finishRetryTimer = null;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function currentState() {
  return readJson(STATE_KEY, null);
}

function currentQueue() {
  const queue = readJson(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

function draftHasData(state) {
  const draft = state?.operationDraft;
  if (!draft) return false;
  const pickup = Array.isArray(draft.pobranie) ? draft.pobranie.length : 0;
  const returns = Array.isArray(draft.zwrot) ? draft.zwrot.length : 0;
  return pickup + returns > 0 || Boolean(String(draft.komentarz || '').trim());
}

function queueForVisit(visitId) {
  const id = String(visitId || '').trim();
  if (!id) return [];
  return currentQueue().filter(item => String(item?.payload?.idWizyty || '').trim() === id);
}

function showCritical(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = String(message || '').trim();
  toast.classList.add('error', 'show');
  window.setTimeout(() => toast.classList.remove('show'), 5200);
}

function setFinishLoading(show, text = 'Kończenie wizyty…') {
  const loading = document.getElementById('loading');
  const label = document.getElementById('loadingText');
  if (!loading || !label) return;
  if (show) label.textContent = text;
  loading.classList.toggle('show', Boolean(show));
  loading.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function closeFinishModal() {
  const modal = document.getElementById('finishModal');
  modal?.classList.remove('show');
  modal?.setAttribute('aria-hidden', 'true');
}

function openFinishModal() {
  const modal = document.getElementById('finishModal');
  modal?.classList.add('show');
  modal?.setAttribute('aria-hidden', 'false');
}

function clearPendingVisitInServiceWorker(visitId) {
  if (!visitId || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({
    type: 'CLEAR_PENDING_VISIT',
    visitId
  });
}

function showDoneAndReset() {
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(PENDING_FINISH_KEY);

  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === 'screenDone');
  });

  window.setTimeout(() => {
    window.location.reload();
  }, 1600);
}

function removeQueueItem(sessionId) {
  const id = String(sessionId || '').trim();
  const queue = currentQueue().filter(item => String(item?.idSesji || '').trim() !== id);
  writeJson(QUEUE_KEY, queue);
  window.dispatchEvent(new StorageEvent('storage', { key: QUEUE_KEY }));
}

async function apiRequest(action, payload, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Serwer zwrócił nieprawidłową odpowiedź.');
    }

    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || data?.message || `Błąd HTTP ${response.status}`);
      error.code = data?.code || '';
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Serwer nie odpowiedział w wymaganym czasie.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function isVisitNotFoundError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'VISIT_NOT_FOUND' || message.includes('nie znaleziono wizyty');
}

function isPermanentVisitError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'VISIT_START_REJECTED' ||
    message.includes('należy do innej ekipy') ||
    message.includes('nie znaleziono wizyty') ||
    message.includes('inna ekipa') ||
    message.includes('inna zawartość');
}

function recoverMissingVisit(state, visitId) {
  const queued = queueForVisit(visitId);

  if (draftHasData(state) || queued.length > 0) {
    localStorage.removeItem(PENDING_FINISH_KEY);
    showCritical(
      'Ta wizyta nie istnieje już na serwerze. Niewysłane dane zostały zachowane w telefonie i nie zostaną automatycznie usunięte.'
    );
    return false;
  }

  localStorage.removeItem(PENDING_FINISH_KEY);
  localStorage.removeItem(STATE_KEY);
  clearPendingVisitInServiceWorker(visitId);

  try {
    sessionStorage.setItem(
      'selfstorage_auth_message_v1',
      'Stara wizyta nie istnieje już na serwerze. Stan telefonu został odblokowany. Zaloguj się ponownie.'
    );
  } catch {}

  window.setTimeout(() => window.location.reload(), 120);
  return true;
}

async function withRetries(action, payload, timeoutMs) {
  let lastError = null;

  for (let i = 0; i < FINISH_RETRY_DELAYS.length; i++) {
    if (FINISH_RETRY_DELAYS[i]) await sleep(FINISH_RETRY_DELAYS[i]);

    try {
      return await apiRequest(action, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!navigator.onLine || isPermanentVisitError(error)) break;
    }
  }

  throw lastError || new Error('Nie udało się połączyć z serwerem.');
}

async function flushVisitQueue(visitId) {
  while (true) {
    const pending = queueForVisit(visitId);
    if (!pending.length) return;

    const item = pending[0];
    await withRetries('ZAPISZ_SESJE', item.payload, 65000);
    removeQueueItem(item.idSesji);
  }
}

function storePendingFinish(state) {
  const visit = state?.visit;
  const team = state?.team;
  if (!visit?.idWizyty || !team?.id) return false;

  return writeJson(PENDING_FINISH_KEY, {
    visitId: visit.idWizyty,
    teamId: team.id,
    requestedAt: new Date().toISOString()
  });
}

function schedulePendingFinishRetry(delay = 12000) {
  if (finishRetryTimer) return;
  finishRetryTimer = window.setTimeout(() => {
    finishRetryTimer = null;
    processPendingFinish(false);
  }, delay);
}

async function processPendingFinish(manual = false) {
  if (finishBusy) return;

  const pending = readJson(PENDING_FINISH_KEY, null);
  const state = currentState();
  const visitId = String(pending?.visitId || state?.visit?.idWizyty || '').trim();
  const teamId = String(pending?.teamId || state?.team?.id || '').trim();

  if (!pending || !visitId || !teamId) return;
  if (draftHasData(state)) return;

  if (!navigator.onLine) {
    if (manual) {
      showCritical('Brak internetu. Zakończenie wizyty zostało zapamiętane i zostanie wysłane automatycznie po odzyskaniu połączenia.');
    }
    schedulePendingFinishRetry();
    return;
  }

  finishBusy = true;
  setFinishLoading(true, 'Wysyłanie i zamykanie wizyty…');

  try {
    await flushVisitQueue(visitId);

    await withRetries('ZAKONCZ_WIZYTE', {
      idEkipy: teamId,
      idWizyty: visitId
    }, 45000);

    showDoneAndReset();
  } catch (error) {
    const message = String(error?.message || error || 'Nie udało się zakończyć wizyty.');

    if (isVisitNotFoundError(error)) {
      recoverMissingVisit(state, visitId);
    } else if (isPermanentVisitError(error)) {
      showCritical(message);
    } else {
      showCritical(`Nie udało się teraz zakończyć wizyty. Dane pozostają zapisane w telefonie i aplikacja spróbuje ponownie. ${message}`);
      schedulePendingFinishRetry();
    }
  } finally {
    finishBusy = false;
    setFinishLoading(false);
  }
}

function requestFinish() {
  const state = currentState();
  if (!state?.team || !state?.visit) return;

  if (draftHasData(state)) {
    showCritical('Masz niedokończoną operację. Najpierw kliknij „Zakończ”, aby ją zapisać.');
    return;
  }

  if (!storePendingFinish(state)) {
    showCritical('Nie udało się zapisać żądania zakończenia wizyty w telefonie.');
    return;
  }

  closeFinishModal();
  processPendingFinish(true);
}

function interceptFinishClicks(event) {
  const target = event.target?.closest?.('#finishVisitBtn, #finishYesBtn');
  if (!target) return;

  if (target.id === 'finishVisitBtn') {
    const state = currentState();
    if (!state?.visit) return;

    if (draftHasData(state)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showCritical('Masz niedokończoną operację. Najpierw kliknij „Zakończ”, aby ją zapisać.');
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openFinishModal();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  requestFinish();
}

function installQuietToasts() {
  if (document.getElementById('runtimeQuietToastStyle')) return;
  const style = document.createElement('style');
  style.id = 'runtimeQuietToastStyle';
  style.textContent = '#toast:not(.error){display:none!important;}';
  document.head.appendChild(style);
}

function operationHasParts() {
  const state = currentState();
  const draft = state?.operationDraft;
  if (!draft) return false;
  const type = draft.activeType === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  const list = type === 'ZWROT' ? draft.zwrot : draft.pobranie;
  return Array.isArray(list) && list.length > 0;
}

function syncOperationButtonLabel() {
  const button = document.getElementById('reviewSessionBtn');
  if (!button) return;
  const expected = operationHasParts() ? 'Zakończ' : 'Cofnij';
  if (button.textContent !== expected) button.textContent = expected;
}

function installOperationButtonLabel() {
  const button = document.getElementById('reviewSessionBtn');
  if (!button) return;

  syncOperationButtonLabel();
  const observer = new MutationObserver(syncOperationButtonLabel);
  observer.observe(button, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', () => window.setTimeout(syncOperationButtonLabel, 0));
  document.addEventListener('input', () => window.setTimeout(syncOperationButtonLabel, 0));
  document.addEventListener('selfstorage:draft-queued', () => window.setTimeout(syncOperationButtonLabel, 0));
}

function installQuantityKeyboardFix() {
  if (document.getElementById('quantityKeyboardFixStyle')) return;

  const style = document.createElement('style');
  style.id = 'quantityKeyboardFixStyle';
  style.textContent = `
    #quantityModal.runtime-keyboard-open {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: 10px 14px !important;
      overflow: hidden !important;
    }
    #quantityModal.runtime-keyboard-open .modal-card {
      margin: 0 auto !important;
      max-height: calc(var(--runtime-visible-height, 100dvh) - 20px) !important;
      overflow-y: auto !important;
      overscroll-behavior: contain;
    }
  `;
  document.head.appendChild(style);

  const viewport = window.visualViewport;
  if (!viewport) return;

  const update = () => {
    const modal = document.getElementById('quantityModal');
    if (!modal) return;

    const visibleHeight = Math.max(240, viewport.height);
    const keyboardLikelyOpen = modal.classList.contains('show') &&
      (window.innerHeight - viewport.height > 120 || document.activeElement?.id === 'quantityInput');

    modal.style.setProperty('--runtime-visible-height', `${visibleHeight}px`);
    modal.classList.toggle('runtime-keyboard-open', keyboardLikelyOpen);

    if (keyboardLikelyOpen) {
      modal.style.top = `${viewport.offsetTop}px`;
      modal.style.height = `${visibleHeight}px`;
      modal.style.bottom = 'auto';
    } else {
      modal.style.top = '';
      modal.style.height = '';
      modal.style.bottom = '';
    }
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  document.getElementById('quantityInput')?.addEventListener('focus', () => window.setTimeout(update, 60));
  document.getElementById('quantityInput')?.addEventListener('blur', () => window.setTimeout(update, 60));

  new MutationObserver(update).observe(document.getElementById('quantityModal'), {
    attributes: true,
    attributeFilter: ['class']
  });
}

function triggerPendingFinishCheck() {
  if (readJson(PENDING_FINISH_KEY, null)) processPendingFinish(false);
}

function initRuntimeFixes() {
  installQuietToasts();
  installOperationButtonLabel();
  installQuantityKeyboardFix();

  window.addEventListener('click', interceptFinishClicks, true);
  window.addEventListener('online', triggerPendingFinishCheck);
  window.addEventListener('focus', triggerPendingFinishCheck);
  window.addEventListener('pageshow', triggerPendingFinishCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerPendingFinishCheck();
  });

  window.setInterval(triggerPendingFinishCheck, 15000);
  triggerPendingFinishCheck();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRuntimeFixes, { once: true });
} else {
  initRuntimeFixes();
}
