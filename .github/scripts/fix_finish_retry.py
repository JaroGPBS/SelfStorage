from pathlib import Path

path = Path('js/offline.js')
text = path.read_text()
old = "if (!navigator.onLine || !loadPendingFinish() || finishRunning || finishRetryTimer) return;"
new = "if (!navigator.onLine || !loadPendingFinish() || finishRetryTimer) return;"
if old not in text:
    raise SystemExit('finish retry guard not found')
path.write_text(text.replace(old, new, 1))

sw_path = Path('service-worker.js')
sw = sw_path.read_text()
old_sw = "const CACHE_NAME = 'selfstorage-shell-v63';"
new_sw = "const CACHE_NAME = 'selfstorage-shell-v64';"
if old_sw not in sw:
    raise SystemExit('service worker v63 not found')
sw_path.write_text(sw.replace(old_sw, new_sw, 1))
