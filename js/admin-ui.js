import { loadState } from './storage.js';

function updateAdminControls() {
  const settingsBtn = document.getElementById('settingsBtn');
  if (!settingsBtn) return;

  const saved = loadState();
  const role = String(saved?.team?.rola || '').trim().toUpperCase();
  settingsBtn.classList.toggle('hidden', role !== 'ADMIN');
}

function observeVisitScreen() {
  const screenVisit = document.getElementById('screenVisit');
  if (!screenVisit) return;

  const observer = new MutationObserver(() => {
    if (screenVisit.classList.contains('active')) {
      updateAdminControls();
    }
  });

  observer.observe(screenVisit, {
    attributes: true,
    attributeFilter: ['class']
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateAdminControls();
  observeVisitScreen();
});
