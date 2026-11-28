let deferredInstallPrompt = null;

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Keep the app in portrait by default. Only an active OCR camera may rotate.
let ocrOrientationActive = false;
let orientationRequest = 0;
async function syncAppOrientation() {
  const request = ++orientationRequest;
  if (!screen.orientation?.lock) return;
  try {
    await screen.orientation.lock(ocrOrientationActive ? 'any' : 'portrait-primary');
  } catch (error) {
    if(request!==orientationRequest)return;
    // Some browsers do not support orientation locking in a normal tab.
    // The device's auto-rotate setting then controls the viewport.
    if(ocrOrientationActive)console.warn('Zmiana orientacji OCR niedostępna.',error);
  }
}
export function setOcrOrientation(active) {
  const next=Boolean(active);
  if(next===ocrOrientationActive)return;
  ocrOrientationActive=next;
  void syncAppOrientation();
}

function ensureInstallButton() {
  let button = document.getElementById('installAppBtn');
  if (button) return button;

  const loginButton = document.getElementById('loginBtn');
  if (!loginButton?.parentElement) return null;

  button = document.createElement('button');
  button.id = 'installAppBtn';
  button.type = 'button';
  button.className = 'btn btn-secondary hidden';
  button.textContent = 'Zainstaluj aplikację';
  button.setAttribute('aria-hidden', 'true');
  button.style.marginTop = '12px';
  button.style.background = 'linear-gradient(135deg, #6654d9, #8468f5)';
  button.style.border = '1px solid #9b8aff';
  button.style.color = '#ffffff';
  button.style.fontWeight = '800';
  button.style.boxShadow = '0 5px 16px rgba(124, 92, 255, .24)';

  loginButton.insertAdjacentElement('afterend', button);
  button.addEventListener('click', installApp);

  return button;
}

function updateInstallButton() {
  const button = ensureInstallButton();
  if (!button) return;

  const canInstall = Boolean(deferredInstallPrompt) && !isStandaloneMode();
  button.classList.toggle('hidden', !canInstall);
  button.setAttribute('aria-hidden', canInstall ? 'false' : 'true');
}

async function installApp() {
  if (!deferredInstallPrompt) return;

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallButton();

  try {
    await promptEvent.prompt();
    await promptEvent.userChoice;
  } catch (error) {
    console.warn('Nie udało się uruchomić instalacji PWA.', error);
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  syncAppOrientation();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncAppOrientation();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  ensureInstallButton();
  updateInstallButton();
  syncAppOrientation();
});
