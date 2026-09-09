from pathlib import Path
import re

# index.html — custom splash shows only GPBS text, never the app icon.
index = Path('index.html')
s = index.read_text(encoding='utf-8')

old_markup = '''  <div id="startupSplash" aria-hidden="true">
    <img src="./icons/app-icon-512.png?v=6" alt="">
  </div>'''
new_markup = '''  <div id="startupSplash" aria-hidden="true">
    <div id="startupBrand" aria-hidden="true">GPBS</div>
  </div>'''
if old_markup not in s:
    raise SystemExit('startup splash markup not found')
s = s.replace(old_markup, new_markup, 1)

# Make the base frame match Android's generated splash before decorative layers appear.
s = s.replace(
    'transition: opacity .3s ease, visibility 0s linear .3s;',
    'transition: opacity .45s ease, visibility 0s linear .45s;',
    1,
)

old_img_css = '''    #startupSplash img {
      display: block;
      width: min(58vw, 240px);
      height: auto;
      max-width: 240px;
      max-height: 58vh;
      object-fit: contain;
    }
'''
new_brand_css = '''    #startupBrand {
      opacity: 0;
      color: #f4f6f8;
      font-size: 52px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: .14em;
      padding-left: .14em;
      white-space: nowrap;
    }
'''
if old_img_css not in s:
    raise SystemExit('startup inline image CSS not found')
s = s.replace(old_img_css, new_brand_css, 1)

s = s.replace('const MIN_SPLASH_MS = 2000;', 'const MIN_SPLASH_MS = 2050;', 1)
s = s.replace('window.setTimeout(() => splash.remove(), 350);', 'window.setTimeout(() => splash.remove(), 500);', 1)
index.write_text(s, encoding='utf-8')

# warehouse.css — replace all previous custom splash experiments with one stable transition.
css = Path('css/warehouse.css')
c = css.read_text(encoding='utf-8')
marker = '/* Startup splash v2 — stabilny viewport i spokojne tło. */'
pos = c.find(marker)
if pos < 0:
    raise SystemExit('startup splash v2 marker not found')

new_tail = r'''/* Startup splash v3 — systemowa ikona -> spokojne tło -> GPBS -> logowanie. */
#startupSplash {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  overflow: hidden !important;
  isolation: isolate;
  background: #20242a !important;
}

/* Dekoracje startują od zera, więc pierwsza klatka ma dokładnie kolor systemowego splashu. */
#startupSplash::before {
  content: "";
  position: absolute;
  inset: -12%;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  background:
    radial-gradient(circle at 50% 47%, rgba(214,83,83,.17) 0%, rgba(214,83,83,.07) 24%, transparent 50%),
    radial-gradient(circle at 18% 12%, rgba(255,255,255,.055) 0%, transparent 31%),
    linear-gradient(180deg, #262a30 0%, #20242a 46%, #181b20 100%);
  animation: startupBackdropIn .68s ease-out .08s forwards;
}

#startupSplash::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0;
  background:
    radial-gradient(circle at 50% 50%, transparent 0%, transparent 48%, rgba(0,0,0,.12) 100%),
    linear-gradient(135deg, rgba(255,255,255,.025), transparent 34%, transparent 68%, rgba(214,83,83,.035));
  animation: startupDetailIn .72s ease-out .16s forwards;
}

#startupBrand {
  position: relative;
  z-index: 2;
  opacity: 0;
  filter: blur(4px);
  color: #f4f6f8;
  font-size: clamp(44px, 13vw, 58px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: .14em;
  padding-left: .14em;
  white-space: nowrap;
  text-shadow: 0 0 30px rgba(214,83,83,.16);
  animation: startupBrandIn .5s cubic-bezier(.22,.8,.3,1) .30s forwards;
}

@keyframes startupBackdropIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes startupDetailIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes startupBrandIn {
  from { opacity: 0; filter: blur(4px); }
  to { opacity: 1; filter: blur(0); }
}

#startupSplash.startup-splash-hide #startupBrand {
  opacity: 0;
  filter: blur(2px);
  transition: opacity .30s ease, filter .30s ease;
}

#startupSplash.startup-splash-hide::before,
#startupSplash.startup-splash-hide::after {
  opacity: 0;
  transition: opacity .38s ease;
}

/* Podpis Jaro mniejszy o 20%. */
.app-signature img {
  width: 80px !important;
}

@media (prefers-reduced-motion: reduce) {
  #startupSplash::before,
  #startupSplash::after,
  #startupBrand {
    animation-duration: .01ms !important;
    animation-delay: 0ms !important;
  }
}
'''

c = c[:pos] + new_tail
css.write_text(c, encoding='utf-8')

# Visible build marker for test phones.
auth = Path('js/auth.js')
a = auth.read_text(encoding='utf-8')
a = a.replace("element.textContent = 'v0.24';", "element.textContent = 'v0.25';", 1)
auth.write_text(a, encoding='utf-8')

# Force a fresh application shell.
sw = Path('service-worker.js')
w = sw.read_text(encoding='utf-8')
w = w.replace("selfstorage-shell-v72", "selfstorage-shell-v73", 1)
sw.write_text(w, encoding='utf-8')

# Guardrails.
assert '<div id="startupBrand" aria-hidden="true">GPBS</div>' in index.read_text(encoding='utf-8')
assert '#startupSplash img' not in css.read_text(encoding='utf-8')
assert 'startupBrandIn' in css.read_text(encoding='utf-8')
assert "v0.25" in auth.read_text(encoding='utf-8')
assert "selfstorage-shell-v73" in sw.read_text(encoding='utf-8')
