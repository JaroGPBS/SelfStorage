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

  const title = document.createElement('h2');
  title.className = 'admin-warehouse-title';
  title.textContent = 'Wybierz magazyn';

  const list = document.createElement('div');
  list.id = 'adminWarehouseList';
  list.className = 'admin-warehouse-list';

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
    button.className = 'admin-warehouse-btn';
    button.textContent = warehouse.nazwa;
    button.addEventListener('click', () => startWarehouseFromPicker(warehouse.kod));
    list.appendChild(button);
  }

  picker.classList.toggle('hidden', warehouses.length === 0);
}

function updateWarehouseControls(saved, role) {
  const screenWarehouse = document.getElementById('screenWarehouse');
  const scannerButton = document.getElementById('openWarehouseScannerBtn');
  const picker = ensureAdminWarehousePicker();
  if (!screenWarehouse || !scannerButton || !picker) return;

  const isAdmin = role === 'ADMIN';
  screenWarehouse.classList.toggle('admin-warehouse-mode', isAdmin);
  picker.classList.toggle('hidden', !isAdmin);

  scannerButton.textContent = isAdmin ? 'Skanuj kod magazynu' : 'Otwórz skaner';

  if (isAdmin) {
    renderAdminWarehousePicker(saved);
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
