from pathlib import Path

css = Path('css/warehouse.css')
s = css.read_text()
old = '''/* Installed PWA splash — dopasowanie do systemowego splash Androida. */
@media (display-mode: standalone) {
  #startupSplash img {
    width: 288px !important;
    height: 288px !important;
    max-width: calc(100vw - 48px) !important;
  }
}
'''
new = '''/* Installed PWA splash — bez skoku rozmiaru między splashem Androida a aplikacją. */
@keyframes startupPwaLogoFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (display-mode: standalone) {
  #startupSplash img {
    width: 220px !important;
    height: 220px !important;
    max-width: calc(100vw - 72px) !important;
    opacity: 0;
    animation: startupPwaLogoFade .22s ease-out .12s forwards;
  }
}
'''
if old not in s:
    raise SystemExit('Nie znaleziono starego bloku Installed PWA splash')
s = s.replace(old, new, 1)
css.write_text(s)

auth = Path('js/auth.js')
a = auth.read_text()
a = a.replace("import './runtime-fixes.js?v=5';", "import './runtime-fixes.js?v=6';")
a = a.replace("element.textContent = 'v0.23';", "element.textContent = 'v0.24';")
auth.write_text(a)

sw = Path('service-worker.js')
w = sw.read_text()
w = w.replace("selfstorage-shell-v71", "selfstorage-shell-v72")
sw.write_text(w)
