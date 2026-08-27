import { loadState } from './storage.js';
import './install.js';

const ADMIN_WAREHOUSE_FALLBACK = [
  { id: 'BOX01', nazwa: 'TULUZA', kod: 'MAG-TL7A2Q', aktywny: true }
];

function ensureVehiclePartsButton() {
  const grid = document.querySelector('#screenVisit .action-grid');
  if (!grid) return null;

  let button = document.getElementById('vehiclePartsBtn');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'vehiclePartsBtn';
  button.className = 'action-card action-settings hidden';
  button.type = 'button';
  button.disabled = true;

  const kicker = document.createElement('span');
  kicker.className = 'action-kicker';
  kicker.textContent = 'AUTO';

  const title = document.createElement('strong');
  title.textContent = 'Części na aucie';

  const description = document.createElement('small');
  description.textContent = 'Funkcja zostanie dodana później';

  button.append(kicker, title, description);

  const inventoryBtn = document.getElementById('inventoryBtn');
  if (inventoryBtn?.parentElement === grid) {
    grid.insertBefore(button, inventoryBtn);
  } else {
    grid.appendChild(button);
  }

  return button;
}

function normalizeWarehouse(item) {
  if (!item || typeof item !== 'object') return null;

  const nazwa = String(item.nazwa ?? item.Nazwa ?? item.name ?? '').trim();
  const kod = String(item.kod ?? item.KOD ?? item.kodMagazynu ?? item.code ?? '').trim().toUpperCase();
  const id = String(item.id ?? item.ID ?? item.idMagazynu ?? '').trim();
  const rawActive = item.aktywny ?? item.Aktywny ?? item.active ?? true;
  const activeText = String(rawActive).trim().toUpperCase();
  const aktywny = rawActive === true || ['TAK', 'TRUE', '1', 'AKTYWNY'].includes(activeText);

  if (!nazwa || !kod || !aktywny) return null;
  return { id, nazwa, kod, aktywny: true };
}

function getAdminWarehouses(saved) {
  const liveWarehouses = Array.isArray(saved?.startData?.magazyny)
    ? saved.startData.magazyny.map(normalizeWarehouse).filter(Boolean)
    : [];

  const source = liveWarehouses.length > 0 ? liveWarehouses : ADMIN_WAREHOUSE_FALLBACK;
  const unique = new Map();

  for (const warehouse of source) {
    unique.set(warehouse.kod, warehouse);
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

function renderAdminWarehousePicker(saved) {
  const picker = ensureAdminWarehousePicker();
  const list = document.getElementById('adminWarehouseList');
  if (!picker || !list) return;

  const warehouses = getAdminWarehouses(saved);
  list.replaceChildren();

  for (const warehouse of warehouses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary admin-warehouse-btn';
    button.textContent = warehouse.nazwa;
    button.style.minHeight = '58px';
    button.style.margin = '0';
    button.style.background = '#303844';
    button.style.border = '1px solid #4f8ee8';
    button.style.color = '#f4f6f8';
    button.style.fontSize = '17px';
    button.style.fontWeight = '850';
    button.style.letterSpacing = '.3px';
    button.addEventListener('click', () => startWarehouseFromPicker(warehouse.kod));
    list.appendChild(button);
  }

  picker.classList.toggle('hidden', warehouses.length === 0);
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

  const saved = loadState();
  const role = String(saved?.team?.rola || '').trim().toUpperCase();

  if (settingsBtn) {
    settingsBtn.classList.toggle('hidden', role !== 'ADMIN');
  }

  if (vehiclePartsBtn) {
    vehiclePartsBtn.classList.toggle('hidden', role !== 'EKIPA');
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

document.addEventListener('DOMContentLoaded', () => {
  updateRoleControls();
  observeVisitScreen();
  observeWarehouseScreen();
});
