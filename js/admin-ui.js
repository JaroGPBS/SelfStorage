import { loadState } from './storage.js';
import './install.js';

function normalizeRoleLabel(value) {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'KIEROWNIK') return 'KOORDYNATOR';
  return role;
}

function ensureVehiclePartsButton() {
  const grid = document.querySelector('#screenVisit .action-grid');
  if (!grid) return null;

  let button = document.getElementById('vehiclePartsBtn');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'vehiclePartsBtn';
  button.className = 'btn btn-secondary vehicle-visit-btn hidden';
  button.type = 'button';

  const kicker = document.createElement('span');
  kicker.className = 'hidden';
  kicker.textContent = 'AUTO';

  const title = document.createElement('span');
  title.textContent = 'Stan auta';

  button.append(kicker, title);

  grid.insertAdjacentElement('afterend', button);

  return button;
}

function normalizeWarehouse(item) {
  if (!item || typeof item !== 'object') return null;

  const nazwa = String(item.nazwa ?? item.Nazwa ?? item.name ?? '').trim();
  const kod = String(
    item.kod ??
    item.kodQr ??
    item.KOD ??
    item.kodMagazynu ??
    item.code ??
    ''
  ).trim().toUpperCase();
  const id = String(item.id ?? item.ID ?? item.idMagazynu ?? '').trim();
  const rawActive = item.aktywny ?? item.Aktywny ?? item.active ?? true;
  const activeText = String(rawActive).trim().toUpperCase();
  const aktywny = rawActive === true || ['TAK', 'TRUE', '1', 'AKTYWNY'].includes(activeText);

  if (!nazwa || !id || !aktywny) return null;
  return { id, nazwa, kod, aktywny: true };
}

function getAdminWarehouses(saved) {
  const liveWarehouses = Array.isArray(saved?.startData?.magazyny)
    ? saved.startData.magazyny.map(normalizeWarehouse).filter(Boolean)
    : [];

  const unique = new Map();

  for (const warehouse of liveWarehouses) {
    unique.set(warehouse.id || warehouse.kod || warehouse.nazwa, warehouse);
  }

  return Array.from(unique.values()).sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
}

function ensureAdminWarehousePicker() {
  const scanArea = document.querySelector('#screenWarehouse .warehouse-scan-area');
  if (!scanArea) return null;

  let picker = document.getElementById('adminWarehousePicker');
  if (picker) return picker;

  picker = document.createElement('div');
  picker.id = 'adminWarehousePicker';
  picker.className = 'admin-warehouse-picker hidden';
  picker.style.width = '100%';
  picker.style.maxWidth = '520px';
  picker.style.margin = '0 auto';

  const title = document.createElement('h2');
  title.className = 'admin-warehouse-title';
  title.textContent = 'Wybierz magazyn';
  title.style.margin = '0 0 20px';
  title.style.fontSize = '26px';
  title.style.lineHeight = '1.15';

  const list = document.createElement('div');
  list.id = 'adminWarehouseList';
  list.className = 'admin-warehouse-list';
  list.style.display = 'grid';
  list.style.gap = '9px';
  list.style.maxHeight = 'min(42dvh, 340px)';
  list.style.overflowY = 'auto';
  list.style.padding = '1px 2px';
  list.style.overscrollBehavior = 'contain';

  picker.append(title, list);
  scanArea.prepend(picker);

  return picker;
}

function startWarehouseFromPicker(code) {
  const input = document.getElementById('warehouseCodeInput');
  const confirmButton = document.getElementById('manualWarehouseBtn');
  if (!input || !confirmButton || !code) return;

  input.value = code;
  confirmButton.click();
}

const BELLEVILLE_SESSION_STORAGE_KEY = 'gpbs-belleville-transport-session-v1';
let bellevilleSession = null;
let bellevilleView = 'menu';
let bellevilleTargetOperation = null;

