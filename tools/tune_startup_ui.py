from pathlib import Path

# 1. Splash: bez logo, stabilne tło + proste gradienty.
css = Path('css/warehouse.css')
s = css.read_text()
marker = '/* Startup splash v2 — stabilny viewport i spokojne tło. */'
block = '''

/* Startup splash v2 — stabilny viewport i spokojne tło. */
#startupSplash {
  display: block !important;
  padding: 0 !important;
  overflow: hidden !important;
  background:
    radial-gradient(circle at 50% 46%, rgba(214,83,83,.16) 0, rgba(214,83,83,.07) 22%, transparent 48%),
    radial-gradient(circle at 18% 12%, rgba(255,255,255,.055) 0, transparent 30%),
    linear-gradient(180deg, #262a30 0%, #20242a 46%, #181b20 100%) !important;
}

#startupSplash::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50svh;
  width: 320px;
  height: 320px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(214,83,83,.18) 0%, rgba(214,83,83,.07) 38%, transparent 70%);
  filter: blur(22px);
  pointer-events: none;
}

#startupSplash::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.025), transparent 32%, transparent 68%, rgba(214,83,83,.035));
  pointer-events: none;
}

#startupSplash img {
  display: none !important;
}

/* Podpis Jaro mniejszy o 20%. */
.app-signature img {
  width: 80px !important;
}
'''
if marker not in s:
    s += block
css.write_text(s)

# 2. Dodatkowa programowa próba blokady orientacji pionowej.
runtime = Path('js/runtime-fixes.js')
r = runtime.read_text()
orient_marker = 'async function lockPortraitOrientation()'
orient_fn = '''

async function lockPortraitOrientation() {
  const orientation = screen.orientation;
  if (!orientation?.lock) return;

  try {
    await orientation.lock('portrait-primary');
  } catch {
    // Chrome w zwykłej karcie może odmówić; zainstalowana PWA
    // dodatkowo korzysta z orientation: portrait-primary w manifeście.
  }
}
'''
if orient_marker not in r:
    idx = r.find('function initRuntimeFixes() {')
    if idx == -1:
        raise RuntimeError('Nie znaleziono initRuntimeFixes()')
    r = r[:idx] + orient_fn + '\n' + r[idx:]

old = 'function initRuntimeFixes() {\n  installQuietToasts();'
new = 'function initRuntimeFixes() {\n  lockPortraitOrientation();\n  installQuietToasts();'
if old in r:
    r = r.replace(old, new, 1)

visibility_old = "document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState === 'visible') triggerPendingFinishCheck();\n  });"
visibility_new = "document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState === 'visible') {\n      lockPortraitOrientation();\n      triggerPendingFinishCheck();\n    }\n  });"
if visibility_old in r:
    r = r.replace(visibility_old, visibility_new, 1)
runtime.write_text(r)

# 3. Wymuszenie nowego runtime i widocznej wersji aplikacji.
auth = Path('js/auth.js')
a = auth.read_text()
a = a.replace("import './runtime-fixes.js?v=3';", "import './runtime-fixes.js?v=4';")
a = a.replace("element.textContent = 'v0.21';", "element.textContent = 'v0.22';")
auth.write_text(a)

# 4. Nowy cache Service Workera.
sw = Path('service-worker.js')
w = sw.read_text()
w = w.replace("selfstorage-shell-v69", "selfstorage-shell-v70")
sw.write_text(w)
