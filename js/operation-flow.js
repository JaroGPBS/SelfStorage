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

function returnFromEmptyOperation() {
  const data = currentOperationData();
  if (data?.list?.length) return false;

  const comment = $('operationComment');
  if (comment) comment.value = '';

  const backButton = $('operationBackBottomBtn');
  if (backButton) backButton.click();
  return true;
}

function interceptOperationClicks(event) {
  if (confirmPartDelete(event)) return;
  if (openQuantityFromBadge(event)) return;
  if (guardOperationChange(event)) return;

  const actionButton = event.target.closest?.('#reviewSessionBtn');
  if (!actionButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (returnFromEmptyOperation()) return;
  saveCurrentOperation();
}

function syncPrimaryAction() {
  const button = $('reviewSessionBtn');
  const data = currentOperationData();
  if (!button || !data) return;

  const hasParts = data.list.length > 0;
  const expected = hasParts
    ? (data.type === 'ZWROT' ? 'Zapisz Zwrot' : 'Zapisz Pobranie')
    : 'Wróć';

  if (button.textContent !== expected) button.textContent = expected;
  button.classList.toggle('operation-back-action', !hasParts);
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

  syncPrimaryAction();
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

function buildOperationLayout() {
  const screen = $('screenOperation');
  if (!screen) return;

  if (!$('operationScrollArea')) {
    const listHead = screen.querySelector('.operation-list-head');
    const list = $('operationList');
    const empty = $('operationEmpty');

    if (listHead && list && empty) {
      const scrollArea = document.createElement('div');
      scrollArea.id = 'operationScrollArea';
      scrollArea.className = 'operation-scroll-area';
      listHead.before(scrollArea);
      scrollArea.append(listHead, list, empty);
    }
  }

  if (!$('operationBottomControls')) {
    const scanButton = $('openPartScannerBtn');
    const manual = screen.querySelector('.part-manual-details');
    const comment = screen.querySelector('.operation-comment-details');
    const action = $('reviewSessionBtn');

    if (scanButton && manual && comment && action) {
      const controls = document.createElement('div');
      controls.id = 'operationBottomControls';
      controls.className = 'operation-bottom-controls';

      const smallRow = document.createElement('div');
      smallRow.className = 'operation-small-actions';

      screen.appendChild(controls);
      controls.appendChild(scanButton);
      smallRow.append(manual, comment);
      controls.append(smallRow, action);

      manual.addEventListener('toggle', () => {
        if (manual.open) comment.removeAttribute('open');
      });
      comment.addEventListener('toggle', () => {
        if (comment.open) manual.removeAttribute('open');
      });
    }
  }

  $('operationBackBottomBtn')?.classList.add('hidden');
}

function installOperationStyles() {
  if ($('operationCompactStyles')) return;

  const style = document.createElement('style');
  style.id = 'operationCompactStyles';
  style.textContent = `
    body:has(#screenOperation.active) {
      height: 100dvh;
      max-height: 100dvh;
      overflow: hidden;
      overscroll-behavior: none;
    }

    body:has(#screenOperation.active) .app-shell {
      height: 100dvh;
      min-height: 100dvh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    body:has(#screenOperation.active) .app-header {
      height: 48px;
      flex: 0 0 48px;
      gap: 10px;
    }

    body:has(#screenOperation.active) .app-header .brand-mark,
    body:has(#screenOperation.active) .app-header .brand-copy {
      display: none !important;
    }

    body:has(#screenOperation.active) #operationModeTitle {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      font-size: 18px !important;
      font-weight: 900 !important;
      line-height: 1.1 !important;
      letter-spacing: .35px !important;
      white-space: nowrap;
    }

    body:has(#screenOperation.active) #operationModeTitle.return {
      color: #7bd29d;
    }

    body:has(#screenOperation.active) #operationModeTitle.pick {
      color: #efb666;
    }

    body:has(#screenOperation.active) .network-badge {
      flex: 0 0 auto;
      margin-left: auto;
    }

    body:has(#screenOperation.active) .app-main {
      flex: 1 1 auto;
      height: auto;
      min-height: 0;
      padding-top: 8px;
      padding-bottom: 0;
      overflow: hidden;
    }

    #screenOperation.active {
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    #screenOperation.active .operation-head-minimal,
    #screenOperation .operation-add-area,
    #screenOperation #operationBackBottomBtn {
      display: none !important;
    }

    #screenOperation .operation-scroll-area {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      padding: 0 2px 8px 0;
    }

    #screenOperation .operation-list {
      gap: 0;
      border-top: 1px solid var(--line);
    }

    #screenOperation .part-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding: 11px 2px;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      background: transparent;
    }

    #screenOperation .part-main strong {
      display: block;
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    #screenOperation .part-main span {
      display: none;
    }

    #screenOperation .part-side {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    #screenOperation .qty-badge {
      min-width: 56px;
      height: 34px;
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: #313740;
      border: 1px solid var(--line);
      font-size: 13px;
      font-weight: 900;
      cursor: pointer;
      user-select: none;
    }

    #screenOperation .qty-badge::after {
      content: " szt.";
      font-size: 10px;
      font-weight: 700;
      margin-left: 2px;
      color: var(--muted);
    }

    #screenOperation .row-actions {
      display: flex;
      gap: 0;
    }

    #screenOperation .row-btn:not(.delete) {
      display: none;
    }

    #screenOperation .row-btn.delete {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border-radius: 6px;
      background: transparent;
      color: #ff6969;
      font-size: 25px;
      font-weight: 900;
      line-height: 1;
    }

    #screenOperation .operation-bottom-controls {
      flex: 0 0 auto;
      padding: 8px 0 max(4px, env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: rgba(29,32,37,.98);
    }

    #screenOperation .operation-bottom-controls .operation-scan-btn {
      min-height: 58px;
      margin: 0;
      font-size: 17px;
    }

    #screenOperation .operation-small-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
    }

    #screenOperation .operation-small-actions details {
      min-width: 0;
      margin: 0;
    }

    #screenOperation .operation-small-actions details[open] {
      grid-column: 1 / -1;
    }

    #screenOperation .operation-small-actions .part-manual-toggle,
    #screenOperation .operation-small-actions .operation-comment-toggle {
      min-height: 40px;
      padding: 7px 8px;
      font-size: 12px;
    }

    #screenOperation .operation-small-actions .part-manual-form,
    #screenOperation .operation-small-actions .operation-comment-body {
      margin-top: 8px;
    }

    #screenOperation .operation-bottom-controls #reviewSessionBtn {
      min-height: 48px;
      margin-top: 8px;
    }

    #screenOperation .operation-bottom-controls #reviewSessionBtn.operation-back-action {
      background: #3a414b;
      border: 1px solid var(--line);
    }
  `;
  document.head.appendChild(style);
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
  buildOperationLayout();
  installOperationStyles();
  document.addEventListener('click', interceptOperationClicks, true);
  document.addEventListener('click', trackAddedPart);
  observeOperationPresentation();
  suppressBlockingSyncSuccess();
}

document.addEventListener('DOMContentLoaded', initOperationFlow);