function getBellevilleSession() {
  const team = loadState()?.team;
  if (normalizeRoleLabel(team?.rola) !== 'ADMIN' || !team?.id) return null;
  const teamId = String(team.id);
  if (bellevilleSession?.teamId === teamId) return bellevilleSession;

  bellevilleSession = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(BELLEVILLE_SESSION_STORAGE_KEY) || 'null');
    if (saved?.teamId === teamId && saved.route && saved.plate) {
      bellevilleSession = saved;
    }
  } catch (error) {
    console.warn('Nie udało się odczytać sesji Belleville.', error);
  }
  return bellevilleSession;
}

function saveBellevilleSession(session) {
  bellevilleSession = session;
  try {
    sessionStorage.setItem(BELLEVILLE_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Nie udało się zapamiętać sesji Belleville w przeglądarce.', error);
  }
}

function clearBellevilleSession() {
  bellevilleSession = null;
  try {
    sessionStorage.removeItem(BELLEVILLE_SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn('Nie udało się usunąć sesji Belleville z przeglądarki.', error);
  }
}

function renderBellevilleSessionInfo() {
  const session = getBellevilleSession();
  document.getElementById('bellevilleSessionCard')?.classList.toggle('hidden', !session);
  document.getElementById('bellevilleEndSessionBtn')?.classList.toggle('hidden', !session);
  if (!session) return;

  for (const id of ['bellevilleSessionRoute', 'bellevilleOperationRoute']) {
    const target = document.getElementById(id);
    if (target) target.textContent = 'Trasa: ' + session.route;
  }
  const details = [session.plate, session.trailer ? 'Naczepa: ' + session.trailer : '', session.carrier].filter(Boolean).join(' • ');
  for (const id of ['bellevilleSessionPlate', 'bellevilleOperationPlate']) {
    const target = document.getElementById(id);
    if (target) target.textContent = details;
  }
}

function showBellevilleView(view) {
  bellevilleView = view;
  const sections = {
    menu: 'bellevilleMenuView',
    form: 'bellevilleTransportForm',
    operation: 'bellevilleOperationView'
  };
  for (const [name, id] of Object.entries(sections)) {
    document.getElementById(id)?.classList.toggle('hidden', name !== view);
  }
  if (view === 'menu') renderBellevilleSessionInfo();
  window.scrollTo(0, 0);
}

function backBellevilleView() {
  if (bellevilleView === 'menu') return false;
  bellevilleTargetOperation = null;
  showBellevilleView('menu');
  return true;
}

function enterBellevilleOperation(operation) {
  const session = getBellevilleSession();
  if (!session) return;
  const title = document.getElementById('bellevilleOperationTitle');
  if (title) title.textContent = operation === 'PZ' ? 'Przyjęcia' : 'Wydania';
  renderBellevilleSessionInfo();
  bellevilleTargetOperation = null;
  showBellevilleView('operation');
}

function chooseBellevilleOperation(operation) {
  if (normalizeRoleLabel(loadState()?.team?.rola) !== 'ADMIN') return;
  const info = document.getElementById('bellevilleInfo');
  info?.classList.add('hidden');
  if (operation === 'EKIPY') {
    if (!info) return;
    info.textContent = 'Funkcję „Zaopatrzenie ekip” dodamy w kolejnym kroku.';
    info.classList.remove('hidden');
    return;
  }
  if (operation !== 'PZ' && operation !== 'WZ') return;

  bellevilleTargetOperation = operation;
  if (getBellevilleSession()) {
    enterBellevilleOperation(operation);
    return;
  }
  document.getElementById('bellevilleTransportForm')?.reset();
  showBellevilleView('form');
}

function startBellevilleSession(event) {
  event.preventDefault();
  if (normalizeRoleLabel(loadState()?.team?.rola) !== 'ADMIN') return;
  if (bellevilleTargetOperation !== 'PZ' && bellevilleTargetOperation !== 'WZ') return;
  const routeInput = document.getElementById('bellevilleRouteInput');
  const plateInput = document.getElementById('bellevillePlateInput');
  const carrierInput = document.getElementById('bellevilleCarrierInput');
  const trailerInput = document.getElementById('bellevilleTrailerInput');
  if (!routeInput || !plateInput || !carrierInput || !trailerInput) return;

  const route = routeInput.value.trim().toUpperCase();
  const plate = plateInput.value.trim().toUpperCase();
  if (!route) {
    routeInput.value = '';
    routeInput.reportValidity();
    return;
  }
  if (!plate) {
    plateInput.value = '';
    plateInput.reportValidity();
    return;
  }
  const teamId = String(loadState()?.team?.id || '');
  if (!teamId) return;

  const operation = bellevilleTargetOperation;
  saveBellevilleSession({
    teamId,
    route,
    plate,
    carrier: carrierInput.value.trim().toUpperCase(),
    trailer: trailerInput.value.trim().toUpperCase(),
    startedAt: new Date().toISOString()
  });
  enterBellevilleOperation(operation);
}

function finishBellevilleSession() {
  if (!getBellevilleSession()) return;
  if (!window.confirm('Zakończyć sesję samochodu? Dane formularza zostaną wyczyszczone.')) return;
  clearBellevilleSession();
  bellevilleTargetOperation = null;
  showBellevilleView('menu');
}

function openBellevilleScreen() {
  const saved = loadState();
  if (normalizeRoleLabel(saved?.team?.rola) !== 'ADMIN') return;

  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === 'screenBelleville');
  });
  showBellevilleView('menu');
}

