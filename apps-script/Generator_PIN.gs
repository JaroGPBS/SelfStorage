/**
 * SelfStorage — Generator PIN
 *
 * Osobny moduł przeznaczony do Apps Script arkusza "Admin Stock FR".
 * Wszystkie funkcje mają prefiks SS_PIN_, żeby nie kolidować z innymi modułami.
 *
 * Instalacja menu bez dokładania drugiego zwykłego onOpen():
 * 1. Dodaj ten plik do projektu Apps Script arkusza Admin Stock FR.
 * 2. Uruchom ręcznie jeden raz funkcję SS_PIN_instalujMenu.
 * 3. Po ponownym otwarciu arkusza pojawi się menu:
 *    GENERATOR PIN -> Generuj brakujące PIN-y
 */

const SS_PIN_CONFIG = Object.freeze({
  ADMIN_SPREADSHEET_ID: '1WIYHzpmIzfz-cmew7F6fAp7eCvSE_1KkIUyT_peL2hw',
  SHEET_NAME: 'Ekipy',
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  ID_COL: 1,      // A
  TEAM_COL: 2,    // B
  ROLE_COL: 3,    // C
  PIN_COL: 4      // D
});

function SS_PIN_instalujMenu() {
  const ss = SpreadsheetApp.openById(SS_PIN_CONFIG.ADMIN_SPREADSHEET_ID);
  const handler = 'SS_PIN_onOpen';

  const oldTriggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handler);

  oldTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp
    .newTrigger(handler)
    .forSpreadsheet(ss)
    .onOpen()
    .create();

  SpreadsheetApp.getUi().alert(
    'Generator PIN został zainstalowany.\n\n' +
    'Po ponownym otwarciu arkusza pojawi się menu „GENERATOR PIN”.'
  );
}

function SS_PIN_onOpen(e) {
  try {
    const sourceId = e && e.source && typeof e.source.getId === 'function'
      ? e.source.getId()
      : '';

    if (sourceId && sourceId !== SS_PIN_CONFIG.ADMIN_SPREADSHEET_ID) return;

    SS_PIN_dodajMenu_();
  } catch (error) {
    console.error('SS_PIN_onOpen:', error);
  }
}

function SS_PIN_dodajMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('GENERATOR PIN')
    .addItem('Generuj brakujące PIN-y', 'SS_PIN_generujBrakujace')
    .addToUi();
}

function SS_PIN_generujBrakujace() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(SS_PIN_CONFIG.ADMIN_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SS_PIN_CONFIG.SHEET_NAME);

    if (!sheet) {
      throw new Error('Brak zakładki „' + SS_PIN_CONFIG.SHEET_NAME + '”.');
    }

    SS_PIN_sprawdzNaglowki_(sheet);

    const lastRow = sheet.getLastRow();
    if (lastRow < SS_PIN_CONFIG.DATA_START_ROW) {
      SpreadsheetApp.getUi().alert('Brak ekip do sprawdzenia.');
      return;
    }

    const rowCount = lastRow - SS_PIN_CONFIG.DATA_START_ROW + 1;
    const values = sheet
      .getRange(SS_PIN_CONFIG.DATA_START_ROW, 1, rowCount, SS_PIN_CONFIG.PIN_COL)
      .getDisplayValues();

    const usedPins = new Set();

    // Rezerwujemy wszystkie poprawne PIN-y, również z ukrytych wierszy
    // (np. ADMIN), żeby generator nigdy nie przydzielił duplikatu.
    values.forEach(row => {
      const pin = String(row[SS_PIN_CONFIG.PIN_COL - 1] || '').trim();
      if (/^\d{4}$/.test(pin)) usedPins.add(pin);
    });

    let generated = 0;
    let skippedIncomplete = 0;
    const pinValues = values.map(row => [String(row[SS_PIN_CONFIG.PIN_COL - 1] || '').trim()]);

    for (let i = 0; i < values.length; i++) {
      const id = String(values[i][SS_PIN_CONFIG.ID_COL - 1] || '').trim();
      const team = String(values[i][SS_PIN_CONFIG.TEAM_COL - 1] || '').trim();
      const role = String(values[i][SS_PIN_CONFIG.ROLE_COL - 1] || '').trim();
      const existingPin = String(values[i][SS_PIN_CONFIG.PIN_COL - 1] || '').trim();

      // Istniejącego PIN-u nigdy nie zmieniamy.
      if (existingPin) continue;

      // PIN powstaje dopiero wtedy, gdy A, B i C są uzupełnione.
      if (!id || !team || !role) {
        if (id || team || role) skippedIncomplete++;
        continue;
      }

      const pin = SS_PIN_losujUnikalny_(usedPins);
      usedPins.add(pin);
      pinValues[i][0] = pin;
      generated++;
    }

    if (generated > 0) {
      const pinRange = sheet.getRange(
        SS_PIN_CONFIG.DATA_START_ROW,
        SS_PIN_CONFIG.PIN_COL,
        rowCount,
        1
      );

      pinRange.setNumberFormat('@');
      pinRange.setValues(pinValues);
      SpreadsheetApp.flush();
    }

    let message = generated > 0
      ? 'Wygenerowano PIN-y: ' + generated + '.'
      : 'Nie znaleziono pustych PIN-ów do wygenerowania.';

    if (skippedIncomplete > 0) {
      message += '\nPominięto niepełne wiersze: ' + skippedIncomplete + '.';
    }

    ss.toast(message, 'GENERATOR PIN', 6);

  } finally {
    lock.releaseLock();
  }
}

function SS_PIN_losujUnikalny_(usedPins) {
  // 1000–9999: zawsze czytelny, pełny 4-cyfrowy PIN bez zer z przodu.
  // Maksymalnie 9000 możliwych wartości.
  for (let attempt = 0; attempt < 20000; attempt++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedPins.has(pin)) return pin;
  }

  throw new Error('Nie udało się znaleźć wolnego 4-cyfrowego PIN-u.');
}

function SS_PIN_sprawdzNaglowki_(sheet) {
  const headers = sheet
    .getRange(SS_PIN_CONFIG.HEADER_ROW, 1, 1, SS_PIN_CONFIG.PIN_COL)
    .getDisplayValues()[0]
    .map(value => String(value || '').trim().toUpperCase());

  const expected = ['ID', 'EKIPA', 'ROLA', 'PIN'];

  for (let i = 0; i < expected.length; i++) {
    if (headers[i] !== expected[i]) {
      throw new Error(
        'Nieprawidłowy układ zakładki Ekipy. ' +
        'Oczekiwano kolumn A:D: ID | Ekipa | Rola | PIN.'
      );
    }
  }
}
