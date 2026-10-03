import { api } from './api.js';
import { loadState, saveState, clearState } from './storage.js';
import { startScanner, stopScanner } from './scanner.js';
import { getDeviceId } from './device.js';

const APP_VERSION = '0.46';
const START_DATA_CACHE_KEY = 'selfstorage_start_data_cache_v1';
const VEHICLE_STOCK_CACHE_KEY = 'selfstorage_vehicle_stock_cache_v1';
const DEVICE_ID = getDeviceId();
const DEMO_PIN = '0000';
const DEMO_PARTS = Object.freeze([
  { kod: 'DEMO-001', nazwa: 'CEOWNIK DACHU DŁUGI (HOKEJKA DŁUGA)' },
  { kod: 'DEMO-002', nazwa: 'DASZEK LED' },
  { kod: 'DEMO-003', nazwa: 'KOTWA BETON' },
  { kod: 'DEMO-004', nazwa: 'KOTWA BRUK' },
  { kod: 'DEMO-005', nazwa: 'PESZEL' },
  { kod: 'DEMO-006', nazwa: 'DZIELENIE OUTDOOR ODWRÓCONY L SHAPE' },
  { kod: 'DEMO-007', nazwa: 'PUSZKA HARTING FM' },
  { kod: 'DEMO-008', nazwa: 'SŁUPEK' }
]);

const state = {
  demo: false,
  team: null,
  startData: null,
  visit: null,
  pendingStart: null,
  operationDraft: null,
  vehicleVisitDelta: {},
  vehicleStockCache: null
};

let toastTimer = null;
let scannerMode = null;
let quantityTarget = null;
let vehicleStockRequest = null;
let vehicleManualDraft = {};
let vehicleManualPart = null;
let vehicleInventoryParts = [];

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

const ANDROID_BACK_ROOT = 'selfstorage-back-root';
const ANDROID_BACK_GUARD = 'selfstorage-back-guard';
let allowBrowserExit = false;
let handlingSystemBack = false;

function getActiveScreenId() {
  return document.querySelector('.screen.active')?.id || 'screenLogin';
}

async function closeTopOverlayForSystemBack() {
  if ($('loading')?.classList.contains('show')) {
    return true;
  }

  if ($('demoPartModal')?.classList.contains('show')) {
    closeDemoPartPicker();
    return true;
  }

  if ($('scannerModal')?.classList.contains('show')) {
    await closeScanner();
    return true;
  }

  if ($('quantityModal')?.classList.contains('show')) {
    closeQuantityModal();
    return true;
  }

  if ($('reviewModal')?.classList.contains('show')) {
    closeReview();
    return true;
  }

  if ($('finishModal')?.classList.contains('show')) {
    $('finishNoBtn')?.click();
    return true;
  }

  if ($('instructionModal')?.classList.contains('show')) {
    $('instructionCloseBtn')?.click();
    return true;
  }

  const authModal = $('authMessageModal');
  if (authModal?.classList.contains('show')) {
    authModal.classList.remove('show');
    authModal.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => authModal.remove(), 250);
    return true;
  }

  return false;
}

async function handleSystemBack() {
  if (await closeTopOverlayForSystemBack()) {
    return false;
  }

  const activeScreen = getActiveScreenId();

  if (activeScreen === 'screenOperation') {
    backToVisit();
    return false;
  }

  if (activeScreen === 'screenVehicle') {
    if (state.visit?.idWizyty) {
      renderVisit();
    } else {
      renderWarehouse();
    }
    return false;
  }

  if (activeScreen === 'screenVisit') {
    $('finishVisitBtn')?.click();
    return false;
  }

  if (activeScreen === 'screenWarehouse') {
    logout();
    return false;
  }

  if (activeScreen === 'screenDone') {
    showScreen('screenLogin');
    return false;
  }

  return activeScreen === 'screenLogin';
}

function ensureSystemBackGuard() {
  if (!window.history?.pushState) return;

  const marker = history.state?.selfStorageBack;
  if (marker === ANDROID_BACK_GUARD) return;

  history.pushState(
    { selfStorageBack: ANDROID_BACK_GUARD },
    document.title,
    location.href
  );
}

