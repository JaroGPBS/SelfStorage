const STATE_KEY = 'selfstorage_state_v1';
const AUTH_MESSAGE_KEY = 'selfstorage_auth_message_v1';
const INVALID_AUTH_MESSAGE = 'Nieprawidłowe dane. Skontaktuj się z administratorem.';

function setDisplayedVersion() {
  for (const element of document.querySelectorAll('body > div')) {
    if (/^v0\.\d+$/.test(element.textContent?.trim() || '')) {
      element.textContent = 'v0.15';
      element.style.fontSize = '13px';
      element.style.fontWeight = '600';
      element.style.opacity = '.85';
      break;
    }
  }
}

function showStoredAuthMessage() {
  const message = sessionStorage.getItem(AUTH_MESSAGE_KEY);
  if (!message) return;

  sessionStorage.removeItem(AUTH_MESSAGE_KEY);

  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('error', 'show');
  window.setTimeout(() => toast.classList.remove('show'), 5000);
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
