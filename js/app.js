import { api } from './api.js';
import { loadState, saveState, clearState } from './storage.js';
import { startScanner, stopScanner } from './scanner.js';

const START_DATA_CACHE_KEY = 'selfstorage_start_data_cache_v1';

const state = {
  team: null,
  startData: null,
  visit: null,
  pendingStart: null,
  operationDraft: null
};

let toastTimer = null;
let scannerMode = null;
let quantityTarget = null;

function $(id) {
  return document.getElementById(id);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === id);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function persist() {
  saveState(state);
}

function readStartDataCache() {
  try {
    const raw = localStorage.getItem(START_DATA_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Nie udało się odczytać lokalnej pamięci danych startowych.', error);
    return {};
  }
}

function loadCachedStartData(teamId) {
  if (!teamId) return null;
  const entry = readStartDataCache()[teamId];
  return entry?.data || null;
}

function saveCachedStartData(teamId, data) {
  if (!teamId || !data) return;

  try {
    const cache = readStartDataCache();
    cache[teamId] = {
      savedAt: new Date().toISOString(),
      data
    };
    localStorage.setItem(START_DATA_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Nie udało się zapisać lokalnej pamięci danych startowych.', error);
  }
}

async function refreshStartDataInBackground(teamId) {
  if (!teamId || !navigator.onLine) return;

  try {
    const freshData = await api.getStartData(teamId);
    saveCachedStartData(teamId, freshData);

    if (state.team?.id === teamId) {
      state.startData = freshData;
      persist();
    }
  } catch (error) {
    console.warn('Odświeżenie danych startowych w tle nie powiodło się.', error);
  }
}

function restore() {
  const saved = loadState();
  if (!saved) return;

  state.team = saved.team || null;
  state.startData = saved.startData || null;
  state.visit = saved.visit || null;
  state.pendingStart = saved.pendingStart || null;
  state.operationDraft = saved.operationDraft || null;
}

function resetState() {
  state.team = null;
  state.startData = null;
  state.visit = null;
  state.pendingStart = null;
  state.operationDraft = null;
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
  }, 3400);
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

function randomToken(length = 12) {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replaceAll('-', '').slice(0, length).toUpperCase();
  }
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

function makeVisitId() {
  return `WIZ-APP-${Date.now()}-${randomToken(12)}`;
}

function makeSessionId() {
  return `SES-APP-${Date.now()}-${randomToken(12)}`;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanScannerValue(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/^\][A-Z0-9]{2}/, '')
    .trim();
}

function getParts() {
  return Array.isArray(state.startData?.czesci) ? state.startData.czesci : [];
}

function getDraftList(type) {
  if (!state.operationDraft) return [];
  return type === 'ZWROT'
    ? state.operationDraft.zwrot
    : state.operationDraft.pobranie;
}

function currentOperationType() {
  return state.operationDraft?.activeType === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
}

function draftItemCount() {
  if (!state.operationDraft) return 0;
  return state.operationDraft.pobranie.length + state.operationDraft.zwrot.length;
}

function hasDraftData() {
  if (!state.operationDraft) return false;
  return draftItemCount() > 0 || Boolean(String(state.operationDraft.komentarz || '').trim());
}

function isDraftLocked() {
  return Boolean(state.operationDraft?.operationTime);
}

function cleanEmptyDraft() {
  if (state.operationDraft && !hasDraftData()) {
    state.operationDraft = null;
    persist();
  }
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

  const role = String(state.team?.rola || '').trim().toUpperCase();
  const canInventory = ['KIEROWNIK', 'KOORDYNATOR', 'ADMIN'].includes(role);
  $('inventoryBtn').classList.toggle('hidden', !canInventory);

  const showDraft = Boolean(
    state.operationDraft &&
    state.operationDraft.idWizyty === state.visit?.idWizyty &&
    hasDraftData()
  );

  $('draftNotice').classList.toggle('hidden', !showDraft);

  if (showDraft) {
    const pob = state.operationDraft.pobranie.length;
    const zwr = state.operationDraft.zwrot.length;
    $('draftNoticeText').textContent = `Pobranie: ${pob} poz. • Zwrot: ${zwr} poz.`;
  }

  showScreen('screenVisit');
}

function buildPartSuggestions() {
  const datalist = $('partSuggestions');
  datalist.replaceChildren();

  for (const part of getParts()) {
    const option = document.createElement('option');
    option.value = `${part.kod} — ${part.nazwa}`;
    datalist.appendChild(option);
  }
}