function armSystemBackGuard() {
  if (!window.history?.pushState) return;

  const currentState = history.state && typeof history.state === 'object'
    ? history.state
    : {};

  history.replaceState(
    { ...currentState, selfStorageBack: ANDROID_BACK_ROOT },
    document.title,
    location.href
  );

  history.pushState(
    { selfStorageBack: ANDROID_BACK_GUARD },
    document.title,
    location.href
  );

  window.addEventListener('popstate', async () => {
    if (allowBrowserExit || handlingSystemBack) return;

    handlingSystemBack = true;

    try {
      const shouldExit = await handleSystemBack();

      if (shouldExit) {
        allowBrowserExit = true;
        history.back();
        return;
      }

      history.pushState(
        { selfStorageBack: ANDROID_BACK_GUARD },
        document.title,
        location.href
      );
    } finally {
      handlingSystemBack = false;
    }
  });
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
    // Dla ekipy logowanie ma być lekkie, ale dane w tle mają być naprawdę świeże.
    // fresh=true omija wielodniowy cache Service Workera i pobiera aktualne dane z serwera.
    const freshData = await api.getStartData(teamId, true);
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

  state.demo = Boolean(saved.demo);
  state.team = saved.team || null;
  state.startData = saved.startData || null;
  state.visit = saved.visit || null;
  state.pendingStart = saved.pendingStart || null;
  state.operationDraft = saved.operationDraft || null;
  state.vehicleVisitDelta =
    saved.vehicleVisitDelta && typeof saved.vehicleVisitDelta === 'object'
      ? saved.vehicleVisitDelta
      : {};
  state.vehicleStockCache =
    saved.vehicleStockCache && typeof saved.vehicleStockCache === 'object'
      ? saved.vehicleStockCache
      : null;
}

function resetState() {
  state.demo = false;
  state.team = null;
  state.startData = null;
  state.visit = null;
  state.pendingStart = null;
  state.operationDraft = null;
  state.vehicleVisitDelta = {};
  state.vehicleStockCache = null;
  vehicleStockRequest = null;
  clearState();
  updateDemoUi();
}

function isDemoMode() {
  return Boolean(state.demo || state.team?.id === 'DEMO');
}

