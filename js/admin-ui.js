import { loadState } from './storage.js';

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
  title.textContent = 'Części w aucie';

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

document.addEventListener('DOMContentLoaded', () => {
  updateRoleControls();
  observeVisitScreen();
});