async function ensurePartData() {
  if (getParts().length > 0) return true;

  if (!navigator.onLine || !state.team) {
    showToast('Brak lokalnej listy części. Połącz się z internetem.', true);
    return false;
  }

  setLoading(true, 'Pobieranie listy części…');
  try {
    state.startData = await api.getStartData(state.team.id);
    saveCachedStartData(state.team.id, state.startData);
    persist();
    return getParts().length > 0;
  } catch (error) {
    showToast(messageFromError(error), true);
    return false;
  } finally {
    setLoading(false);
  }
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
    const team = loginResult.ekipa;

    state.team = team;
    state.startData = loadCachedStartData(team.id);
    state.visit = null;
    state.pendingStart = null;
    state.operationDraft = null;
    persist();

    $('pinInput').value = '';
    $('loginBtn').disabled = true;
    renderWarehouse();

    refreshStartDataInBackground(team.id);
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
    state.operationDraft = null;
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

async function openCodeScanner(mode) {
  scannerMode = mode;

  const isPart = mode === 'part';
  $('scannerTitle').textContent = isPart ? 'Kod części' : 'Kod QR magazynu';
  $('scannerNote').textContent = isPart
    ? 'Skieruj aparat na kod QR lub Code128 części.'
    : 'Skieruj aparat na kod QR magazynu.';

  $('scannerModal').classList.add('show');
  $('scannerModal').setAttribute('aria-hidden', 'false');

  try {
    await startScanner(async code => {
      const activeMode = scannerMode;

      if (activeMode === 'part') {
        const result = findPart(code);

        if (!result.part) {
          const shortCode = cleanScannerValue(code).slice(0, 42);
          $('scannerNote').textContent = result.ambiguous
            ? 'Kod pasuje do kilku części. Zeskanuj dokładniejszy kod.'
            : `Nieznany kod: ${shortCode || '—'}. Zeskanuj ponownie.`;
          showToast('Nie rozpoznano części. Skaner pozostaje otwarty.', true);
          return false;
        }

        await closeScanner();
        openQuantityModal(result.part, currentOperationType(), 'add');
        return true;
      }

      await closeScanner();
      await startVisit(code);
      return true;
    }, { mode: isPart ? 'part' : 'warehouse' });
  } catch (error) {
    await closeScanner();
    showToast(`Nie udało się uruchomić aparatu. ${messageFromError(error)}`, true);
  }
}

async function closeScanner() {
  try {
    await stopScanner();
  } catch (error) {
    console.warn('Błąd przy zamykaniu skanera.', error);
  }

  scannerMode = null;
  $('scannerModal').classList.remove('show');
  $('scannerModal').setAttribute('aria-hidden', 'true');
}

async function beginOperation(type) {
  if (!state.team || !state.visit) return;
  if (!(await ensurePartData())) return;

  if (!state.operationDraft || state.operationDraft.idWizyty !== state.visit.idWizyty) {
    state.operationDraft = {
      idSesji: makeSessionId(),
      idWizyty: state.visit.idWizyty,
      activeType: type === 'ZWROT' ? 'ZWROT' : 'POBRANIE',
      pobranie: [],
      zwrot: [],
      komentarz: '',
      operationTime: null
    };
  } else {
    state.operationDraft.activeType = type === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  }

  persist();
  buildPartSuggestions();
  renderOperation();
}

function renderOperation() {
  if (!state.operationDraft || !state.visit) {
    renderVisit();
    return;
  }

  const type = currentOperationType();
  const isReturn = type === 'ZWROT';
  const list = getDraftList(type);
  const locked = isDraftLocked();

  $('operationWarehouse').textContent = state.visit.magazyn?.nazwa || 'Magazyn';
  $('operationTeam').textContent = `Ekipa ${state.team?.nazwa || '—'}`;

  $('tabPobranie').classList.toggle('active', !isReturn);
  $('tabZwrot').classList.toggle('active', isReturn);

  $('activeOperationEyebrow').textContent = type;
  $('activeOperationBadge').textContent = isReturn ? 'Zwrot' : 'Pobranie';
  $('activeOperationBadge').classList.toggle('pick', !isReturn);
  $('activeOperationBadge').classList.toggle('return', isReturn);

  $('listEyebrow').textContent = isReturn ? 'LISTA ZWROTU' : 'LISTA POBRANIA';
  $('listTitle').textContent = isReturn ? 'Zwracane części' : 'Pobierane części';

  const pobQty = state.operationDraft.pobranie.reduce((sum, item) => sum + item.ilosc, 0);
  const zwrQty = state.operationDraft.zwrot.reduce((sum, item) => sum + item.ilosc, 0);
  $('pobranieCount').textContent = `${state.operationDraft.pobranie.length} poz. / ${pobQty} szt.`;
  $('zwrotCount').textContent = `${state.operationDraft.zwrot.length} poz. / ${zwrQty} szt.`;
  $('activeListCount').textContent = String(list.length);

  $('operationComment').value = state.operationDraft.komentarz || '';
  $('operationComment').disabled = locked;
  $('openPartScannerBtn').disabled = locked;
  $('manualPartBtn').disabled = locked;
  $('partSearchInput').disabled = locked;
  $('reviewSessionBtn').textContent = locked ? 'Wyślij ponownie' : 'Podsumowanie i wyślij';

  renderPartList(list, type, locked);
  showScreen('screenOperation');
}

function renderPartList(list, type, locked) {
  const container = $('operationList');
  container.replaceChildren();
  $('operationEmpty').classList.toggle('hidden', list.length > 0);

  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'part-row';

    const main = document.createElement('div');
    main.className = 'part-main';

    const name = document.createElement('strong');
    name.textContent = item.nazwa;

    const code = document.createElement('span');
    code.textContent = item.kod;

    main.append(name, code);

    const side = document.createElement('div');
    side.className = 'part-side';

    const qty = document.createElement('div');
    qty.className = 'qty-badge';
    qty.textContent = item.ilosc;
    side.appendChild(qty);

    if (!locked) {
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const edit = document.createElement('button');
      edit.className = 'row-btn';
      edit.type = 'button';
      edit.textContent = '✎';
      edit.setAttribute('aria-label', `Edytuj ${item.nazwa}`);
      edit.addEventListener('click', () => openQuantityModal(item, type, 'replace'));

      const del = document.createElement('button');
      del.className = 'row-btn delete';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `Usuń ${item.nazwa}`);
      del.addEventListener('click', () => deletePart(item.kod, type));

      actions.append(edit, del);
      side.appendChild(actions);
    }

    row.append(main, side);
    container.appendChild(row);
  });
}

