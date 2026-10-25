// GPBS Storage — isolated Polish warehouse worker login.
// Nothing about the worker PIN is retained in browser storage.
// Never intercept or call the French Apps Script login.
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const loginScreen = byId('loginScreen');
  const sessionScreen = byId('sessionScreen');
  const loadingScreen = byId('loadingScreen');
  const pinInput = byId('workerPin');
  let busy = false;

  function view(which) {
    loadingScreen.hidden = which !== 'loading';
    loginScreen.hidden = which !== 'login';
    sessionScreen.hidden = which !== 'session';
  }

  function errorText(target, content) {
    target.textContent = content || '';
    target.hidden = !content;
  }

  function setWorking(working, button) {
    busy = working;
    button.disabled = working;
    if (working) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  async function request(method, body) {
    const response = await fetch('/api/pl/auth', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'POST' ? {'Content-Type':'application/json'} : {},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    let data = null;
    try {data = await response.json();} catch {}
    if (!response.ok || !data?.ok) {
      const message = data?.error || (response.status === 429
        ? 'Zbyt wiele prób logowania. Spróbuj później.'
        : 'Nie udało się połączyć z serwerem.');
      const failure = new Error(message);
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function renderSession(user) {
    const nickname = typeof user?.nickname === 'string' ? user.nickname.trim() : '';
    const warehouses = Array.isArray(user?.warehouses) ? user.warehouses : [];
    if (!nickname || !user?.id || warehouses.length === 0) {
      throw new Error('Konto nie ma dostępu do aktywnego magazynu w Polsce.');
    }
    byId('sessionTitle').textContent = nickname;
    byId('workerBadge').textContent = nickname
      .replace(/[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '')
      .slice(0, 3).toLocaleUpperCase('pl') || 'PL';

    const list = byId('warehouseList');
    list.replaceChildren();
    for (const wh of warehouses) {
      if (typeof wh?.id !== 'string' || typeof wh?.name !== 'string') continue;
      const item = document.createElement('div');
      item.className = 'warehouse-item';
      const icon = document.createElement('span');
      icon.className = 'warehouse-symbol';
      icon.textContent = '▣';
      icon.setAttribute('aria-hidden', 'true');
      const body = document.createElement('span');
      body.className = 'warehouse-details';
      const title = document.createElement('strong');
      title.textContent = wh.name;
      const subtitle = document.createElement('small');
      subtitle.textContent = wh.id;
      body.append(title,subtitle);
      item.append(icon,body);
      list.append(item);
    }
    errorText(byId('sessionError'), '');
    view('session');
  }

  async function refreshSession() {
    try {
      const result = await request('GET');
      renderSession(result.user);
    } catch (error) {
      pinInput.value = '';
      view('login');
      // A missing session is normal. Explain other failures instead.
      if (error.status && error.status !== 401) {
        errorText(byId('loginError'), error.message);
      } else if (!error.status) {
        errorText(byId('loginError'), 'Brak połączenia. Zalogowanie wymaga internetu.');
      }
    }
  }

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    errorText(byId('loginError'), '');
    // Use only the PIN, never optional name, phone or nick.
    const pin = pinInput.value.trim();
    if (!/^\d{4}$/.test(pin)) {
      errorText(byId('loginError'), 'Wpisz czterocyfrowy PIN.');
      return;
    }

    setWorking(true, byId('loginButton'));
    byId('loginButton').firstChild.textContent = 'Logowanie… ';
    // Remove the PIN immediately after taking a transient local copy.
    pinInput.value = '';
    try {
      const result = await request('POST', {action:'login', pin});
      renderSession(result.user);
    } catch (error) {
      errorText(byId('loginError'), error.message);
    } finally {
      setWorking(false, byId('loginButton'));
      byId('loginButton').firstChild.textContent = 'Zaloguj ';
    }
  }

  async function logout() {
    if (busy) return;
    setWorking(true, byId('logoutButton'));
    errorText(byId('sessionError'), '');
    try {
      await request('POST', {action:'logout'});
      pinInput.value = '';
      byId('sessionTitle').textContent = '—';
      byId('workerBadge').textContent = '—';
      byId('warehouseList').replaceChildren();
      errorText(byId('loginError'), '');
      view('login');
    } catch (error) {
      errorText(byId('sessionError'), 'Nie udało się wylogować: '+error.message);
    } finally {
      setWorking(false, byId('logoutButton'));
    }
  }

  byId('loginForm').addEventListener('submit',login);
  byId('logoutButton').addEventListener('click',logout);
  pinInput.addEventListener('input', () => {
    const clean = pinInput.value.replace(/\D/g, '').slice(0, 4);
    if (clean !== pinInput.value) pinInput.value = clean;
    if (!byId('loginError').hidden) errorText(byId('loginError'), '');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) refreshSession();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !sessionScreen.hidden && !busy) {
      refreshSession();
    }
  });

  refreshSession();
})();