function closeBellevilleScreen() {
  if (backBellevilleView()) return;
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === 'screenWarehouse');
  });
  window.scrollTo(0, 0);
  updateRoleControls();
}

function renderAdminWarehousePicker(saved) {
  const picker = ensureAdminWarehousePicker();
  const list = document.getElementById('adminWarehouseList');
  if (!picker || !list) return;

  const warehouses = getAdminWarehouses(saved);
  list.replaceChildren();

  const bellevilleBtn = document.createElement('button');
  bellevilleBtn.type = 'button';
  bellevilleBtn.className = 'btn gpbs-menu-btn admin-warehouse-btn';
  bellevilleBtn.textContent = 'Belleville';
  bellevilleBtn.addEventListener('click', openBellevilleScreen);
  list.appendChild(bellevilleBtn);

  const tychyBtn = document.createElement('button');
  tychyBtn.type = 'button';
  tychyBtn.className = 'btn gpbs-menu-btn admin-warehouse-btn';
  tychyBtn.textContent = 'Tychy';
  tychyBtn.addEventListener('click', openTychyScreen);
  list.appendChild(tychyBtn);

  for (const warehouse of warehouses) {
    if (warehouse.nazwa.trim().toUpperCase() === 'BELLEVILLE' && !warehouse.kod) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn gpbs-menu-btn admin-warehouse-btn';
    const hasCode = Boolean(String(warehouse.kod || '').trim());
    button.textContent = hasCode
      ? warehouse.nazwa
      : `${warehouse.nazwa} — brak kodu`;
    button.disabled = !hasCode;

    if (hasCode) {
      button.addEventListener('click', () => startWarehouseFromPicker(warehouse.kod));
    } else {
      button.title = 'Magazyn jest aktywny, ale nie ma jeszcze przypisanego kodu.';
    }

    list.appendChild(button);
  }

  picker.classList.remove('hidden');
}

