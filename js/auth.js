const STATE_KEY = 'selfstorage_state_v1';
const AUTH_MESSAGE_KEY = 'selfstorage_auth_message_v1';
const INVALID_AUTH_MESSAGE = 'Nieprawidłowe dane. Skontaktuj się z administratorem.';

function setDisplayedVersion() {
  for (const element of document.querySelectorAll('body > div')) {
    if (/^v0\.\d+$/.test(element.textContent?.trim() || '')) {
      element.textContent = 'v0.16';
      element.style.fontSize = '13px';
      element.style.fontWeight = '600';
      element.style.opacity = '.85';
      break;
    }
  }
}

function showCenteredAuthMessage(message) {
  const existing = document.getElementById('authMessageModal');
  existing?.remove();

  const modal = document.createElement('div');
  modal.id = 'authMessageModal';
  modal.className = 'modal show';
  modal.style.alignItems = 'center';
  modal.setAttribute('aria-hidden', 'false');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'modal-card compact';
  card.style.textAlign = 'center';

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.margin = '0';

  card.appendChild(title);
  modal.appendChild(card);
  document.body.appendChild(modal);

  window.setTimeout(() => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => modal.remove(), 250);
  }, 5000);
}

function showStoredAuthMessage() {
  const message = sessionStorage.getItem(AUTH_MESSAGE_KEY);
  if (!message) return;

  sessionStorage.removeItem(AUTH_MESSAGE_KEY);
  showCenteredAuthMessage(message);
}

function forceLogout(message) {
  localStorage.removeItem(STATE_KEY);
  sessionStorage.setItem(
    AUTH_MESSAGE_KEY,
    message || INVALID_AUTH_MESSAGE
  );
  window.location.reload();
}

function handleAuthMessage(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'AUTH_REJECTED') {
    forceLogout(INVALID_AUTH_MESSAGE);
    return;
  }

  if (data.type === 'AUTH_UNAVAILABLE') {
    forceLogout(data.message || 'Nie udało się sprawdzić uprawnień. Sprawdź internet i zaloguj się ponownie.');
    return;
  }

  if (data.type === 'AUTH_REFRESH_REQUIRED') {
    forceLogout(INVALID_AUTH_MESSAGE);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', handleAuthMessage);
}

document.addEventListener('DOMContentLoaded', () => {
  setDisplayedVersion();
  window.setTimeout(showStoredAuthMessage, 120);
});
