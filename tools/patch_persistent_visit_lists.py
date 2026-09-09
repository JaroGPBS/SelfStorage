from pathlib import Path
import re

# operation-flow.js: Wróć ma tylko wracać do wizyty i zachować szkic.
op_path = Path('js/operation-flow.js')
op = op_path.read_text(encoding='utf-8')

# Przy trwałym szkicu można bezpiecznie przechodzić między Zwrotem i Pobraniem.
op = re.sub(
    r"function guardOperationChange\(event\) \{.*?\n\}\n\nfunction confirmPartDelete",
    "function guardOperationChange() {\n  return false;\n}\n\nfunction confirmPartDelete",
    op,
    count=1,
    flags=re.S,
)

old_tail = """  if (returnFromEmptyOperation()) return;\n  saveCurrentOperation();"""
new_tail = """  const backButton = $('operationBackBottomBtn');\n  if (backButton) backButton.click();"""
if old_tail not in op:
    raise SystemExit('Nie znaleziono starej logiki Wróć w operation-flow.js')
op = op.replace(old_tail, new_tail, 1)

op_path.write_text(op, encoding='utf-8')

# runtime-fixes.js: przy kończeniu wizyty automatycznie zabezpiecz zachowany szkic w kolejce.
rt_path = Path('js/runtime-fixes.js')
rt = rt_path.read_text(encoding='utf-8')

helper_marker = 'function queueDraftForFinish(state) {'
if helper_marker not in rt:
    insert_before = 'function requestFinish() {'
    idx = rt.find(insert_before)
    if idx < 0:
        raise SystemExit('Nie znaleziono requestFinish()')

    helper = r'''function queueDraftForFinish(state) {
  const draft = state?.operationDraft;
  const team = state?.team;
  const visit = state?.visit;

  if (!draftHasData(state)) return true;
  if (!draft || !team?.id || !visit?.idWizyty) return false;

  const pobranie = Array.isArray(draft.pobranie) ? draft.pobranie : [];
  const zwrot = Array.isArray(draft.zwrot) ? draft.zwrot : [];

  if (pobranie.length + zwrot.length === 0) {
    showCritical('Masz komentarz bez części. Usuń komentarz albo dodaj część przed zakończeniem wizyty.');
    return false;
  }

  const operationTime = draft.operationTime || new Date().toISOString();
  const payload = {
    idSesji: draft.idSesji,
    idWizyty: visit.idWizyty,
    dataCzasOperacji: operationTime,
    idEkipy: team.id,
    idMagazynu: visit.magazyn?.id,
    komentarz: String(draft.komentarz || '').trim(),
    pobranie: pobranie.map(item => ({ kod: item.kod, ilosc: item.ilosc })),
    zwrot: zwrot.map(item => ({ kod: item.kod, ilosc: item.ilosc }))
  };

  const queue = currentQueue();
  const existingIndex = queue.findIndex(item => String(item?.idSesji || '') === String(payload.idSesji || ''));
  const queuedItem = {
    idSesji: payload.idSesji,
    payload,
    status: 'OCZEKUJE_NA_WYSŁANIE',
    createdAt: new Date().toISOString(),
    lastError: null
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = queuedItem;
  } else {
    queue.push(queuedItem);
  }

  if (!writeJson(QUEUE_KEY, queue)) return false;

  state.operationDraft = null;
  if (!writeJson(STATE_KEY, state)) return false;

  try {
    window.dispatchEvent(new StorageEvent('storage', { key: QUEUE_KEY }));
  } catch {}

  return true;
}

'''
    rt = rt[:idx] + helper + rt[idx:]

old_request = r'''function requestFinish() {
  const state = currentState();
  if (!state?.team || !state?.visit) return;

  if (draftHasData(state)) {
    showCritical('Masz niezapisaną listę części. Kliknij „Wznów”, a potem „Wróć” — lista zapisze się automatycznie.');
    return;
  }

  if (!storePendingFinish(state)) {
    showCritical('Nie udało się zapisać żądania zakończenia wizyty w telefonie.');
    return;
  }

  closeFinishModal();
  processPendingFinish(true);
}'''
new_request = r'''function requestFinish() {
  const state = currentState();
  if (!state?.team || !state?.visit) return;

  if (draftHasData(state) && !queueDraftForFinish(state)) {
    showCritical('Nie udało się zabezpieczyć listy części w telefonie. Spróbuj ponownie.');
    return;
  }

  if (!storePendingFinish(state)) {
    showCritical('Nie udało się zapisać żądania zakończenia wizyty w telefonie.');
    return;
  }

  closeFinishModal();
  processPendingFinish(true);
}'''
if old_request not in rt:
    raise SystemExit('Nie znaleziono starego requestFinish()')
rt = rt.replace(old_request, new_request, 1)

old_block = r'''    if (draftHasData(state)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showCritical('Masz niezapisaną listę części. Kliknij „Wznów”, a potem „Wróć” — lista zapisze się automatycznie.');
      return;
    }

'''
if old_block not in rt:
    raise SystemExit('Nie znaleziono blokady kończenia przy szkicu')
rt = rt.replace(old_block, '', 1)

rt_path.write_text(rt, encoding='utf-8')

# Wersja/cache.
auth_path = Path('js/auth.js')
auth = auth_path.read_text(encoding='utf-8')
auth = auth.replace("import './runtime-fixes.js?v=8';", "import './runtime-fixes.js?v=9';")
auth = auth.replace("element.textContent = 'v0.27';", "element.textContent = 'v0.28';")
auth_path.write_text(auth, encoding='utf-8')

sw_path = Path('service-worker.js')
sw = sw_path.read_text(encoding='utf-8')
sw = sw.replace("selfstorage-shell-v75", "selfstorage-shell-v76")
sw_path.write_text(sw, encoding='utf-8')
