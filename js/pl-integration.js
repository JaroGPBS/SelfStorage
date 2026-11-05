// Shared GPBS Storage entry point: keep the French flow unchanged and load
// the Polish warehouse UI only after a verified D1 worker login.
// The same tested PL components are reused without navigating to /pl/.
const MARKET_KEY = 'gpbs_storage_market_v1';
const ROOT_SHELL_SELECTOR = '.app-shell';
const WORKSPACE_ID = 'gpbsPolandWorkspace';
const POLISH_SCRIPTS = [
  '/pl/inventory-scanner.js?v=2',
  '/pl/inventory-flow.js?v=6',
  '/pl/warehouse-operations.js?v=14',
  '/pl/pl.js?v=23'
];

let workspacePromise = null;

function setMarket(value) {
  try {
    if (value) localStorage.setItem(MARKET_KEY, value);
    else localStorage.removeItem(MARKET_KEY);
  } catch {
    // Some private browsers disable storage. Current login still works.
  }
}

export function hasPolishSessionMarker() {
  try { return localStorage.getItem(MARKET_KEY) === 'PL'; }
  catch { return false; }
}

export function isPolishWorkspaceActive() {
  return document.body.classList.contains('gpbs-market-pl');
}

async function workerRequest(method, pin) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch('/api/pl/auth', {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(method === 'POST' ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', pin })
      } : {}),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Polskie logowanie: przekroczono czas oczekiwania na D1.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function insertScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Nie udało się załadować modułu magazynowego.'));
    document.head.append(script);
  });
}

async function buildPolishWorkspace() {
  const workspace = document.getElementById(WORKSPACE_ID);
  if (!workspace) throw new Error('Brak kontenera polskiej części aplikacji.');

  // Load the internal PL workspace template into the single main application.
  const response = await fetch('/pl/workspace.txt?v=1', {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Nie można wczytać ekranów polskiego magazynu.');
  const markup = await response.text();
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  if (!parsed.getElementById('sessionScreen') ||
      !parsed.getElementById('operationScreen') ||
      !parsed.getElementById('inventoryScreen')) {
    throw new Error('Niekompletny moduł magazynowy.');
  }

  // Its IDs are distinct from the existing French application IDs.
  workspace.replaceChildren(...Array.from(parsed.body.children).map(node =>
    document.importNode(node, true)));

  const link = document.createElement('link');
  link.id = 'gpbsPolandStyles';
  link.rel = 'stylesheet';
  link.href = '/pl/pl.css?v=43';
  document.head.append(link);

  // Existing Polish modules bind their handlers to the newly inserted DOM.
  // They must be loaded in this exact order, and only once per page load.
  window.GPBS_POLISH_EMBEDDED = true;
  for (const source of POLISH_SCRIPTS) await insertScript(source);
}

async function activatePolishWorkspace() {
  if (!workspacePromise) {
    workspacePromise = buildPolishWorkspace().catch(error => {
      workspacePromise = null;
      throw error;
    });
  }
  await workspacePromise;
  document.querySelector(ROOT_SHELL_SELECTOR)?.setAttribute('aria-hidden', 'true');
  document.body.classList.add('gpbs-market-pl');
  const workspace = document.getElementById(WORKSPACE_ID);
  workspace.hidden = false;
}

export async function tryPolishLogin(pin) {
  const { response, body } = await workerRequest('POST', pin);
  if (response.status === 401) return false; // Not a Polish D1 user.
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || 'Logowanie do polskiego magazynu nie powiodło się.');
  }

  await activatePolishWorkspace();
  setMarket('PL');
  return true;
}

export async function resumePolishSession() {
  if (!hasPolishSessionMarker()) return false;
  let result;
  try { result = await workerRequest('GET'); }
  catch { return false; } // Normal login remains available if D1 is unreachable.

  if (result.response.status === 401) {
    setMarket(null);
    return false;
  }
  if (!result.response.ok || !result.body?.ok) return false;
  await activatePolishWorkspace();
  return true;
}

export function handlePolishSystemBack() {
  if (!isPolishWorkspaceActive()) return null;
  const workspace = document.getElementById(WORKSPACE_ID);
  const dialog = workspace?.querySelector('dialog[open]');
  if (dialog) { dialog.close(); return false; }

  const screens = [
    ['operationScreen', 'backFromOperationButton'],
    ['inventoryScreen', 'backFromInventoryButton'],
    ['stockScreen', 'backFromStockButton']
  ];
  for (const [screen, back] of screens) {
    const element = workspace?.querySelector('#' + screen);
    if (element && !element.hidden) {
      workspace.querySelector('#' + back)?.click();
      return false;
    }
  }
  return true;
}

window.addEventListener('gpbs:polish-logout', () => {
  setMarket(null);
  // The D1 HttpOnly session was already cleared by the PL logout action.
  // Reloading removes PL-only styles and restores the common login screen.
  window.location.reload();
});