function switchOperationType(type) {
  if (!state.operationDraft) return;
  state.operationDraft.activeType = type === 'ZWROT' ? 'ZWROT' : 'POBRANIE';
  persist();
  renderOperation();
}

function findPart(value) {
  const raw = cleanScannerValue(value);
  if (!raw) return { part: null, ambiguous: false };

  const parts = getParts();
  const normalizedRaw = normalizeText(raw);
  const chunks = [raw];

  if (raw.includes('—')) chunks.push(raw.split('—')[0].trim());
  chunks.push(...raw.split(/[\r\n\t |;,]+/g).filter(Boolean));

  const normalizedCandidates = new Set(chunks.map(normalizeText).filter(Boolean));

  const exactCodeMatches = parts.filter(part =>
    normalizedCandidates.has(normalizeText(part.kod))
  );

  if (exactCodeMatches.length === 1) {
    return { part: exactCodeMatches[0], ambiguous: false };
  }
  if (exactCodeMatches.length > 1) {
    return { part: null, ambiguous: true };
  }

  const containedCodeMatches = parts.filter(part => {
    const code = normalizeText(part.kod);
    return code.length >= 6 && normalizedRaw.includes(code);
  });

  if (containedCodeMatches.length === 1) {
    return { part: containedCodeMatches[0], ambiguous: false };
  }
  if (containedCodeMatches.length > 1) {
    return { part: null, ambiguous: true };
  }

  const exactName = parts.find(part => normalizeText(part.nazwa) === normalizedRaw);
  if (exactName) return { part: exactName, ambiguous: false };

  const matches = parts.filter(part =>
    normalizeText(part.kod).includes(normalizedRaw) ||
    normalizeText(part.nazwa).includes(normalizedRaw)
  );

  if (matches.length === 1) return { part: matches[0], ambiguous: false };
  return { part: null, ambiguous: matches.length > 1 };
}

function processPartInput(value) {
  if (!state.operationDraft) return false;

  if (isDraftLocked()) {
    showToast('Ta sesja była już wysyłana. Możesz tylko ponowić wysyłkę.', true);
    return false;
  }

  const result = findPart(value);

  if (!result.part) {
    showToast(
      result.ambiguous
        ? 'Znaleziono kilka pasujących części. Wpisz dokładniejszy kod lub nazwę.'
        : 'Nieznana część. Zeskanuj ponownie lub wyszukaj część z listy.',
      true
    );
    return false;
  }

  $('partSearchInput').value = '';
  openQuantityModal(result.part, currentOperationType(), 'add');
  return true;
}