function updateDemoUi() {
  const active = isDemoMode();
  $('demoBanner')?.classList.toggle('hidden', !active);
  document.body.classList.toggle('demo-mode', active);

  const partButton = $('openPartScannerBtn');
  if (partButton) {
    partButton.textContent = active ? 'Wybierz część demo' : 'Skanuj kod części';
  }

  if (active) {
    $('networkBadge')?.classList.remove('offline');
    if ($('networkText')) $('networkText').textContent = 'DEMO';
  }
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
  if (isDemoMode()) {
    $('networkBadge').classList.remove('offline');
    $('networkText').textContent = 'DEMO';
    return;
  }

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

function isAdminTeam(team = state.team) {
  return String(team?.rola || '').trim().toUpperCase() === 'ADMIN';
}

async function refreshAdminStartData() {
  if (!state.team?.id || !isAdminTeam()) return null;

  const freshData = await api.getStartData(state.team.id, true);
  state.startData = freshData;
  saveCachedStartData(state.team.id, freshData);
  persist();
  return freshData;
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
  updateDemoUi();
  $('teamName').textContent = state.team?.nazwa || 'Ekipa';
  $('teamRole').textContent = state.team?.rola || '';
  showScreen('screenWarehouse');
}

function renderVisit() {
  updateDemoUi();
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

function formatVehicleQty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '—';
}

function addDraftToVehicleDelta(delta, draft) {
  if (!draft) return delta;

  const addList = (list, sign) => {
    if (!Array.isArray(list)) return;

    for (const item of list) {
      const code = String(item?.kod || '').trim();
      const qty = Number(item?.ilosc);

      if (!code || !Number.isFinite(qty)) continue;
      delta[code] = Number(delta[code] || 0) + (sign * qty);
    }
  };

  addList(draft.pobranie, 1);
  addList(draft.zwrot, -1);
  return delta;
}

function getEffectiveVehicleDelta() {
  const delta = {};

  for (const [code, value] of Object.entries(state.vehicleVisitDelta || {})) {
    const qty = Number(value);
    if (code && Number.isFinite(qty) && qty !== 0) {
      delta[code] = qty;
    }
  }

  if (
    state.operationDraft &&
    state.operationDraft.idWizyty === state.visit?.idWizyty
  ) {
    addDraftToVehicleDelta(delta, state.operationDraft);
  }

  return delta;
}

function commitDraftToVehicleDelta(draft) {
  if (!draft || draft.idWizyty !== state.visit?.idWizyty) return;

  const entry =
    state.vehicleStockCache ||
    readStoredVehicleStock(state.team?.id);

  if (!entry?.data || !Array.isArray(entry.data.czesci)) {
    const next = { ...(state.vehicleVisitDelta || {}) };
    addDraftToVehicleDelta(next, draft);
    state.vehicleVisitDelta = next;
    persist();
    return;
  }

  const parts = entry.data.czesci.map(part => ({ ...part }));
  const byCode = new Map(
    parts.map((part, index) => [String(part?.kod || '').trim(), { part, index }])
  );

  const applyList = (list, sign) => {
    if (!Array.isArray(list)) return;

    for (const item of list) {
      const code = String(item?.kod || '').trim();
      const qty = Number(item?.ilosc);
      if (!code || !Number.isFinite(qty) || qty <= 0) continue;

      const found = byCode.get(code);
      const current = Number(found?.part?.stanAktualny || 0);
      const nextQty = Math.max(0, current + (sign * qty));

      if (found) {
        found.part.stanAktualny = nextQty;

        const target = Number(found.part.stanDocelowy);
        const required = Number.isFinite(target) && target > 0;

        if (!required && nextQty === 0) {
          parts.splice(found.index, 1);
          byCode.clear();
          parts.forEach((part, index) => {
            byCode.set(String(part?.kod || '').trim(), { part, index });
          });
        }
        continue;
      }

      if (nextQty <= 0) continue;

      const master = getParts().find(part => String(part?.kod || '').trim() === code);
      const added = {
        kod: code,
        numerIndeksu: '',
        nazwa: master?.nazwa || code,
        stanDocelowy: null,
        stanAktualny: nextQty,
        wymagany: false
      };

      parts.push(added);
      byCode.set(code, { part: added, index: parts.length - 1 });
    }
  };

  applyList(draft.pobranie, 1);
  applyList(draft.zwrot, -1);

  const pending = new Set(
    Array.isArray(entry.pendingSessionIds)
      ? entry.pendingSessionIds.map(String)
      : []
  );
  pending.add(String(draft.idSesji || ''));

  const nextEntry = {
    ...entry,
    teamId: state.team?.id || entry.teamId,
    visitId: state.visit?.idWizyty || entry.visitId || null,
    fetchedAt: entry.fetchedAt || new Date().toISOString(),
    updatedLocallyAt: new Date().toISOString(),
    dirty: true,
    pendingSessionIds: [...pending].filter(Boolean),
    data: {
      ...entry.data,
      czesci: parts
    }
  };

  state.vehicleVisitDelta = {};
  state.vehicleStockCache = nextEntry;
  writeStoredVehicleStock(state.team?.id, nextEntry);
  persist();
}

function getCachedVehicleStock() {
  const cache = state.vehicleStockCache;
  if (!cache || !cache.data || !state.team?.id) return null;
  if (String(cache.teamId || '') !== String(state.team.id)) return null;
  return cache.data;
}

function readStoredVehicleStock(teamId) {
  if (!teamId) return null;

  try {
    const raw = localStorage.getItem(VEHICLE_STOCK_CACHE_KEY);
    if (!raw) return null;

    const all = JSON.parse(raw);
    const entry = all && typeof all === 'object'
      ? all[String(teamId)]
      : null;

    return entry?.data ? entry : null;
  } catch (error) {
    console.warn('Nie udało się odczytać zapisanego stanu auta.', error);
    return null;
  }
}

function writeStoredVehicleStock(teamId, entry) {
  if (!teamId || !entry?.data) return;

  try {
    const raw = localStorage.getItem(VEHICLE_STOCK_CACHE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const safe = all && typeof all === 'object' ? all : {};

    safe[String(teamId)] = entry;
    localStorage.setItem(VEHICLE_STOCK_CACHE_KEY, JSON.stringify(safe));
  } catch (error) {
    console.warn('Nie udało się zapisać stanu auta w pamięci.', error);
  }
}

function storeVehicleStockCache(data) {
  if (!state.team?.id || !data) return;

  const previous =
    state.vehicleStockCache ||
    readStoredVehicleStock(state.team.id);

  const pendingSessionIds =
    Array.isArray(previous?.pendingSessionIds)
      ? previous.pendingSessionIds
      : [];

  const entry = {
    teamId: state.team.id,
    visitId: state.visit?.idWizyty || null,
    fetchedAt: new Date().toISOString(),
    updatedLocallyAt: previous?.updatedLocallyAt || null,
    dirty: pendingSessionIds.length > 0,
    pendingSessionIds,
    data
  };

  state.vehicleStockCache = entry;
  writeStoredVehicleStock(state.team.id, entry);
  persist();
}

async function fetchVehicleStockOnce() {
  if (!state.team?.id) return null;

  if (vehicleStockRequest) {
    return vehicleStockRequest;
  }

  vehicleStockRequest = api
    .getVehicleStock(
      state.team.id,
      state.team?.nazwa || '',
      DEVICE_ID
    )
    .then(data => {
      storeVehicleStockCache(data);
      return data;
    })
    .finally(() => {
      vehicleStockRequest = null;
    });

  return vehicleStockRequest;
}

function getVehicleCacheEntry() {
  if (
    state.vehicleStockCache?.data &&
    String(state.vehicleStockCache.teamId || '') === String(state.team?.id || '')
  ) {
    return state.vehicleStockCache;
  }

  return readStoredVehicleStock(state.team?.id);
}

function fnv1a32(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).toUpperCase().padStart(8, '0');
}

function vehicleDataHash(data) {
  const stateMap = {};

  for (const part of Array.isArray(data?.czesci) ? data.czesci : []) {
    const code = String(part?.kod || '').trim();
    const rawQty = part?.stanAktualny;

    if (
      !code ||
      rawQty === null ||
      rawQty === undefined ||
      rawQty === ''
    ) {
      continue;
    }

    const qty = Number(rawQty);
    if (!Number.isFinite(qty)) continue;
    stateMap[code] = Math.max(0, Math.floor(qty));
  }

  const ordered = {};
  Object.keys(stateMap)
    .sort()
    .forEach(code => {
      ordered[code] = stateMap[code];
    });

  return fnv1a32(JSON.stringify(ordered));
}

function vehicleVersionsMatch(localData, meta) {
  if (!localData || !meta) return false;

  const localStateVersion = Number(localData.wersjaStanu || 0);
  const remoteStateVersion = Number(meta.wersjaStanu || 0);
  const localListVersion = String(localData.wersjaListy || '');
  const remoteListVersion = String(meta.wersjaListy || '');
  const localInventoryDone = localData.inwentaryzacjaWykonana;
  const remoteInventoryDone = meta.inwentaryzacjaWykonana;

  if (typeof localInventoryDone !== 'boolean') {
    return false;
  }

  return (
    localStateVersion === remoteStateVersion &&
    localListVersion === remoteListVersion &&
    localInventoryDone === Boolean(remoteInventoryDone)
  );
}

function warmVehicleStateInBackground() {
  if (
    !state.team?.id ||
    isDemoMode() ||
    !navigator.onLine ||
    getVehicleCacheEntry()?.data ||
    vehicleStockRequest
  ) {
    return;
  }

  window.setTimeout(() => {
    if (
      !state.team?.id ||
      !navigator.onLine ||
      getVehicleCacheEntry()?.data ||
      vehicleStockRequest
    ) {
      return;
    }

    fetchVehicleStockOnce()
      .catch(error => {
        console.warn('Wstępne pobieranie stanu auta nie powiodło się.', error);
      });
  }, 350);
}

function syncVehicleStateInBackground() {
  if (!state.team?.id || isDemoMode() || !navigator.onLine) return;

  const entry = getVehicleCacheEntry();

  if (entry?.data) {
    refreshVehicleSyncInBackground(entry);
    return;
  }

  warmVehicleStateInBackground();
}

async function refreshTeamDataInBackground(teamId) {
  if (!teamId || isAdminTeam() || !navigator.onLine) return;

  // Najpierw świeża konfiguracja/lista części. Stan auta rusza dopiero później,
  // żeby dwa cięższe zapytania nie konkurowały podczas samego logowania.
  await refreshStartDataInBackground(teamId);

  if (state.team?.id !== teamId || isAdminTeam()) return;
  syncVehicleStateInBackground();
}

function refreshVehicleSyncInBackground(entry) {
  if (!navigator.onLine || !state.team?.id || !entry?.data) return;

  if (
    Array.isArray(entry.pendingSessionIds) &&
    entry.pendingSessionIds.length > 0
  ) {
    return;
  }

  if (entry.needsRefresh) {
    fetchVehicleStockOnce()
      .then(data => {
        if (getActiveScreenId() === 'screenVehicle') {
          renderVehicleStock(data);
        }
      })
      .catch(error => {
        console.warn('Pełne odświeżenie stanu auta nie powiodło się.', error);
      });
    return;
  }

  api
    .getVehicleSyncMeta(
      state.team.id,
      state.team?.nazwa || '',
      DEVICE_ID
    )
    .then(meta => {
      const latest = getVehicleCacheEntry();
      if (!latest?.data) return;

      if (vehicleVersionsMatch(latest.data, meta)) {
        return;
      }

      return fetchVehicleStockOnce()
        .then(data => {
          if (getActiveScreenId() === 'screenVehicle') {
            renderVehicleStock(data);
          }
        });
    })
    .catch(error => {
      console.warn('Sprawdzenie wersji stanu auta nie powiodło się.', error);
    });
}

function markVehicleSessionSynced(event) {
  const idSesji = String(event?.detail?.idSesji || '').trim();
  const result = event?.detail?.result || {};

  if (!idSesji || !state.team?.id) return;

  const version = Number(result.wersjaStanuAuta);
  if (!Number.isFinite(version) || version < 1) {
    return;
  }

  const entry = getVehicleCacheEntry();
  if (!entry?.data) return;

  const pending = (
    Array.isArray(entry.pendingSessionIds)
      ? entry.pendingSessionIds
      : []
  ).filter(id => String(id) !== idSesji);

  const localHash = vehicleDataHash(entry.data);
  const serverHash = String(result.hashStanuAuta || '').trim().toUpperCase();
  const hashesMatch = !serverHash || localHash === serverHash;
  const needsRefresh = pending.length === 0 && !hashesMatch;

  const data = {
    ...entry.data,
    wersjaStanu: version,
    wersjaListy:
      result.wersjaListyAuta ||
      entry.data.wersjaListy ||
      '',
    hashStanu:
      hashesMatch
        ? (serverHash || localHash)
        : (entry.data.hashStanu || '')
  };

  const nextEntry = {
    ...entry,
    fetchedAt: new Date().toISOString(),
    dirty: pending.length > 0,
    needsRefresh,
    pendingSessionIds: pending,
    data
  };

  state.vehicleStockCache = nextEntry;
  writeStoredVehicleStock(state.team.id, nextEntry);
  persist();

  if (needsRefresh && navigator.onLine) {
    refreshVehicleSyncInBackground(nextEntry);
  }
}

function renderVehicleStock(data) {
  const inWarehouseVisit = Boolean(state.visit?.idWizyty);
  const inventoryDone = data?.inwentaryzacjaWykonana !== false;

  let parts = (Array.isArray(data?.czesci) ? data.czesci : [])
    .slice();

  if (inWarehouseVisit && inventoryDone) {
    const localDelta = getEffectiveVehicleDelta();

    parts = parts.map(part => {
      const base = Number(part.stanAktualny);
      const code = String(part?.kod || '').trim();

      if (
        part.stanAktualny === null ||
        part.stanAktualny === undefined ||
        !Number.isFinite(base)
      ) {
        return part;
      }

      return {
        ...part,
        stanAktualny: base + Number(localDelta[code] || 0)
      };
    });

    parts = parts.filter(part => {
      const target = Number(part.stanDocelowy);
      const actual = Number(part.stanAktualny);

      if (!Number.isFinite(target) || target <= 0) return false;
      if (part.stanAktualny === null || part.stanAktualny === undefined) return false;
      if (!Number.isFinite(actual)) return false;

      return actual !== target;
    });

    parts.sort((a, b) => {
      const diffA = Number(a.stanAktualny) - Number(a.stanDocelowy);
      const diffB = Number(b.stanAktualny) - Number(b.stanDocelowy);

      const typeA = diffA < 0 ? 0 : 1;
      const typeB = diffB < 0 ? 0 : 1;

      if (typeA !== typeB) return typeA - typeB;

      return String(a?.nazwa || a?.kod || '')
        .localeCompare(
          String(b?.nazwa || b?.kod || ''),
          'pl',
          { sensitivity: 'base' }
        );
    });
  } else {
    parts.sort((a, b) =>
      String(a?.nazwa || a?.kod || '')
        .localeCompare(
          String(b?.nazwa || b?.kod || ''),
          'pl',
          { sensitivity: 'base' }
        )
    );
  }

  const list = $('vehiclePartsList');
  const empty = $('vehiclePartsEmpty');

  $('vehiclePartCount').textContent = String(parts.length);

  if (!inventoryDone) {
    $('vehicleModeNote').textContent = 'Inwentaryzacja niewykonana';
  } else {
    $('vehicleModeNote').textContent = inWarehouseVisit
      ? 'Pokazane braki i nadstany'
      : 'Pełny stan auta';
  }

  list.replaceChildren();

  for (const part of parts) {
    const row = document.createElement('div');
    row.className = 'vehicle-part-row';

    const main = document.createElement('div');
    main.className = 'vehicle-part-main';

    const name = document.createElement('strong');
    name.textContent = part.nazwa || part.kod || 'Część';

    const required = document.createElement('span');
    required.textContent =
      part.stanDocelowy === null ||
      part.stanDocelowy === undefined ||
      Number(part.stanDocelowy) <= 0
        ? 'Wymagane: —'
        : `Wymagane: ${formatVehicleQty(part.stanDocelowy)} szt.`;

    main.append(name, required);

    const qty = document.createElement('div');
    qty.className = 'vehicle-part-qty';

    const current = document.createElement('strong');
    current.textContent =
      !inventoryDone ||
      part.stanAktualny === null ||
      part.stanAktualny === undefined
        ? 'Stan: —'
        : `Stan: ${formatVehicleQty(part.stanAktualny)} szt.`;

    qty.append(current);

    if (inWarehouseVisit && inventoryDone) {
      const target = Number(part.stanDocelowy);
      const actual = Number(part.stanAktualny);

      if (
        Number.isFinite(target) &&
        target > 0 &&
        Number.isFinite(actual)
      ) {
        const difference = actual - target;
        const balance = document.createElement('span');
        balance.className = 'vehicle-balance';

        if (difference < 0) {
          balance.classList.add('shortage');
          balance.textContent = `Brakuje: ${Math.abs(difference)} szt.`;
        } else {
          balance.classList.add('surplus');
          balance.textContent = `Nadstan: ${difference} szt.`;
        }

        qty.append(balance);
      }
    }

    row.append(main, qty);
    list.appendChild(row);
  }

  empty.classList.toggle('hidden', parts.length > 0);

  if (!parts.length && !inventoryDone) {
    const strong = empty.querySelector('strong');
    const span = empty.querySelector('span');
    if (strong) strong.textContent = 'Inwentaryzacja niewykonana';
    if (span) span.textContent = 'Stan auta zostanie ustalony po pierwszej inwentaryzacji.';
  } else if (!parts.length && inWarehouseVisit) {
    const strong = empty.querySelector('strong');
    const span = empty.querySelector('span');
    if (strong) strong.textContent = 'Brak różnic';
    if (span) span.textContent = 'Stan auta jest zgodny z wymaganymi ilościami.';
  } else if (!parts.length) {
    const strong = empty.querySelector('strong');
    const span = empty.querySelector('span');
    if (strong) strong.textContent = 'Brak części do wyświetlenia';
    if (span) span.textContent = 'Sprawdź konfigurację zakładki Samochody.';
  }

  showScreen('screenVehicle');
}

async function openVehicleStock() {
  if (!state.team?.id) return;

  if (isDemoMode()) {
    showToast('Stan auta nie jest dostępny w trybie DEMO.');
    return;
  }

  const entry = getVehicleCacheEntry();

  if (entry?.data) {
    state.vehicleStockCache = {
      ...entry,
      teamId: state.team.id,
      visitId: state.visit?.idWizyty || null
    };
    persist();

    renderVehicleStock(entry.data);
    refreshVehicleSyncInBackground(state.vehicleStockCache);
    return;
  }

  if (!navigator.onLine) {
    showToast('Brak zapisanego stanu auta. Połącz się z internetem.', true);
    return;
  }

  setLoading(true, 'Pierwsze pobieranie stanu auta…');

  try {
    const data = await fetchVehicleStockOnce();
    renderVehicleStock(data);
  } catch (error) {
    const message = messageFromError(error);
    showToast(
      message.includes('Nieznana akcja')
        ? 'Stan auta wymaga aktualizacji serwera aplikacji.'
        : message,
      true
    );
  } finally {
    setLoading(false);
  }
}

function closeVehicleStock() {
  if (state.visit?.idWizyty) {
    renderVisit();
    ensureSystemBackGuard();
  } else {
    renderWarehouse();
  }
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

function startDemoSession() {
  state.demo = true;
  state.team = {
    id: 'DEMO',
    nazwa: 'DEMO',
    rola: 'EKIPA'
  };
  state.startData = {
    czesci: DEMO_PARTS.map(part => ({ ...part }))
  };
  state.visit = {
    idWizyty: `DEMO-${Date.now()}`,
    start: new Date().toISOString(),
    status: 'AKTYWNA',
    magazyn: {
      id: 'DEMO',
      nazwa: 'MAGAZYN DEMO'
    }
  };
  state.pendingStart = null;
  state.operationDraft = null;
  persist();

  $('pinInput').value = '';
  $('loginBtn').disabled = true;
  updateDemoUi();
  renderVisit();
}

function openDemoPartPicker() {
  if (!isDemoMode()) return;

  const modal = $('demoPartModal');
  const list = $('demoPartList');
  if (!modal || !list) return;

  list.replaceChildren();

  for (const part of getParts()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'demo-part-option';

    const name = document.createElement('strong');
    name.textContent = part.nazwa;

    const code = document.createElement('span');
    code.textContent = part.kod;

    button.append(name, code);
    button.addEventListener('click', () => {
      closeDemoPartPicker();
      openQuantityModal(part, currentOperationType(), 'add');
    });

    list.appendChild(button);
  }

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDemoPartPicker() {
  const modal = $('demoPartModal');
  modal?.classList.remove('show');
  modal?.setAttribute('aria-hidden', 'true');
}

async function login() {
  const pin = $('pinInput').value.replace(/\D/g, '').slice(0, 4);

  if (!/^\d{4}$/.test(pin)) {
    showToast('PIN musi mieć 4 cyfry.', true);
    return;
  }

  if (pin === DEMO_PIN) {
    startDemoSession();
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
    const adminLogin = String(team?.rola || '').trim().toUpperCase() === 'ADMIN';

    let startData = null;

    if (adminLogin) {
      setLoading(true, 'Pobieranie aktualnych danych administratora…');
      startData = await api.getStartData(team.id, true);
      saveCachedStartData(team.id, startData);
    } else {
      startData = loadCachedStartData(team.id);
    }

    state.team = team;
    state.startData = startData;
    state.visit = null;
    state.pendingStart = null;
    state.operationDraft = null;
    state.vehicleVisitDelta = {};
    state.vehicleStockCache = null;
    vehicleStockRequest = null;
    persist();

    $('pinInput').value = '';
    $('loginBtn').disabled = true;
    renderWarehouse();

    if (!adminLogin) {
      refreshTeamDataInBackground(team.id);
    }
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

  if (isDemoMode()) {
    state.visit = {
      idWizyty: `DEMO-${Date.now()}`,
      start: new Date().toISOString(),
      status: 'AKTYWNA',
      magazyn: {
        id: 'DEMO',
        nazwa: 'MAGAZYN DEMO'
      }
    };
    state.pendingStart = null;
    state.operationDraft = null;
    state.vehicleVisitDelta = {};
    persist();
    renderVisit();
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
    state.vehicleVisitDelta = {};
    persist();

    $('warehouseCodeInput').value = '';
    renderVisit();

    if (!isAdminTeam()) {
      syncVehicleStateInBackground();
    }
  } catch (error) {
    showToast(messageFromError(error), true);
  } finally {
    setLoading(false);
  }
}

async function openCodeScanner(mode) {
  if (isDemoMode()) {
    if (mode === 'part') {
      openDemoPartPicker();
    } else {
      await startVisit('DEMO');
    }
    return;
  }

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
  updateDemoUi();
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
  $('reviewSessionBtn').textContent = locked ? 'Wyślij ponownie' : 'Wróć';

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

function syncQuantityModalViewport() {
  const modal = $('quantityModal');
  if (!modal || !modal.classList.contains('show')) return;

  const viewport = window.visualViewport;
  const visibleHeight = Math.max(240, Math.round(viewport?.height || window.innerHeight));
  const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));

  modal.style.top = `${offsetTop}px`;
  modal.style.bottom = 'auto';
  modal.style.height = `${visibleHeight}px`;

  const card = modal.querySelector('.modal-card');
  if (card) {
    card.style.maxHeight = `${Math.max(220, visibleHeight - 24)}px`;
  }
}

function resetQuantityModalViewport() {
  const modal = $('quantityModal');
  if (!modal) return;

  modal.style.removeProperty('top');
  modal.style.removeProperty('bottom');
  modal.style.removeProperty('height');

  const card = modal.querySelector('.modal-card');
  card?.style.removeProperty('max-height');
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
  syncQuantityModalViewport();

  setTimeout(() => {
    const input = $('quantityInput');
    input?.focus();
    syncQuantityModalViewport();
    input?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, 80);
}

function closeQuantityModal() {
  quantityTarget = null;
  $('quantityInput').value = '';
  $('quantityModal').classList.remove('show');
  $('quantityModal').setAttribute('aria-hidden', 'true');
  resetQuantityModalViewport();
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

  commitDraftToVehicleDelta(state.operationDraft);
  state.operationDraft = null;
  persist();
  closeReview();
  renderVisit();
}

async function sendSession() {
  if (!state.operationDraft || !state.team || !state.visit) return;

  if (isDemoMode()) {
    state.operationDraft = null;
    persist();
    closeReview();
    renderVisit();
    return;
  }

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
    const saveResult = await api.saveSession({
      idSesji: draft.idSesji,
      idWizyty: state.visit.idWizyty,
      dataCzasOperacji: draft.operationTime,
      idEkipy: state.team.id,
      idUrzadzenia: DEVICE_ID,
      idMagazynu: state.visit.magazyn.id,
      komentarz: String(draft.komentarz || '').trim(),
      pobranie: draft.pobranie.map(item => ({ kod: item.kod, ilosc: item.ilosc })),
      zwrot: draft.zwrot.map(item => ({ kod: item.kod, ilosc: item.ilosc }))
    });

    commitDraftToVehicleDelta(draft);
    markVehicleSessionSynced({
      detail: {
        idSesji: draft.idSesji,
        result: saveResult
      }
    });
    state.operationDraft = null;
    persist();
    renderVisit();
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

  if (isDemoMode()) {
    $('finishModal').classList.remove('show');
    $('finishModal').setAttribute('aria-hidden', 'true');
    setLoading(true, 'Kończenie wizyty demo…');

    window.setTimeout(() => {
      resetState();
      setLoading(false);
      showScreen('screenDone');

      window.setTimeout(() => {
        showScreen('screenLogin');
      }, 1800);
    }, 450);
    return;
  }

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
  $('demoPartCloseBtn')?.addEventListener('click', closeDemoPartPicker);
  $('demoPartModal')?.addEventListener('click', event => {
    if (event.target === $('demoPartModal')) closeDemoPartPicker();
  });

  $('manualWarehouseBtn').addEventListener('click', () => startVisit($('warehouseCodeInput').value));
  $('warehouseCodeInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') startVisit(event.target.value);
  });

  $('vehicleStatePreBtn')?.addEventListener('click', openVehicleStock);
  $('vehiclePartsBtn')?.addEventListener('click', openVehicleStock);
  $('vehicleBackBtn')?.addEventListener('click', closeVehicleStock);

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


  window.visualViewport?.addEventListener('resize', syncQuantityModalViewport);
  window.visualViewport?.addEventListener('scroll', syncQuantityModalViewport);

  $('operationComment').addEventListener('input', saveCommentFromUi);
  $('operationBackBtn').addEventListener('click', backToVisit);
  $('operationBackBottomBtn').addEventListener('click', backToVisit);
  $('reviewSessionBtn').addEventListener('click', openReview);
  $('reviewCancelBtn').addEventListener('click', closeReview);
  $('reviewSendBtn').addEventListener('click', sendSession);

  $('finishVisitBtn').addEventListener('click', () => {
    if (isDemoMode()) {
      $('finishModal').classList.add('show');
      $('finishModal').setAttribute('aria-hidden', 'false');
      return;
    }

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

  document.addEventListener('selfstorage:visit-finished', () => {
    resetState();
    $('finishModal')?.classList.remove('show');
    $('finishModal')?.setAttribute('aria-hidden', 'true');
    showScreen('screenDone');

    window.setTimeout(() => {
      showScreen('screenLogin');
    }, 2200);
  });

  document.addEventListener('selfstorage:draft-queued', handleDraftQueued);
  document.addEventListener('selfstorage:vehicle-session-synced', markVehicleSessionSynced);
  window.addEventListener('online', updateNetworkUi);
  window.addEventListener('offline', updateNetworkUi);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });

    registration.update().catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (sessionStorage.getItem('selfstorage_reload_for_update') === '1') return;

      const activeScreen = getActiveScreenId();
      const unsafeToReload =
        Boolean(state.visit?.idWizyty) ||
        activeScreen === 'screenOperation';

      if (unsafeToReload) {
        showToast('Nowa wersja aplikacji jest gotowa. Zostanie użyta przy następnym uruchomieniu.');
        return;
      }

      sessionStorage.setItem('selfstorage_reload_for_update', '1');
      window.location.reload();
    });
  } catch (error) {
    console.warn('Nie udało się zarejestrować Service Workera.', error);
  }
}