function updateWarehouseControls(saved, role) {
  const screenWarehouse = document.getElementById('screenWarehouse');
  const scanArea = document.querySelector('#screenWarehouse .warehouse-scan-area');
  const scanTitle = document.querySelector('#screenWarehouse .warehouse-scan-title');
  const scannerButton = document.getElementById('openWarehouseScannerBtn');
  const manualDetails = document.querySelector('#screenWarehouse .warehouse-manual-details');
  const picker = ensureAdminWarehousePicker();
  if (!screenWarehouse || !scanArea || !scanTitle || !scannerButton || !manualDetails || !picker) return;

  const isAdmin = role === 'ADMIN';
  screenWarehouse.classList.toggle('admin-warehouse-mode', isAdmin);
  picker.classList.toggle('hidden', !isAdmin);
  scanTitle.style.display = isAdmin ? 'none' : '';
  manualDetails.style.display = isAdmin ? 'none' : '';
  scanArea.style.marginTop = isAdmin ? '34px' : '';

  scannerButton.textContent = isAdmin ? 'Skanuj kod magazynu' : 'Otwórz skaner';

  if (isAdmin) {
    scannerButton.style.minHeight = '44px';
    scannerButton.style.marginTop = '22px';
    scannerButton.style.background = '#343b44';
    scannerButton.style.border = '1px solid var(--line)';
    scannerButton.style.color = '#dce2e8';
    scannerButton.style.fontSize = '14px';
    renderAdminWarehousePicker(saved);
  } else {
    scannerButton.style.minHeight = '';
    scannerButton.style.marginTop = '';
    scannerButton.style.background = '';
    scannerButton.style.border = '';
    scannerButton.style.color = '';
    scannerButton.style.fontSize = '';
  }
}

function updateRoleControls() {
  const settingsBtn = document.getElementById('settingsBtn');
  const vehiclePartsBtn = ensureVehiclePartsButton();
  const vehicleStatePreBtn = document.getElementById('vehicleStatePreBtn');
  const inventoryBtn = document.getElementById('inventoryBtn');
  const roleLabel = document.getElementById('teamRole');

  const saved = loadState();
  const rawRole = String(saved?.team?.rola || '').trim().toUpperCase();
  const role = normalizeRoleLabel(rawRole);
  const canInventory = role === 'KOORDYNATOR' || role === 'ADMIN';

  if (roleLabel && role) {
    roleLabel.textContent = role;
  }

  if (settingsBtn) {
    settingsBtn.classList.toggle('hidden', role !== 'ADMIN');
  }

  if (inventoryBtn) {
    inventoryBtn.classList.toggle('hidden', !canInventory);
    const description = inventoryBtn.querySelector('small');
    if (description) {
      description.textContent = 'Dla koordynatora i administratora';
    }
  }

  if (vehiclePartsBtn) {
    vehiclePartsBtn.classList.toggle('hidden', role !== 'EKIPA');
  }

  if (vehicleStatePreBtn) {
    vehicleStatePreBtn.classList.toggle('hidden', role !== 'EKIPA');
  }

  updateWarehouseControls(saved, role);
}

function observeVisitScreen() {
  const screenVisit = document.getElementById('screenVisit');
  if (!screenVisit) return;

  const observer = new MutationObserver(() => {
    if (screenVisit.classList.contains('active')) {
      updateRoleControls();
    }
  });

  observer.observe(screenVisit, {
    attributes: true,
    attributeFilter: ['class']
  });
}

function observeWarehouseScreen() {
  const screenWarehouse = document.getElementById('screenWarehouse');
  if (!screenWarehouse) return;

  const observer = new MutationObserver(() => {
    if (screenWarehouse.classList.contains('active')) {
      updateRoleControls();
      setTimeout(updateRoleControls, 1200);
    }
  });

  observer.observe(screenWarehouse, {
    attributes: true,
    attributeFilter: ['class']
  });
}


let tychyParts = [];
let tychyLoading = false;

function openTychyScreen() {
  if (normalizeRoleLabel(loadState()?.team?.rola) !== 'ADMIN') return;
  tychyParts = [];
  document.getElementById('tychyAuthForm')?.reset();
  document.getElementById('tychyAuthForm')?.classList.remove('hidden');
  document.getElementById('tychyCatalogView')?.classList.add('hidden');
  const status = document.getElementById('tychyPartsStatus');
  if (status) status.textContent = 'Podaj PIN, aby wczytać katalog.';
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === 'screenTychy');
  });
}

function closeTychyScreen() {
  document.getElementById('tychyPinInput')?.setAttribute('value', '');
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === 'screenWarehouse');
  });
  updateRoleControls();
}