function openQuantityModal(part, type, mode) {
  if (!state.operationDraft || isDraftLocked()) return;

  const list = getDraftList(type);
  const existing = list.find(item => item.kod === part.kod);

  quantityTarget = {
    part,
    type,
    mode,
    existingQty: existing?.ilosc || 0
  };

  $('quantityTypeLabel').textContent = type;
  $('quantityPartName').textContent = part.nazwa;
  $('quantityPartCode').textContent = part.kod;

  const isReplace = mode === 'replace';
  $('existingQuantityInfo').classList.toggle('hidden', !existing);

  if (existing) {
    $('existingQuantityInfo').textContent = isReplace
      ? `Aktualna ilość: ${existing.ilosc} szt.`
      : `Ta część jest już na liście: ${existing.ilosc} szt. Wpisz ilość dodatkową.`;
  }

  $('quantityInput').value = isReplace && existing ? String(existing.ilosc) : '';
  $('quantityAddBtn').textContent = isReplace ? 'Zapisz' : 'Dodaj';

  $('quantityModal').classList.add('show');
  $('quantityModal').setAttribute('aria-hidden', 'false');

  setTimeout(() => $('quantityInput').focus(), 80);
}

function closeQuantityModal() {
  quantityTarget = null;
  $('quantityInput').value = '';
  $('quantityModal').classList.remove('show');
  $('quantityModal').setAttribute('aria-hidden', 'true');
}

function confirmQuantity() {
  if (!quantityTarget || !state.operationDraft) return;

  const qty = Number($('quantityInput').value);
  if (!Number.isInteger(qty) || qty < 1) {
    showToast('Ilość musi być liczbą całkowitą większą od zera.', true);
    return;
  }

  const list = getDraftList(quantityTarget.type);
  const existing = list.find(item => item.kod === quantityTarget.part.kod);

  if (existing) {
    existing.ilosc = quantityTarget.mode === 'replace'
      ? qty
      : existing.ilosc + qty;
  } else {
    list.push({
      kod: quantityTarget.part.kod,
      nazwa: quantityTarget.part.nazwa,
      ilosc: qty
    });
  }

  persist();
  closeQuantityModal();
  renderOperation();
  showToast(existing ? 'Ilość została dodana.' : 'Część dodana do listy.');
}

function deletePart(code, type) {
  if (!state.operationDraft || isDraftLocked()) return;

  const list = getDraftList(type);
  const index = list.findIndex(item => item.kod === code);
  if (index >= 0) list.splice(index, 1);

  persist();
  renderOperation();
}

function saveCommentFromUi() {
  if (!state.operationDraft || isDraftLocked()) return;
  state.operationDraft.komentarz = $('operationComment').value;
  persist();
}

function backToVisit() {
  saveCommentFromUi();
  cleanEmptyDraft();
  renderVisit();
}

function appendReviewSection(parent, title, type, items) {
  if (!items.length) return;

  const section = document.createElement('div');
  section.className = 'review-section';

  const head = document.createElement('div');
  head.className = `review-section-head ${type}`;
  head.textContent = title;
  section.appendChild(head);

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'review-row';

    const name = document.createElement('strong');
    name.textContent = `${item.nazwa} (${item.kod})`;

    const qty = document.createElement('span');
    qty.textContent = `${item.ilosc} szt.`;

    row.append(name, qty);
    section.appendChild(row);
  });

  parent.appendChild(section);
}

function openReview() {
  if (!state.operationDraft) return;
  saveCommentFromUi();

  if (draftItemCount() === 0) {
    showToast('Dodaj przynajmniej jedną część.', true);
    return;
  }

  const content = $('reviewContent');
  content.replaceChildren();

  appendReviewSection(content, 'Pobranie', 'pick', state.operationDraft.pobranie);
  appendReviewSection(content, 'Zwrot', 'return', state.operationDraft.zwrot);

  const comment = String(state.operationDraft.komentarz || '').trim();
  if (comment) {
    const box = document.createElement('div');
    box.className = 'review-comment';

    const label = document.createElement('span');
    label.textContent = 'Komentarz';

    const value = document.createElement('strong');
    value.textContent = comment;

    box.append(label, value);
    content.appendChild(box);
  }

  $('reviewSendBtn').textContent = isDraftLocked() ? 'Wyślij ponownie' : 'Wyślij';
  $('reviewModal').classList.add('show');
  $('reviewModal').setAttribute('aria-hidden', 'false');
}

