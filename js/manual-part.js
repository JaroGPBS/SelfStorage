const STATE_KEY = 'selfstorage_state_v1';

let manualQuantityPending = false;

function $(id) {
  return document.getElementById(id);
}

function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Nie udało się odczytać danych części.', error);
    return null;
  }
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isExactPartCode(value) {
  const code = normalizeCode(value);
  if (!code) return false;

  const state = readState();
  const parts = Array.isArray(state?.startData?.czesci) ? state.startData.czesci : [];

  return parts.some(part => normalizeCode(part?.kod) === code);
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('error', 'show');

  window.setTimeout(() => {
    toast.classList.remove('show');
  }, 3400);
}

function blockManualSubmit(event, message) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  manualQuantityPending = false;
  showToast(message);
}

function guardManualPartInput(event) {
  const isButton = event.type === 'click' && event.target.closest?.('#manualPartBtn');
  const isEnter = event.type === 'keydown' && event.target?.id === 'partSearchInput' && event.key === 'Enter';
  if (!isButton && !isEnter) return;

  const input = $('partSearchInput');
  const value = input?.value || '';

  if (!normalizeCode(value)) {
    blockManualSubmit(event, 'Wpisz kod części.');
    return;
  }

  if (!isExactPartCode(value)) {
    blockManualSubmit(event, 'Nieznany kod części. Wpisz dokładny kod z części.');
    return;
  }

  manualQuantityPending = true;
}

function closeManualPartPanelAfterSuccess() {
  if (!manualQuantityPending) return;

  const modal = $('quantityModal');
  if (modal?.classList.contains('show')) return;

  document.querySelector('#screenOperation .part-manual-details')?.removeAttribute('open');
  $('partSearchInput')?.blur();
  manualQuantityPending = false;
}

function handleQuantityClick(event) {
  if (event.target.closest?.('#quantityCancelBtn')) {
    manualQuantityPending = false;
    return;
  }

  const addButton = event.target.closest?.('#quantityAddBtn');
  if (!addButton || !manualQuantityPending) return;

  window.setTimeout(closeManualPartPanelAfterSuccess, 0);
}

function handleQuantityKeyboard(event) {
  if (event.target?.id !== 'quantityInput' || event.key !== 'Enter' || !manualQuantityPending) return;
  window.setTimeout(closeManualPartPanelAfterSuccess, 0);
}

function prepareManualPartField() {
  const input = $('partSearchInput');
  const button = $('manualPartBtn');

  if (input) {
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'characters');
    input.placeholder = 'Kod części';
  }

  if (button) {
    button.textContent = 'Zatwierdź kod';
  }
}

function initManualPartControl() {
  prepareManualPartField();
  document.addEventListener('click', guardManualPartInput, true);
  document.addEventListener('keydown', guardManualPartInput, true);
  document.addEventListener('click', handleQuantityClick);
  document.addEventListener('keydown', handleQuantityKeyboard);
}

document.addEventListener('DOMContentLoaded', initManualPartControl);