function renderTychyParts() {
  const list = document.getElementById('tychyPartList');
  const status = document.getElementById('tychyPartsStatus');
  if (!list || !status) return;
  const query = String(document.getElementById('tychyPartSearch')?.value || '').trim().toLocaleLowerCase('pl');
  const matching = tychyParts.filter(part => {
    const terms = [part.name, part.part_number, part.sap_number];
    return terms.some(term => String(term || '').toLocaleLowerCase('pl').includes(query));
  });
  const fragment = document.createDocumentFragment();
  for (const part of matching) {
    const card = document.createElement('div');
    card.className = 'tychy-part-card';
    const name = document.createElement('strong');
    name.textContent = String(part.name || 'Brak nazwy');
    const index = document.createElement('span');
    index.textContent = 'Indeks: ' + String(part.part_number || '—');
    const sap = document.createElement('small');
    sap.textContent = 'SAP: ' + String(part.sap_number || '—');
    card.append(name, index, sap);
    fragment.appendChild(card);
  }
  list.replaceChildren(fragment);
  status.textContent = 'Wyświetlono ' + matching.length + ' z ' + tychyParts.length + ' części.';
}

async function loadTychyParts(event) {
  event.preventDefault();
  if (tychyLoading || normalizeRoleLabel(loadState()?.team?.rola) !== 'ADMIN') return;
  const input = document.getElementById('tychyPinInput');
  const button = document.getElementById('tychyLoadPartsBtn');
  const status = document.getElementById('tychyPartsStatus');
  const pin = String(input?.value || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    if (status) status.textContent = 'Wprowadź czterocyfrowy PIN.';
    return;
  }
  tychyLoading = true;
  if (button) button.disabled = true;
  if (status) status.textContent = 'Pobieranie katalogu z D1…';
  try {
    const response = await fetch('/api/pl/parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok || !data?.ok || !Array.isArray(data.parts)) {
      throw new Error(data?.error || 'Nie udało się wczytać katalogu.');
    }
    tychyParts = data.parts.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'pl'));
    document.getElementById('tychyPartSearch').value = '';
    document.getElementById('tychyAuthForm')?.classList.add('hidden');
    document.getElementById('tychyCatalogView')?.classList.remove('hidden');
    renderTychyParts();
  } catch (error) {
    if (status) status.textContent = error?.message || 'Błąd połączenia z bazą D1.';
  } finally {
    if (input) input.value = '';
    tychyLoading = false;
    if (button) button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tychyBackBtn')?.addEventListener('click', closeTychyScreen);
  document.getElementById('tychyAuthForm')?.addEventListener('submit', loadTychyParts);
  document.getElementById('tychyPartSearch')?.addEventListener('input', renderTychyParts);
  window.gpbsTychyBack = closeTychyScreen;
  document.getElementById('bellevilleBackBtn')?.addEventListener('click', closeBellevilleScreen);
  document.querySelectorAll('#screenBelleville .belleville-option').forEach(button => {
    button.addEventListener('click', () => chooseBellevilleOperation(button.dataset.bellevilleOperation));
  });
  document.querySelectorAll('#bellevilleTransportForm .text-input').forEach(input => {
    input.addEventListener('input', () => {
      const uppercase = input.value.toUpperCase();
      if (input.value === uppercase) return;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = uppercase;
      if (start !== null && end !== null) input.setSelectionRange(start, end);
    });
  });
  document.getElementById('bellevilleTransportForm')?.addEventListener('submit', startBellevilleSession);
  document.getElementById('bellevilleCancelFormBtn')?.addEventListener('click', backBellevilleView);
  document.getElementById('bellevilleOperationBackBtn')?.addEventListener('click', backBellevilleView);
  document.getElementById('bellevilleEndSessionBtn')?.addEventListener('click', finishBellevilleSession);
  window.gpbsBellevilleBack = backBellevilleView;
  updateRoleControls();
  observeVisitScreen();
  observeWarehouseScreen();
});