function closeReview() {
  $('reviewModal').classList.remove('show');
  $('reviewModal').setAttribute('aria-hidden', 'true');
}

function handleDraftQueued() {
  if (!state.operationDraft) return;

  state.operationDraft = null;
  persist();
  closeReview();
  renderVisit();
}

async function sendSession() {
  if (!state.operationDraft || !state.team || !state.visit) return;

  if (!navigator.onLine) {
    showToast('Wysyłanie offline dodamy w kolejnym etapie. Teraz potrzebny jest internet.', true);
    return;
  }

  if (draftItemCount() === 0) {
    showToast('Brak części do wysłania.', true);
    return;
  }

  if (!state.operationDraft.operationTime) {
    state.operationDraft.operationTime = new Date().toISOString();
    persist();
  }

  const draft = state.operationDraft;
  closeReview();
  setLoading(true, 'Zapisywanie operacji…');

  try {
    await api.saveSession({
      idSesji: draft.idSesji,
      idWizyty: state.visit.idWizyty,
      dataCzasOperacji: draft.operationTime,
      idEkipy: state.team.id,
      idMagazynu: state.visit.magazyn.id,
      komentarz: String(draft.komentarz || '').trim(),
      pobranie: draft.pobranie.map(item => ({ kod: item.kod, ilosc: item.ilosc })),
      zwrot: draft.zwrot.map(item => ({ kod: item.kod, ilosc: item.ilosc }))
    });

    state.operationDraft = null;
    persist();
    renderVisit();
    showToast('Operacja została zapisana.');
  } catch (error) {
    persist();
    renderOperation();
    showToast(`${messageFromError(error)} Spróbuj wysłać ponownie bez zmiany zawartości.`, true);
  } finally {
    setLoading(false);
  }
}

async function finishVisit() {
  if (!state.team || !state.visit) return;

  cleanEmptyDraft();

  if (hasDraftData()) {
    showToast('Masz niedokończoną operację. Najpierw ją wyślij.', true);
    return;
  }

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
  $('openWarehouseScannerBtn').addEventListener('click', () => openCodeScanner('warehouse'));
  $('closeScannerBtn').addEventListener('click', closeScanner);

  $('manualWarehouseBtn').addEventListener('click', () => startVisit($('warehouseCodeInput').value));
  $('warehouseCodeInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') startVisit(event.target.value);
  });

  $('pobranieBtn').addEventListener('click', () => beginOperation('POBRANIE'));
  $('zwrotBtn').addEventListener('click', () => beginOperation('ZWROT'));
  $('resumeDraftBtn').addEventListener('click', () => beginOperation(state.operationDraft?.activeType || 'POBRANIE'));

  $('tabPobranie').addEventListener('click', () => switchOperationType('POBRANIE'));
  $('tabZwrot').addEventListener('click', () => switchOperationType('ZWROT'));
  $('openPartScannerBtn').addEventListener('click', () => openCodeScanner('part'));
  $('manualPartBtn').addEventListener('click', () => processPartInput($('partSearchInput').value));
  $('partSearchInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') processPartInput(event.target.value);
  });

  $('quantityCancelBtn').addEventListener('click', closeQuantityModal);
  $('quantityAddBtn').addEventListener('click', confirmQuantity);
  $('quantityInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') confirmQuantity();
  });

  $('operationComment').addEventListener('input', saveCommentFromUi);
  $('operationBackBtn').addEventListener('click', backToVisit);
  $('operationBackBottomBtn').addEventListener('click', backToVisit);
  $('reviewSessionBtn').addEventListener('click', openReview);
  $('reviewCancelBtn').addEventListener('click', closeReview);
  $('reviewSendBtn').addEventListener('click', sendSession);

  $('finishVisitBtn').addEventListener('click', () => {
    cleanEmptyDraft();
    if (hasDraftData()) {
      showToast('Masz niedokończoną operację. Najpierw ją wyślij.', true);
      return;
    }
    $('finishModal').classList.add('show');
    $('finishModal').setAttribute('aria-hidden', 'false');
  });

  $('finishNoBtn').addEventListener('click', () => {
    $('finishModal').classList.remove('show');
    $('finishModal').setAttribute('aria-hidden', 'true');
  });

  $('finishYesBtn').addEventListener('click', finishVisit);

  $('inventoryBtn').addEventListener('click', () => {
    showToast('Inwentaryzację dołączymy po zakończeniu Pobranie / Zwrot.');
  });

  document.addEventListener('selfstorage:draft-queued', handleDraftQueued);
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
