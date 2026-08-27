let deferredInstallPrompt = null;

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getInstallButton() {
  return document.getElementById('installAppBtn');
}

function updateInstallButton() {
  const button = getInstallButton();
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
});

document.addEventListener('DOMContentLoaded', () => {
  const button = getInstallButton();
  if (!button) return;

  button.addEventListener('click', installApp);
  updateInstallButton();
});
