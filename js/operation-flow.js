const STATE_KEY = 'selfstorage_state_v1';
const QUEUE_KEY = 'selfstorage_offline_queue_v1';
const RECENT_PART_KEY = 'selfstorage_recent_part_v1';

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

function confirmPartDelete(event) {
  const deleteButton = event.target.closest?.('#screenOperation .row-btn.delete');
  if (!deleteButton) return false;

  const name = deleteButton.closest('.part-row')?.querySelector('.part-main strong')?.textContent?.trim() || 'tę część';
  const confirmed = window.confirm(`Usunąć „${name}” z listy?`);
  if (confirmed) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  return true;
}

function openQuantityFromBadge(event) {
  const qty = event.target.closest?.('#screenOperation .qty-badge');
  if (!qty) return false;

  const editButton = qty.closest('.part-row')?.querySelector('.row-btn:not(.delete)');
  if (!editButton) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  editButton.click();
  return true;
}

function interceptOperationClicks(event) {
  if (confirmPartDelete(event)) return;
  if (openQuantityFromBadge(event)) return;
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

function currentOperationData() {
  const state = readJson(STATE_KEY, null);
  const draft = state?.operationDraft;
  if (!draft) return null;

  const type = draft.activeType === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  const list = type === 'ZWROT'
    ? (Array.isArray(draft.zwrot) ? draft.zwrot : [])
    : (Array.isArray(draft.pobranie) ? draft.pobranie : []);

  return { state, draft, type, list };
}

function syncOperationPresentation() {
  const data = currentOperationData();
  if (!data) return;

  const { type, list } = data;
  const title = $('operationModeTitle');
  const expectedTitle = `${type} - ${list.length} poz.`;

  if (title) {
    if (title.textContent !== expectedTitle) title.textContent = expectedTitle;
    title.classList.toggle('return', type === 'ZWROT');
    title.classList.toggle('pick', type !== 'ZWROT');
  }

  const listTitle = $('listTitle');
  if (listTitle && listTitle.textContent !== 'Lista części') {
    listTitle.textContent = 'Lista części';
  }
}

function syncCompactOperationHeader() {
  const screen = $('screenOperation');
  const title = $('operationModeTitle');
  const header = document.querySelector('.app-header');
  const origin = screen?.querySelector('.operation-head-minimal');
  const network = $('networkBadge');

  if (!screen || !title || !header || !origin || !network) return;

  if (screen.classList.contains('active')) {
    if (title.parentElement !== header) {
      header.insertBefore(title, network);
    }
  } else if (title.parentElement !== origin) {
    origin.prepend(title);
  }
}

function readRecentParts() {
  const value = readJson(RECENT_PART_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

function rememberRecentlyAddedPart() {
  const data = currentOperationData();
  if (!data) return;

  const code = String($('quantityPartCode')?.textContent || '').trim();
  if (!code) return;

  const recent = readRecentParts();
  recent[data.type] = code;
  writeJson(RECENT_PART_KEY, recent);
}

function reorderOperationRows() {
  const data = currentOperationData();
  const container = $('operationList');
  if (!data || !container) return;

  const recentCode = String(readRecentParts()[data.type] || '').trim();
  if (!recentCode) return;

  const rows = Array.from(container.querySelectorAll('.part-row'));
  const recentRow = rows.find(row =>
    String(row.querySelector('.part-main span')?.textContent || '').trim() === recentCode
  );

  if (recentRow && container.firstElementChild !== recentRow) {
    container.prepend(recentRow);
  }
}

function trackAddedPart(event) {
  const button = event.target.closest?.('#quantityAddBtn');
  if (!button || button.textContent.trim() !== 'Dodaj') return;

  rememberRecentlyAddedPart();
  window.setTimeout(() => {
    syncOperationPresentation();
    reorderOperationRows();
  }, 0);
}

function observeOperationPresentation() {
  const screen = $('screenOperation');
  if (!screen) return;

  const observer = new MutationObserver(() => {
    syncCompactOperationHeader();

    if (screen.classList.contains('active')) {
      syncOperationPresentation();
      reorderOperationRows();
    }
  });

  observer.observe(screen, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class']
  });

  syncCompactOperationHeader();
  syncOperationPresentation();
  reorderOperationRows();
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
  document.addEventListener('click', trackAddedPart);
  keepSaveButtonLabel();
  observeOperationPresentation();
  suppressBlockingSyncSuccess();
}

document.addEventListener('DOMContentLoaded', initOperationFlow);
