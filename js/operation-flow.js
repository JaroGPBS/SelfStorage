const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';

let saveBusy = false;

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

function showToast(message, isError = false) {
  const toast = $('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  window.setTimeout(() => {
    toast.classList.remove('show');
  }, 3600);
}

function draftHasData(draft) {
  if (!draft) return false;
  const pobranie = Array.isArray(draft.pobranie) ? draft.pobranie.length : 0;
  const zwrot = Array.isArray(draft.zwrot) ? draft.zwrot.length : 0;
  return pobranie + zwrot > 0 || Boolean(String(draft.komentarz || '').trim());
}

function buildPayload(state) {
  const draft = state?.operationDraft;
  const team = state?.team;
  const visit = state?.visit;

  if (!draft || !team || !visit) return null;
  if (!Array.isArray(draft.pobranie) || !Array.isArray(draft.zwrot)) return null;
  if (draft.pobranie.length + draft.zwrot.length === 0) return null;

  const operationTime = draft.operationTime || new Date().toISOString();

  return {
    idSesji: draft.idSesji,
    idWizyty: visit.idWizyty,
    dataCzasOperacji: operationTime,
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

function saveCurrentOperation() {
  if (saveBusy) return;
  saveBusy = true;

  try {
    const state = readJson(STATE_KEY, null);
    const payload = buildPayload(state);

    if (!payload) {
      showToast('Dodaj przynajmniej jedną część.', true);
      return;
    }

    const queue = readJson(QUEUE_KEY, []);
    const safeQueue = Array.isArray(queue) ? queue : [];
    const existingIndex = safeQueue.findIndex(item => item?.idSesji === payload.idSesji);
    const queuedItem = {
      idSesji: payload.idSesji,
      payload,
      status: 'OCZEKUJE_NA_WYSŁANIE',
      createdAt: new Date().toISOString(),
      lastError: null
    };

    if (existingIndex >= 0) {
      safeQueue[existingIndex] = queuedItem;
    } else {
      safeQueue.push(queuedItem);
    }

    if (!writeJson(QUEUE_KEY, safeQueue)) {
      showToast('Nie udało się zapisać operacji w pamięci telefonu.', true);
      return;
    }

    state.operationDraft = null;
    if (!writeJson(STATE_KEY, state)) {
      showToast('Operacja jest w kolejce, ale nie udało się odświeżyć ekranu.', true);
    }

    document.dispatchEvent(new CustomEvent('selfstorage:draft-queued', {
      detail: { online: navigator.onLine }
    }));

    showToast(
      navigator.onLine
        ? 'Operacja zapisana. Synchronizacja trwa w tle.'
        : 'Operacja zapisana w telefonie. Wyślę ją automatycznie po odzyskaniu internetu.'
    );

    window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'));
  } finally {
    saveBusy = false;
  }
}

function guardOperationChange(event) {
  const button = event.target.closest?.('#pobranieBtn, #zwrotBtn');
  if (!button) return false;

  const state = readJson(STATE_KEY, null);
  const draft = state?.operationDraft;
  const visitId = state?.visit?.idWizyty;

  if (!draft || draft.idWizyty !== visitId || !draftHasData(draft)) return false;

  const requestedType = button.id === 'zwrotBtn' ? 'ZWROT' : 'POBRANIE';
  const activeType = draft.activeType === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  if (requestedType === activeType) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const activeLabel = activeType === 'ZWROT' ? 'Zwrot' : 'Pobranie';
  const requestedLabel = requestedType === 'ZWROT' ? 'Zwrotu' : 'Pobrania';
  showToast(`Masz niezapisaną operację ${activeLabel}. Zapisz ją przed rozpoczęciem ${requestedLabel}.`, true);
  return true;
}

function interceptOperationClicks(event) {
  if (guardOperationChange(event)) return;

  const saveButton = event.target.closest?.('#reviewSessionBtn');
  if (!saveButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  saveCurrentOperation();
}

function keepSaveButtonLabel() {
  const button = $('reviewSessionBtn');
  if (!button) return;

  const setLabel = () => {
    if (button.textContent !== 'Zapisz operację') {
      button.textContent = 'Zapisz operację';
    }
  };

  setLabel();
  const observer = new MutationObserver(setLabel);
  observer.observe(button, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function syncOperationPresentation() {
  const state = readJson(STATE_KEY, null);
  const draft = state?.operationDraft;
  if (!draft) return;

  const type = draft.activeType === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  const list = type === 'ZWROT'
    ? (Array.isArray(draft.zwrot) ? draft.zwrot : [])
    : (Array.isArray(draft.pobranie) ? draft.pobranie : []);

  const title = $('operationModeTitle');
  const expectedTitle = `${type} - ${list.length} poz.`;
  if (title && title.textContent !== expectedTitle) {
    title.textContent = expectedTitle;
  }

  const listTitle = $('listTitle');
  if (listTitle && listTitle.textContent !== 'Lista części') {
    listTitle.textContent = 'Lista części';
  }
}

function observeOperationPresentation() {
  const screen = $('screenOperation');
  if (!screen) return;

  const observer = new MutationObserver(() => {
    if (screen.classList.contains('active')) {
      syncOperationPresentation();
    }
  });

  observer.observe(screen, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class']
  });

  syncOperationPresentation();
}

function suppressBlockingSyncSuccess() {
  const closeIfShown = () => {
    const modal = $('syncSuccessModal');
    if (!modal || !modal.classList.contains('show')) return;

    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    showToast('Synchronizacja zakończona.');
  };

  const observer = new MutationObserver(closeIfShown);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  closeIfShown();
}

function initOperationFlow() {
  document.addEventListener('click', interceptOperationClicks, true);
  keepSaveButtonLabel();
  observeOperationPresentation();
  suppressBlockingSyncSuccess();
}

document.addEventListener('DOMContentLoaded', initOperationFlow);