function updateAppVersionBadge() {
  let versionEl = $('appVersion');

  if (!versionEl) {
    versionEl = Array
      .from(document.querySelectorAll('body div'))
      .find(el => /^v\d+\.\d+$/i.test(String(el.textContent || '').trim()));
  }

  if (!versionEl) {
    versionEl = document.createElement('div');
    versionEl.style.position = 'fixed';
    versionEl.style.right = '10px';
    versionEl.style.bottom = 'max(6px, env(safe-area-inset-bottom))';
    versionEl.style.zIndex = '20';
    versionEl.style.fontSize = '10px';
    versionEl.style.lineHeight = '1';
    versionEl.style.color = '#78818c';
    versionEl.style.opacity = '.65';
    versionEl.style.pointerEvents = 'none';
    versionEl.style.userSelect = 'none';
    document.body.appendChild(versionEl);
  }

  versionEl.id = 'appVersion';
  versionEl.textContent = `v${APP_VERSION}`;
}

async function init() {
  updateAppVersionBadge();

  sessionStorage.removeItem('selfstorage_reload_for_update');
  restore();
  bindEvents();
  updateDemoUi();
  updateNetworkUi();
  registerServiceWorker();

  if (state.team && state.visit?.idWizyty) {
    renderVisit();
    if (!isAdminTeam()) {
      refreshTeamDataInBackground(state.team.id);
    }
  } else if (state.team) {
    if (isAdminTeam()) {
      if (navigator.onLine) {
        setLoading(true, 'Pobieranie aktualnych danych administratora…');
        try {
          await refreshAdminStartData();
        } catch (error) {
          state.startData = null;
          persist();
          showToast(
            'Nie udało się pobrać aktualnych danych administratora. Spróbuj zalogować się ponownie.',
            true
          );
        } finally {
          setLoading(false);
        }
      } else {
        state.startData = null;
        persist();
        showToast(
          'Konto administratora wymaga połączenia z internetem, aby pokazać aktualne dane.',
          true
        );
      }

      renderWarehouse();
    } else {
      renderWarehouse();
      refreshTeamDataInBackground(state.team.id);
    }
  } else {
    showScreen('screenLogin');
  }

  armSystemBackGuard();
}

document.addEventListener('DOMContentLoaded', init);
