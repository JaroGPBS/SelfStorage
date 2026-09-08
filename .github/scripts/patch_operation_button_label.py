from pathlib import Path

path = Path('js/operation-flow.js')
text = path.read_text()
old = """  const hasParts = data.list.length > 0;
  const expected = hasParts
    ? (data.type === 'ZWROT' ? 'Zapisz Zwrot' : 'Zapisz Pobranie')
    : 'Wróć';
"""
new = """  const hasParts = data.list.length > 0;
  const expected = hasParts ? 'Zakończ' : 'Cofnij';
"""
if old not in text:
    raise SystemExit('operation button label block not found')
path.write_text(text.replace(old, new, 1))

path = Path('index.html')
text = path.read_text()
old = '<button id="reviewSessionBtn" class="btn btn-success operation-review-btn">Zapisz operację</button>'
new = '<button id="reviewSessionBtn" class="btn btn-success operation-review-btn">Zakończ</button>'
if old not in text:
    raise SystemExit('index review button not found')
path.write_text(text.replace(old, new, 1))

path = Path('service-worker.js')
text = path.read_text()
old = "const CACHE_NAME = 'selfstorage-shell-v66';"
new = "const CACHE_NAME = 'selfstorage-shell-v67';"
if old not in text:
    raise SystemExit('service worker v66 not found')
path.write_text(text.replace(old, new, 1))
