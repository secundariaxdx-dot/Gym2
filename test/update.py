# Comprueba que una versión nueva publicada llega a la app sin pasos raros:
# el service worker baja los archivos sin usar la caché HTTP y la app se recarga sola.
import subprocess, sys, time, os, shutil, tempfile, re
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
for f in ('index.html', 'sw.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'):
    shutil.copy(os.path.join(ROOT, f), tmp)
ver = re.search(r"CACHE = '([^']+)'", open(os.path.join(ROOT, 'sw.js')).read()).group(1)
NEW = ver + '-test'
def publish(v):
    for f in ('sw.js', 'index.html'):
        s = open(os.path.join(ROOT, f), encoding='utf-8').read().replace(ver, v)
        open(os.path.join(tmp, f), 'w', encoding='utf-8').write(s)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8770', '-d', tmp], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
def shown(pg): return pg.evaluate("() => document.documentElement.innerHTML.match(/Versión 1\\.\\d+ \\(([^)]+)\\)/)[1]")
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: (errors.append(str(e)), print('PAGEERROR', e)))
        pg.goto('http://localhost:8770/'); pg.wait_for_selector('.routine')
        pg.wait_for_function('() => navigator.serviceWorker.controller', timeout=10000)
        pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.settings.marca = 42; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        check(shown(pg) == ver, 'Versión inicial ' + ver)
        publish(NEW)
        # abrir la app una vez: carga la vieja de caché, detecta la nueva y se recarga sola
        pg.reload(); pg.wait_for_selector('.routine')
        pg.wait_for_function("v => document.documentElement.innerHTML.includes('(' + v + ')')", arg=NEW, timeout=15000)
        check(shown(pg) == NEW, 'Se actualiza sola en la misma apertura: ' + shown(pg))
        pg.reload(); pg.wait_for_selector('.routine')
        check(shown(pg) == NEW, 'Sigue en la versión nueva al reabrir')
        check(pg.evaluate("() => window.__gym.state.settings.marca === 42"), 'Los datos se conservan tras actualizar')
        b.close()
finally:
    srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
