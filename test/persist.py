import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '-d', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.goto('http://localhost:8766/'); pg.wait_for_selector('.routine')
        pg.evaluate('navigator.serviceWorker.ready.then(() => true)')
        time.sleep(1.5)
        pg.reload(); pg.wait_for_selector('.routine')

        # --- sesión a medio entreno + "el sistema cierra la app" = recarga completa
        pg.click('[data-a=start][data-k=pull]'); pg.wait_for_selector('section.ex.open')
        pg.fill('section.ex.open input[data-f=r][data-j="0"]', '12')
        pg.click('section.ex.open .chk >> nth=0')
        pg.fill('section.ex.open input[data-f=r][data-j="1"]', '9')   # escrito pero sin marcar
        pg.reload(); pg.wait_for_selector('section.ex')
        check(pg.evaluate('!!window.__gym.state.active'), 'Tras recargar sigue el entreno en curso')
        check(pg.locator('section.ex.open .set.done').count() == 1, 'La serie marcada sigue marcada')
        check(pg.locator('section.ex.open input[data-f=r][data-j="1"]').input_value() == '9', 'Lo escrito sin marcar también se conserva')
        check(pg.locator('#timer:not([hidden])').count() == 1, 'El temporizador de descanso sigue corriendo tras recargar')

        # --- sin conexión
        ctx.set_offline(True)
        try:
            pg.reload(); pg.wait_for_selector('section.ex', timeout=8000)
            check(True, 'Sin conexión: la app abre y mantiene el entreno')
        except Exception as e:
            check(False, 'Sin conexión: la app NO abre (' + type(e).__name__ + ')')
        ctx.set_offline(False)
        b.close()
finally:
    srv.terminate()
sys.exit(1 if fails else 0)
