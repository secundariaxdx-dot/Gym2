# v3.3: gestos de iPhone con toques simulados: deslizar desde el borde para volver, bajar hojas para
# cerrarlas y tirar hacia abajo para actualizar.
import subprocess, sys, time, os
import _pau  # noqa: simula el iPhone de Pau (pesos de partida)
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8780', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
# Desliza con toques reales (TouchEvent) de (x0,y0) a (x1,y1) en `steps` pasos durante `ms` milisegundos
SWIPE = """async ([x0, y0, x1, y1, steps, ms, hold]) => {
  const tgt = document.elementFromPoint(x0, y0) || document.body;
  const mk = (x, y) => new Touch({ identifier: 7, target: tgt, clientX: x, clientY: y, pageX: x, pageY: y });
  const fire = (type, x, y) => { const t = mk(x, y); tgt.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
  const wait = n => new Promise(r => setTimeout(r, n));
  fire('touchstart', x0, y0);
  for (let i = 1; i <= steps; i++) { await wait(ms / steps); fire('touchmove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
  if (hold) await wait(hold);
  fire('touchend', x1, y1);
}"""
SESS = """() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')), now = Date.now();
  s.sessions.push({ id: 'g1', t: now - 86400000, t0: now - 86400000 - 3600000, key: 'pull', name: 'Pull', prs: [], exercises: [
    { exId: 'jalon', name: 'Jalón al pecho (máquina)', muscle: 'Dorsales', sec: [], fatigue: 2, sets: [{ w: 100, r: 10 }] } ] });
  localStorage.setItem('gymapp.v1', JSON.stringify(s)); }"""
