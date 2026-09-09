from pathlib import Path

css = Path('css/warehouse.css')
s = css.read_text()
marker = '/* Installed PWA splash — dopasowanie do systemowego splash Androida. */'
block = '''

/* Installed PWA splash — dopasowanie do systemowego splash Androida. */
@media (display-mode: standalone) {
  #startupSplash img {
    width: 288px !important;
    height: 288px !important;
    max-width: calc(100vw - 48px) !important;
  }
}
'''
if marker not in s:
    s += block
css.write_text(s)

auth = Path('js/auth.js')
a = auth.read_text()
a = a.replace("import './runtime-fixes.js?v=4';", "import './runtime-fixes.js?v=5';")
a = a.replace("element.textContent = 'v0.22';", "element.textContent = 'v0.23';")
auth.write_text(a)

sw = Path('service-worker.js')
w = sw.read_text()
w = w.replace("selfstorage-shell-v70", "selfstorage-shell-v71")
sw.write_text(w)
