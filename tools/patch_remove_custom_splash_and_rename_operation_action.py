from pathlib import Path
import re

# 1) index.html — usuń całkowicie własny wydłużony splash.
index = Path('index.html')
s = index.read_text(encoding='utf-8')
s = re.sub(
    r'\n    #startupSplash \{.*?\n    \.toast \{',
    '\n    .toast {',
    s,
    count=1,
    flags=re.S,
)
s = re.sub(
    r'\n  <div id="startupSplash" aria-hidden="true">\s*<div id="startupBrand" aria-hidden="true">GPBS</div>\s*</div>',
    '',
    s,
    count=1,
    flags=re.S,
)
s = re.sub(
    r'\n  <script>\s*\(\(\) => \{\s*const startedAt = performance\.now\(\);\s*const MIN_SPLASH_MS = 2050;.*?\}\)\(\);\s*</script>',
    '',
    s,
    count=1,
    flags=re.S,
)
s = s.replace(
    '<button id="reviewSessionBtn" class="btn btn-success operation-review-btn">Zakończ</button>',
    '<button id="reviewSessionBtn" class="btn btn-success operation-review-btn">Wróć</button>'
)
index.write_text(s, encoding='utf-8')

# 2) warehouse.css — usuń wszystkie style własnego splashu, zachowaj Jaro -20%.
css = Path('css/warehouse.css')
c = css.read_text(encoding='utf-8')
marker = '/* Startup splash v3 — systemowa ikona -> spokojne tło -> GPBS -> logowanie. */'
if marker in c:
    c = c.split(marker, 1)[0].rstrip() + '''\n\n/* Podpis Jaro mniejszy o 20%. */\n.app-signature img {\n  width: 80px !important;\n}\n'''
css.write_text(c, encoding='utf-8')

# 3) operation-flow.js — prosta etykieta i prosty komunikat.
op = Path('js/operation-flow.js')
o = op.read_text(encoding='utf-8')
o = o.replace("const expected = hasParts ? 'Zakończ' : 'Cofnij';", "const expected = hasParts ? 'Wróć' : 'Cofnij';")
o = o.replace(
    "showToast(`Masz niezapisaną operację ${activeLabel}. Zapisz ją przed rozpoczęciem ${requestedLabel}.`, true);",
    "showToast(`Masz rozpoczętą operację ${activeLabel}. Kliknij „Wróć” — lista zapisze się automatycznie.`, true);"
)
op.write_text(o, encoding='utf-8')

# 4) runtime-fixes.js — ten sam tekst, żeby runtime nie przywrócił „Zakończ”.
runtime = Path('js/runtime-fixes.js')
r = runtime.read_text(encoding='utf-8')
r = r.replace("const expected = operationHasParts() ? 'Zakończ' : 'Cofnij';", "const expected = operationHasParts() ? 'Wróć' : 'Cofnij';")
r = r.replace(
    "Masz niedokończoną operację. Najpierw kliknij „Zakończ”, aby ją zapisać.",
    "Masz niezapisaną listę części. Kliknij „Wznów”, a potem „Wróć” — lista zapisze się automatycznie."
)
runtime.write_text(r, encoding='utf-8')

# 5) app.js — brak chwilowego migania starego tekstu przed runtime override.
app = Path('js/app.js')
a = app.read_text(encoding='utf-8')
a = a.replace("$('reviewSessionBtn').textContent = locked ? 'Wyślij ponownie' : 'Podsumowanie i wyślij';", "$('reviewSessionBtn').textContent = locked ? 'Wyślij ponownie' : 'Wróć';")
app.write_text(a, encoding='utf-8')

# 6) Wersja + cache busting.
auth = Path('js/auth.js')
au = auth.read_text(encoding='utf-8')
au = au.replace("import './runtime-fixes.js?v=6';", "import './runtime-fixes.js?v=7';")
au = au.replace("import './runtime-fixes.js?v=7';", "import './runtime-fixes.js?v=8';")
au = au.replace("element.textContent = 'v0.25';", "element.textContent = 'v0.26';")
au = au.replace("element.textContent = 'v0.26';", "element.textContent = 'v0.27';")
auth.write_text(au, encoding='utf-8')

sw = Path('service-worker.js')
w = sw.read_text(encoding='utf-8')
w = w.replace("selfstorage-shell-v73", "selfstorage-shell-v74")
w = w.replace("selfstorage-shell-v74", "selfstorage-shell-v75")
sw.write_text(w, encoding='utf-8')
