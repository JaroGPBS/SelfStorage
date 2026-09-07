const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';
const AUTH_MESSAGE_KEY = 'selfstorage_auth_message_v1';
const INVALID_AUTH_MESSAGE = 'Konto nie aktywne\nSkontaktuj się z adminem.';

function setDisplayedVersion() {
  for (const element of document.querySelectorAll('body > div')) {
    if (/^v0\.\d+$/.test(element.textContent?.trim() || '')) {
      element.textContent = 'v0.19';
      element.style.fontSize = '13px';
      element.style.fontWeight = '600';
      element.style.opacity = '.85';
      break;
    }
  }
}

function showCenteredAuthMessage(message) {
  const existing = document.getElementById('authMessageModal');
  existing?.remove();

  const modal = document.createElement('div');
  modal.id = 'authMessageModal';
  modal.className = 'modal show';
  modal.style.alignItems = 'center';
  modal.setAttribute('aria-hidden', 'false');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'modal-card compact';
  card.style.textAlign = 'center';

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.margin = '0';
  title.style.whiteSpace = 'pre-line';

  card.appendChild(title);
  modal.appendChild(card);
  document.body.appendChild(modal);

  window.setTimeout(() => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => modal.remove(), 250);
  }, 5000);
}

function showStoredAuthMessage() {
  const message = sessionStorage.getItem(AUTH_MESSAGE_KEY);
  if (!message) return;

  sessionStorage.removeItem(AUTH_MESSAGE_KEY);
  showCenteredAuthMessage(message);
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function draftHasUnsavedData(draft) {
  if (!draft) return false;

  const pickup = Array.isArray(draft.pobranie) ? draft.pobranie.length : 0;
  const returns = Array.isArray(draft.zwrot) ? draft.zwrot.length : 0;
  const comment = String(draft.komentarz || '').trim();

  return pickup + returns > 0 || Boolean(comment);
}

function visitHasQueuedOperations(visitId) {
  if (!visitId) return false;

  const queue = readLocalJson(QUEUE_KEY, []);
  if (!Array.isArray(queue)) return false;

  return queue.some(item =>
    String(item?.payload?.idWizyty || '').trim() === String(visitId).trim()
  );
}

function clearPendingVisitInServiceWorker(visitId) {
  if (!visitId || !navigator.serviceWorker?.controller) return;

  navigator.serviceWorker.controller.postMessage({
    type: 'CLEAR_PENDING_VISIT',
    visitId
  });
}

function recoverRejectedVisit(data) {
  const visitId = String(data?.visitId || '').trim();
  const serverMessage = String(data?.message || '').trim();
  const state = readLocalJson(STATE_KEY, null);
  const currentVisitId = String(state?.visit?.idWizyty || '').trim();

  if (!state?.visit || !currentVisitId || (visitId && currentVisitId !== visitId)) {
    showCenteredAuthMessage(
      serverMessage
        ? `Serwer odrzucił rozpoczęcie wizyty.\n${serverMessage}`
        : 'Serwer odrzucił rozpoczęcie wizyty.'
    );
    return;
  }

  if (
    draftHasUnsavedData(state.operationDraft) ||
    visitHasQueuedOperations(currentVisitId)
  ) {
    showCenteredAuthMessage(
      'Serwer odrzucił rozpoczęcie wizyty.\n' +
      'Masz lokalnie zapisane operacje, więc aplikacja ich nie usuwa.\n' +
      (serverMessage || 'Sprawdź konfigurację magazynu i spróbuj ponownie.')
    );
    return;
  }

  localStorage.removeItem(STATE_KEY);
  clearPendingVisitInServiceWorker(currentVisitId);

  sessionStorage.setItem(
    AUTH_MESSAGE_KEY,
    'Wizyta nie została utworzona na serwerze.\n' +
    'Stan lokalny został bezpiecznie wyczyszczony.\n' +
    (serverMessage ? `\n${serverMessage}` : '')
  );

  window.setTimeout(() => {
    window.location.reload();
  }, 80);
}

function forceLogout(message) {
  localStorage.removeItem(STATE_KEY);
  sessionStorage.setItem(
    AUTH_MESSAGE_KEY,
    message || INVALID_AUTH_MESSAGE
  );
  window.location.reload();
}

function handleAuthMessage(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'VISIT_START_REJECTED') {
    recoverRejectedVisit(data);
    return;
  }

  if (data.type === 'AUTH_REJECTED') {
    forceLogout(INVALID_AUTH_MESSAGE);
    return;
  }

  if (data.type === 'AUTH_UNAVAILABLE') {
    forceLogout(data.message || 'Nie udało się sprawdzić uprawnień. Sprawdź internet i zaloguj się ponownie.');
    return;
  }

  if (data.type === 'AUTH_REFRESH_REQUIRED') {
    forceLogout(INVALID_AUTH_MESSAGE);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', handleAuthMessage);
}

document.addEventListener('DOMContentLoaded', () => {
  setDisplayedVersion();
  window.setTimeout(showStoredAuthMessage, 120);
});