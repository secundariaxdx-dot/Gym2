import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8769', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); fails, errors = [], []
os.makedirs(OUT, exist_ok=True)
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

# Espía: cuenta osciladores creados y simula navigator.audioSession de Safari
SPY = """
window.__osc = 0;
(function () {
  var C = window.AudioContext || window.webkitAudioContext;
  if (C) { var o = C.prototype.createOscillator; C.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; }
  if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' } });
})();
"""
# Sin Web Audio (equivale a un navegador sin audio): no debe romper nada
NOAUDIO = "delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined;"

def sounds(pg): return pg.evaluate('() => window.__gym.sounds.slice()')
def mark(pg, j, r='8'):
    pg.fill('section.ex.open input[data-f=r][data-j="%d"]' % j, r)
    pg.click('section.ex.open .chk >> nth=%d' % j)
def finish_timer(pg):
    for _ in range(30):
        if pg.locator('#timer.fin').count(): break
        pg.click('[data-a=t-m]')
    pg.wait_for_selector('#timer.fin', timeout=3000)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        ctx.add_init_script(SPY)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # Datos de una versión anterior sin settings.sound: migración aditiva (sonido activo por defecto)
        pg.goto('http://localhost:8769/'); pg.wait_for_selector('.routine')
        pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); delete s.settings.sound; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        pg.reload(); pg.wait_for_selector('.routine')
        n_sess = pg.evaluate('() => window.__gym.state.sessions.length')

        pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        check(pg.locator('header.top .mute-b').inner_text() == '🔊', 'Botón de silencio en la cabecera del entreno (activo)')
        check(pg.evaluate('() => navigator.audioSession.type') == 'ambient', "audioSession 'ambient': se mezcla con la música")

        # Serie hecha -> clic sutil
        o0 = pg.evaluate('() => window.__osc')
        mark(pg, 0)
        check(sounds(pg) == ['tick'], 'Sonido sutil al marcar serie: %s' % sounds(pg))
        d1 = pg.evaluate('() => window.__osc') - o0; check(d1 in (1, 5), 'El clic es un único tono corto (+4 si hay fanfarria de récord): %d' % d1)
        check(pg.locator('#timer .mute-b').is_visible(), 'Botón de silencio en la barra del descanso')
        pg.screenshot(path=OUT + '/40-timer-sonido.png')

        # Desmarcar no suena
        pg.click('section.ex.open .chk >> nth=0')
        check(sounds(pg) == ['tick'], 'Desmarcar una serie no suena')
        mark(pg, 0)

        # Fin del descanso -> aviso claro (una sola vez)
        finish_timer(pg)
        pg.wait_for_timeout(600)
        check(sounds(pg) == ['tick', 'tick', 'end'], 'Aviso al acabar el descanso: %s' % sounds(pg))
        check(sounds(pg).count('end') == 1, 'El aviso suena una sola vez')

        # Silenciar desde el entreno
        pg.click('header.top .mute-b')
        check(pg.evaluate('() => window.__gym.state.settings.sound') is False, 'Silenciar guarda settings.sound = false')
        check(pg.locator('header.top .mute-b').inner_text() == '🔇' and pg.locator('#timer .mute-b').inner_text() == '🔇', 'Ambos botones muestran 🔇')
        before = len(sounds(pg)); o1 = pg.evaluate('() => window.__osc')
        mark(pg, 1)
        finish_timer(pg); pg.wait_for_timeout(600)
        check(len(sounds(pg)) == before and pg.evaluate('() => window.__osc') == o1, 'Silenciado: ni clic ni aviso')
        pg.screenshot(path=OUT + '/41-silenciado.png')

        # El silencio persiste tras reiniciar y se refleja en Ajustes
        pg.reload(); pg.wait_for_selector('header.top h1')
        check(pg.locator('header.top .mute-b').inner_text() == '🔇', 'Silencio persiste tras reiniciar')
        pg.click('[data-t=aj]'); pg.wait_for_selector('[data-f=sound]')
        check(not pg.is_checked('[data-f=sound]'), 'Ajustes refleja el silencio (mismo ajuste settings.sound)')
        pg.click('[data-f=sound]')
        check(pg.evaluate('() => window.__gym.state.settings.sound') is True, 'Reactivar desde Ajustes')
        pg.click('[data-t=hoy]'); pg.wait_for_selector('header.top h1')
        check(pg.locator('header.top .mute-b').inner_text() == '🔊', 'Cabecera vuelve a 🔊')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == n_sess, 'No se pierden sesiones')
        ctx.close()

        # Sin Web Audio / modo silencio: nada se rompe
        ctx2 = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        ctx2.add_init_script(NOAUDIO)
        pg2 = ctx2.new_page()
        pg2.on('pageerror', lambda e: errors.append('sin audio: ' + str(e)))
        pg2.goto('http://localhost:8769/'); pg2.wait_for_selector('.routine')
        pg2.click('[data-a=start][data-k=push]'); pg2.wait_for_selector('header.top h1')
        mark(pg2, 0)
        check(pg2.locator('section.ex.open .set.done').count() == 1, 'Sin audio: la serie se marca igual')
        finish_timer(pg2); pg2.wait_for_timeout(300)
        check(pg2.locator('#timer.fin').count() == 1, 'Sin audio: el descanso termina igual')
        ctx2.close()
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
