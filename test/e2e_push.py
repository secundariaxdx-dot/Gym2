# Aviso con la app cerrada: app + Worker local (wrangler dev) + servicio push falso.
# Requiere: cd push && npm install, y push/.dev.vars (DEV_ORIGINS=1, VAPID_PRIVATE_JWK).
import subprocess, sys, time, os, threading, json, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True)
KEY = re.search(r"PUSH_KEY = '([^']+)'", open(os.path.join(ROOT, 'build.py')).read()).group(1)
fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

pushes = []
class Fake(BaseHTTPRequestHandler):
    def do_POST(self):
        pushes.append((self.path, time.time())); self.send_response(201); self.end_headers()
    def log_message(self, *a): pass
fake = HTTPServer(('127.0.0.1', 8781), Fake); threading.Thread(target=fake.serve_forever, daemon=True).start()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
wr = subprocess.Popen(['npx', 'wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1', '--persist-to', __import__('tempfile').mkdtemp()], cwd=os.path.join(ROOT, 'push'), env={**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

STUB = """
window.__GYM_PUSH = { url: 'http://localhost:8787', key: '%s' };
window.__hidden = false;
Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
Object.defineProperty(document, 'visibilityState', { get: () => window.__hidden ? 'hidden' : 'visible' });
window.__setHidden = h => { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
Notification.requestPermission = () => Promise.resolve('granted');
const fakeSub = { endpoint: 'http://localhost:8781/ep', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: () => Promise.resolve(true) };
window.__subKey = null;
Object.defineProperty(window, '__hasSub', { get: () => localStorage.getItem('__hasSub') === '1', set: v => localStorage.setItem('__hasSub', v ? '1' : '0') });
PushManager.prototype.subscribe = function (o) { window.__subKey = o.applicationServerKey; window.__hasSub = true; return Promise.resolve(fakeSub); };
PushManager.prototype.getSubscription = function () { return Promise.resolve(window.__hasSub ? fakeSub : null); };
""" % KEY

def left(pg): return pg.evaluate('() => (window.__gym.state.timer.end - Date.now()) / 1000')
def shorten(pg, maxleft=20):  # baja de 15 en 15 hasta quedar entre 5 y 20 s
    while left(pg) > maxleft: pg.click('[data-a=t-m]')
def armed(pg): return pg.evaluate('() => { const t = window.__gym.state.timer; return t ? t.armed === t.end && t.armed > 0 : null; }')
def wait_end(pg, extra=2.5): time.sleep(max(0, left(pg)) + extra)

try:
    for _ in range(120):
        try:
            import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/', timeout=1); break
        except Exception: time.sleep(0.5)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        ctx.add_init_script(STUB)
        ctx.grant_permissions(['notifications'], origin='http://localhost:8771')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8771/'); pg.wait_for_selector('.routine')
        pg.wait_for_function('() => navigator.serviceWorker.controller', timeout=10000)

        # Activar en Ajustes
        pg.click('[data-t=aj]'); pg.wait_for_selector('[data-f=push]')
        check(not pg.is_checked('[data-f=push]'), 'Aviso desactivado por defecto (datos antiguos intactos)')
        pg.click('[data-f=push]')
        pg.wait_for_function('() => window.__gym.state.settings.push === true', timeout=8000)
        pid = pg.evaluate('() => window.__gym.state.settings.pushId')
        check(bool(re.fullmatch('[0-9a-f]{32}', pid or '')), 'Id de dispositivo aleatorio: %s' % pid)
        check(pg.evaluate('() => window.__subKey && window.__subKey.length') == 65, 'Se suscribe con la clave pública VAPID')
        check(pg.locator('[data-a=push-test]').count() == 1, 'Botón de prueba visible')
        pg.screenshot(path=OUT + '/50-ajustes-aviso.png', full_page=True)

        # Botón de prueba -> push en ~8 s
        pushes.clear(); pg.click('[data-a=push-test]'); time.sleep(10)
        check(len(pushes) == 1, 'Probar: llega 1 push (%d)' % len(pushes))
        pg.click('[data-t=hoy]'); pg.click('[data-t=aj]'); pg.wait_for_function("() => (document.querySelector('#push-last') || {}).textContent", timeout=5000)
        check('entregado' in pg.inner_text('#push-last'), 'Ajustes muestra el último envío: ' + pg.inner_text('#push-last'))

        # Entreno: serie hecha -> se programa; app en segundo plano -> llega al final
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.click('section.ex.open .chk >> nth=0'); time.sleep(0.8)
        check(armed(pg) is True, 'Al marcar serie se programa el aviso')
        shorten(pg); time.sleep(0.8)
        check(armed(pg) is True, '−15 reprograma el aviso')
        pushes.clear(); end = pg.evaluate('() => window.__gym.state.timer.end') / 1000
        pg.evaluate('() => window.__setHidden(true)')
        wait_end(pg)
        check(len(pushes) == 1, 'App en segundo plano: llega el push al acabar (%d)' % len(pushes))
        if pushes: check(abs(pushes[0][1] - end) < 1.5, 'A tiempo (desfase %.2f s)' % (pushes[0][1] - end))
        pg.evaluate('() => window.__setHidden(false)'); time.sleep(6)

        # Con la app delante: se anula antes del final y suena el pitido de la app (sin push doble)
        pg.click('section.ex.open .chk >> nth=1'); time.sleep(0.8); shorten(pg); time.sleep(0.8)
        pushes.clear(); n_end = pg.evaluate("() => window.__gym.sounds.filter(s => s === 'end').length")
        wait_end(pg)
        check(len(pushes) == 0, 'App delante: no llega push (%d)' % len(pushes))
        check(pg.evaluate("() => window.__gym.sounds.filter(s => s === 'end').length") == n_end + 1, 'App delante: suena el pitido de la app')
        time.sleep(6)

        # Se bloquea en los últimos 2,5 s (ya anulado) -> se vuelve a programar al ocultarse
        pg.click('section.ex.open .chk >> nth=2'); time.sleep(0.8); shorten(pg)
        while left(pg) > 1.6: time.sleep(0.2)
        check(armed(pg) is False, 'Últimos segundos con la app delante: anulado')
        pushes.clear(); pg.evaluate('() => window.__setHidden(true)'); wait_end(pg)
        check(len(pushes) == 1, 'Se bloquea justo al final: se reprograma y llega (%d)' % len(pushes))
        pg.evaluate('() => window.__setHidden(false)'); time.sleep(6)

        # +15 con la app cerrada: el aviso se mueve a la hora nueva (no suena en la vieja)
        pg.click('[data-a=add-set]'); pg.fill('section.ex.open input[data-f=r][data-j="3"]', '8')
        pg.click('section.ex.open .chk >> nth=3'); time.sleep(0.8); shorten(pg); time.sleep(0.5)
        old_end = pg.evaluate('() => window.__gym.state.timer.end') / 1000
        pg.click('[data-a=t-p]'); time.sleep(0.8)
        new_end = pg.evaluate('() => window.__gym.state.timer.end') / 1000
        check(armed(pg) is True and abs(new_end - old_end - 15) < 0.01, '+15 reprograma el aviso')
        pushes.clear(); pg.evaluate('() => window.__setHidden(true)')
        time.sleep(max(0, old_end - time.time()) + 2)
        check(len(pushes) == 0, '+15: no suena a la hora vieja')
        wait_end(pg)
        check(len(pushes) == 1 and abs(pushes[0][1] - new_end) < 1.5, '+15: suena a la hora nueva (%d)' % len(pushes))
        pg.evaluate('() => window.__setHidden(false)'); time.sleep(6)

        # Saltar el descanso -> cancela
        pg.click('[data-a=add-set]'); pg.fill('section.ex.open input[data-f=r][data-j="4"]', '8')
        pg.click('section.ex.open .chk >> nth=4'); time.sleep(0.8); shorten(pg); time.sleep(0.5)
        pushes.clear(); t_end = left(pg); pg.click('[data-a=t-x]'); pg.evaluate('() => window.__setHidden(true)')
        time.sleep(t_end + 2)
        check(len(pushes) == 0, 'Saltar descanso: no llega push')
        pg.evaluate('() => window.__setHidden(false)')

        # Silencio -> no hay aviso
        pg.click('header.top .mute-b')
        pg.click('section.ex.open [data-a=add-set]'); pg.fill('section.ex.open input[data-f=r][data-j="5"]', '8')
        pg.click('section.ex.open .chk >> nth=5'); time.sleep(0.8)
        check(armed(pg) is False, 'Silenciado: no se programa')
        shorten(pg); pushes.clear(); pg.evaluate('() => window.__setHidden(true)'); wait_end(pg)
        check(len(pushes) == 0, 'Silenciado: no llega push')
        pg.evaluate('() => window.__setHidden(false)'); pg.click('header.top .mute-b')

        # Reabrir la app renueva la suscripción y conserva el ajuste
        pg.reload(); pg.wait_for_selector('header.top h1'); time.sleep(1)
        check(pg.evaluate('() => window.__gym.state.settings.push') is True, 'El aviso sigue activo tras reabrir')
        # iOS retira la suscripción -> se desactiva y avisa
        pg.evaluate('() => { window.__hasSub = false; }'); pg.reload(); pg.wait_for_selector('header.top h1')
        pg.wait_for_function('() => window.__gym.state.settings.push === false', timeout=5000)
        check(True, 'Suscripción retirada: se desactiva el ajuste')
        # Desactivar a mano
        pg.evaluate('() => { window.__hasSub = true; }')
        pg.click('[data-t=aj]'); pg.click('[data-f=push]'); pg.wait_for_function('() => window.__gym.state.settings.push === true', timeout=8000)
        pg.click('[data-f=push]')
        check(pg.evaluate('() => window.__gym.state.settings.push') is False and pg.locator('[data-a=push-test]').count() == 0, 'Desactivar desde Ajustes')

        # ---- Texto de la notificación: siguiente serie, sin nombre de ejercicio (se queda en el iPhone)
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        ctx.add_init_script(STUB); ctx.grant_permissions(['notifications'], origin='http://localhost:8771')
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:8771/'); pg.wait_for_selector('.routine')
        pg.wait_for_function('() => navigator.serviceWorker.controller', timeout=10000)
        pg.click('[data-t=aj]'); pg.click('[data-f=push]'); pg.wait_for_function('() => window.__gym.state.settings.push === true', timeout=8000)
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.click('section.ex.open .chk >> nth=0'); time.sleep(0.8)
        note = lambda: pg.evaluate("() => caches.open('gym-meta').then(c => c.match('/__next')).then(r => r && r.json())")
        n1 = note()
        check(n1 and n1['body'] == 'Serie 2/3: 85 kg × 11', 'Texto guardado: %s' % (n1 and n1['body']))
        cdp = ctx.new_cdp_session(pg); regs = []
        cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: regs.extend(e['registrations']))
        cdp.send('ServiceWorker.enable')
        for _ in range(30):
            live = [r for r in regs if not r.get('isDeleted')]
            if live: break
            pg.wait_for_timeout(200)
        rid = live[0]['registrationId']
        def deliver():
            pg.evaluate("() => navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.forEach(n => n.close()))")
            cdp.send('ServiceWorker.deliverPushMessage', {'origin': 'http://localhost:8771', 'registrationId': rid, 'data': ''})
            # la notificación puede cerrarse sola en Chrome sin interfaz: se lee en cuanto aparece
            for _ in range(100):
                v = pg.evaluate("() => navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.length ? { title: ns[0].title, body: ns[0].body } : null)")
                if v: return v
                pg.wait_for_timeout(50)
            return {'title': None, 'body': None}
        nt = deliver()
        check(nt['title'] == '⏱️ Descanso terminado' and nt['body'] == 'Serie 2/3: 85 kg × 11', 'Notificación con la siguiente serie: %s' % nt)
        # cambiar el peso de la siguiente serie y re-programar (±15) actualiza el texto
        pg.fill('section.ex.open input[data-f=w][data-j="1"]', '87,5'); pg.click('[data-a=t-p]'); time.sleep(0.5)
        check(note()['body'] == 'Serie 2/3: 87,5 kg × 11', '±15 actualiza el texto: %s' % note()['body'])
        # última serie del ejercicio -> siguiente ejercicio
        for j in (1, 2):
            if pg.locator('section.ex').first.locator('.set.done').count() <= j: pg.locator('section.ex').first.locator('.chk').nth(j).click(); time.sleep(0.3)
        b2 = note()['body']
        check(b2.startswith('Siguiente ejercicio · serie 1/'), 'Al acabar el ejercicio: %s' % b2)
        check('Press' not in b2 and 'pecho' not in b2.lower(), 'Sin nombre de ejercicio')
        # sin texto guardado (o caducado) -> texto por defecto
        pg.evaluate("() => caches.open('gym-meta').then(c => c.delete('/__next'))")
        check(deliver()['body'] == 'A por la siguiente serie 💪', 'Sin texto guardado: mensaje por defecto')
        pg.click('[data-a=t-x]'); time.sleep(0.5)
        b.close()
finally:
    srv.terminate(); fake.shutdown()
    import signal
    try: os.killpg(wr.pid, signal.SIGTERM)  # mata wrangler y workerd
    except Exception: pass
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