h1 = lambda pg: pg.locator('#app h1').first.inner_text()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        ctx.add_init_script("window.__GYM_PUSH = { url: 'http://127.0.0.1:9', key: 'x' };")
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        pg.goto('http://localhost:8780/'); pg.wait_for_selector('.routine')
        pg.evaluate(SESS); pg.reload(); pg.wait_for_selector('.routine')
        swipe = lambda *a: pg.evaluate(SWIPE, list(a))

        # --- volver deslizando desde el borde izquierdo: detalle de entreno -> Perfil
        pg.click('[data-t=perfil]'); pg.locator('[data-a=sess][data-id=g1]').click()
        check(h1(pg) == 'Pull', 'Abierto el detalle del entreno')
        # a mitad de gesto la pantalla sigue al dedo
        pg.evaluate("""async () => { const tgt = document.elementFromPoint(4, 400); const T = (x) => new Touch({ identifier: 9, target: tgt, clientX: x, clientY: 400 });
          tgt.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [T(4)], changedTouches: [T(4)] }));
          for (const x of [30, 80, 140]) { await new Promise(r => setTimeout(r, 16)); tgt.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [T(x)], changedTouches: [T(x)] })); } }""")
        tx = pg.evaluate("() => getComputedStyle(document.querySelector('#app')).transform")
        check('136' in tx, 'Durante el gesto la pantalla se desplaza con el dedo (%s)' % tx)
        pg.screenshot(path=OUT + '/d1-deslizando.png')
        pg.evaluate("""() => { const tgt = document.elementFromPoint(140, 400) || document.body; const t = new Touch({ identifier: 9, target: tgt, clientX: 300, clientY: 400 }); tgt.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [t] })); }""")
        pg.wait_for_timeout(500)
        check(h1(pg) == 'Perfil', 'Soltar pasado un tercio: vuelve a Perfil')
        check(pg.evaluate("() => document.querySelector('#app').style.transform") == '', 'La pantalla queda en su sitio')

        # gesto corto y lento: no vuelve
        pg.locator('[data-a=sess][data-id=g1]').click()
        swipe(4, 400, 50, 402, 10, 600, 0); pg.wait_for_timeout(400)
        check(h1(pg) == 'Pull', 'Gesto corto y lento: se queda (rebota)')
        # gesto corto pero rápido: vuelve (como en iOS)
        swipe(4, 400, 90, 400, 3, 60, 0); pg.wait_for_timeout(450)
        check(h1(pg) == 'Perfil', 'Gesto corto pero rápido: vuelve')
        # desde el centro no vuelve (para no chocar con carruseles)
        pg.locator('[data-a=sess][data-id=g1]').click()
        swipe(150, 400, 360, 400, 8, 200, 0); pg.wait_for_timeout(400)
        check(h1(pg) == 'Pull', 'Deslizar desde el centro no vuelve atrás')
        # vertical desde el borde: no vuelve (es desplazar la página)
        swipe(4, 300, 10, 600, 8, 200, 0); pg.wait_for_timeout(400)
        check(h1(pg) == 'Pull', 'Arrastre vertical desde el borde no cuenta como volver')
        # Ajustes -> Perfil
        swipe(4, 400, 300, 400, 6, 150, 0); pg.wait_for_timeout(450)
        pg.click('[data-t=perfil]'); pg.click('#app .ic-btn[data-t=aj]'); pg.wait_for_selector('[data-a=backup]')
        swipe(4, 400, 300, 400, 6, 150, 0); pg.wait_for_timeout(450)
        check(h1(pg) == 'Perfil', 'Ajustes: deslizar vuelve a Perfil')
        # en pantallas principales (sin «‹») no hace nada
        pg.click('[data-t=hoy]'); swipe(4, 400, 300, 400, 6, 150, 0); pg.wait_for_timeout(400)
        check(h1(pg) == 'Hoy' and pg.evaluate("() => document.querySelector('#app').style.transform") == '', 'En Hoy (sin atrás) no se mueve nada')

        # --- bajar una hoja para cerrarla
        pg.click('[data-t=cal]'); pg.click('.cal-d.today'); pg.wait_for_selector('#modal .sheet')
        box = pg.locator('#modal .sheet').bounding_box()
        y = box['y'] + 20
        swipe(180, y, 182, y + 40, 8, 500, 0); pg.wait_for_timeout(400)
        check(pg.locator('#modal').is_visible(), 'Hoja: arrastre corto y lento la deja abierta')
        swipe(180, y, 182, y + 260, 8, 200, 0); pg.wait_for_timeout(450)
        check(pg.locator('#modal').is_hidden(), 'Hoja: bajarla la cierra')
        # bajar empezando en un campo de texto no la cierra (para poder escribir y seleccionar)
        pg.click('.cal-d.today'); pg.click('#modal [data-a=class-add]'); pg.wait_for_selector('#c-min')
        bm = pg.locator('#c-min').bounding_box()
        swipe(bm['x'] + 20, bm['y'] + 10, bm['x'] + 22, bm['y'] + 270, 8, 200, 0); pg.wait_for_timeout(400)
        check(pg.locator('#modal').is_visible(), 'Empezar en un campo de texto no cierra la hoja')
        pg.click('#modal [data-a=close]')

        # --- tirar para actualizar (Amigos/Perfil, con grupo)
        pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.settings.social = { uid: 'a'.repeat(16), token: 'b'.repeat(64), username: 'pau', name: 'Pau', code: 'GYM1-' + 'A'.repeat(43) }; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        pg.reload(); pg.wait_for_selector('.routine'); pg.click('[data-t=perfil]'); pg.wait_for_timeout(300)
        pg.evaluate(SWIPE.replace("fire('touchend', x1, y1);", "window.__ptrMid = getComputedStyle(document.querySelector('#ptr')).opacity; fire('touchend', x1, y1);"), [200, 200, 200, 420, 10, 300, 0])
        check(float(pg.evaluate('() => window.__ptrMid')) > 0.9, 'Al tirar aparece el indicador')
        check(pg.locator('#ptr.spin').count() == 1, 'Al soltar, actualiza (indicador girando)')
        pg.screenshot(path=OUT + '/d2-actualizar.png')
        pg.wait_for_timeout(1300)
        check(pg.locator('#ptr.spin').count() == 0 and pg.evaluate("() => document.querySelector('#app').style.transform") == '', 'Termina y la pantalla vuelve a su sitio')
        # sin grupo no hay tirar para actualizar
        pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.settings.social = null; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        pg.reload(); pg.wait_for_selector('.routine'); pg.click('[data-t=perfil]')
        swipe(200, 200, 200, 420, 10, 300, 0); pg.wait_for_timeout(300)
        check(pg.locator('#ptr.spin').count() == 0, 'Sin grupo no hay «tirar para actualizar»')
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
