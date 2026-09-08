from pathlib import Path

# app.js
path = Path('js/app.js')
text = path.read_text()

marker = "function openQuantityModal(part, type, mode) {"
if marker not in text:
    raise SystemExit('openQuantityModal marker not found')

helpers = """function syncQuantityModalViewport() {
  const modal = $('quantityModal');
  if (!modal || !modal.classList.contains('show')) return;

  const viewport = window.visualViewport;
  const visibleHeight = Math.max(240, Math.round(viewport?.height || window.innerHeight));
  const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));

  modal.style.top = `${offsetTop}px`;
  modal.style.bottom = 'auto';
  modal.style.height = `${visibleHeight}px`;

  const card = modal.querySelector('.modal-card');
  if (card) {
    card.style.maxHeight = `${Math.max(220, visibleHeight - 24)}px`;
  }
}

function resetQuantityModalViewport() {
  const modal = $('quantityModal');
  if (!modal) return;

  modal.style.removeProperty('top');
  modal.style.removeProperty('bottom');
  modal.style.removeProperty('height');

  const card = modal.querySelector('.modal-card');
  card?.style.removeProperty('max-height');
}

"""
text = text.replace(marker, helpers + marker, 1)

old = """  $('quantityModal').classList.add('show');
  $('quantityModal').setAttribute('aria-hidden', 'false');

  setTimeout(() => $('quantityInput').focus(), 80);
}
"""
new = """  $('quantityModal').classList.add('show');
  $('quantityModal').setAttribute('aria-hidden', 'false');
  syncQuantityModalViewport();

  setTimeout(() => {
    const input = $('quantityInput');
    input?.focus();
    syncQuantityModalViewport();
    input?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, 80);
}
"""
if old not in text:
    raise SystemExit('open quantity tail not found')
text = text.replace(old, new, 1)

old = """function closeQuantityModal() {
  quantityTarget = null;
  $('quantityInput').value = '';
  $('quantityModal').classList.remove('show');
  $('quantityModal').setAttribute('aria-hidden', 'true');
}
"""
new = """function closeQuantityModal() {
  quantityTarget = null;
  $('quantityInput').value = '';
  $('quantityModal').classList.remove('show');
  $('quantityModal').setAttribute('aria-hidden', 'true');
  resetQuantityModalViewport();
}
"""
if old not in text:
    raise SystemExit('close quantity block not found')
text = text.replace(old, new, 1)

bind_marker = """  $('quantityInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') confirmQuantity();
  });
"""
bind_new = bind_marker + """

  window.visualViewport?.addEventListener('resize', syncQuantityModalViewport);
  window.visualViewport?.addEventListener('scroll', syncQuantityModalViewport);
"""
if bind_marker not in text:
    raise SystemExit('quantity bind marker not found')
text = text.replace(bind_marker, bind_new, 1)
path.write_text(text)

# CSS: append focused rules for the quantity modal only.
path = Path('css/app.css')
css = path.read_text()
block = """

/* Ilość części: modal dopasowany do widocznego obszaru nad klawiaturą Androida. */
#quantityModal {
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: max(10px, env(safe-area-inset-top)) 14px max(10px, env(safe-area-inset-bottom));
  overscroll-behavior: contain;
}

#quantityModal .modal-card.compact {
  width: min(100%, 520px);
  margin: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (max-height: 560px) {
  #quantityModal {
    align-items: flex-start;
    padding-top: 8px;
    padding-bottom: 8px;
  }

  #quantityModal .modal-card.compact {
    margin-top: 0;
    margin-bottom: 0;
    padding-top: 16px;
    padding-bottom: 12px;
  }

  #quantityModal .field-label {
    margin-top: 12px;
  }

  #quantityModal .quantity-input {
    min-height: 52px;
  }

  #quantityModal .modal-actions .btn {
    min-height: 48px;
  }
}
"""
if 'Ilość części: modal dopasowany do widocznego obszaru' in css:
    raise SystemExit('quantity keyboard CSS already present')
path.write_text(css.rstrip() + block + '\n')

# bump cache
path = Path('service-worker.js')
sw = path.read_text()
old = "const CACHE_NAME = 'selfstorage-shell-v65';"
new = "const CACHE_NAME = 'selfstorage-shell-v66';"
if old not in sw:
    raise SystemExit('service worker v65 not found')
path.write_text(sw.replace(old, new, 1))
