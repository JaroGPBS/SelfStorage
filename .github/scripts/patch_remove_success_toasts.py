from pathlib import Path

# app.js
path = Path('js/app.js')
text = path.read_text()
replacements = [
    ("    showToast(`Zalogowano: ${state.team.nazwa}, magazyn: ${state.visit.magazyn.nazwa}`);\n", ""),
    ("  showToast(existing ? 'Ilość została dodana.' : 'Część dodana do listy.');\n", ""),
    ("    showToast('Operacja została zapisana.');\n", ""),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'app.js block not found: {old[:50]}')
    text = text.replace(old, new, 1)
path.write_text(text)

# operation-flow.js
path = Path('js/operation-flow.js')
text = path.read_text()
old = """    showToast(
      navigator.onLine
        ? 'Operacja zapisana. Synchronizacja trwa w tle.'
        : 'Operacja zapisana w telefonie. Wyślę ją automatycznie po odzyskaniu internetu.'
    );

"""
if old not in text:
    raise SystemExit('operation-flow success toast block not found')
text = text.replace(old, '', 1)
path.write_text(text)

# offline.js
path = Path('js/offline.js')
text = path.read_text()
text = text.replace("        showSyncSuccessModal();", "        hideSendingWindow();", 1)
text = text.replace("    if (manual) showToast('Nie ma operacji oczekujących na wysłanie.');\n", "", 1)
text = text.replace("    if (manual) showToast('Synchronizacja już trwa.');\n", "", 1)
text = text.replace("        showToast(`Wysłano ${sent} oper. • ${left} nadal oczekuje.`);\n", "", 1)
path.write_text(text)

# bump service worker cache
path = Path('service-worker.js')
text = path.read_text()
old = "const CACHE_NAME = 'selfstorage-shell-v64';"
new = "const CACHE_NAME = 'selfstorage-shell-v65';"
if old not in text:
    raise SystemExit('service worker v64 not found')
path.write_text(text.replace(old, new, 1))
