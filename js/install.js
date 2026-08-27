let deferredInstallPrompt = null;

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
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
  button.style.background = '#343a42';
  button.style.border = '1px solid var(--line)';
  button.style.color = '#f4f6f8';

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
});

document.addEventListener('DOMContentLoaded', () => {
  ensureInstallButton();
  updateInstallButton();
});
