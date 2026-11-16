# v2.3: la barra inferior (descanso + pestañas) ya no es una capa flotante: el documento no se desplaza,
# solo la zona de contenido. Evita que en iOS la barra se quede descolocada al volver de otra app.
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8776', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
GEO = """() => { const r = s => { const e = document.querySelector(s).getBoundingClientRect(); return [Math.round(e.top), Math.round(e.bottom)]; };
  const sc = document.querySelector('#scroller');
  return { vh: window.innerHeight, docH: document.documentElement.scrollHeight, winY: window.scrollY, tabs: r('#tabs'), dock: r('#dock'), sc: r('#scroller'),
           top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight,
           posT: getComputedStyle(document.querySelector('#tabs')).position, posD: getComputedStyle(document.querySelector('#dock')).position }; }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8776/'); pg.wait_for_selector('.routine')
        pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.click('section.ex.open .chk >> nth=0'); pg.wait_for_timeout(300)

        g = pg.evaluate(GEO)
        check(g['posT'] != 'fixed' and g['posD'] != 'fixed', 'Pestañas y franja del descanso ya no son capas flotantes (%s, %s)' % (g['posT'], g['posD']))
        check(g['docH'] == g['vh'] and g['winY'] == 0, 'El documento mide lo mismo que la pantalla: no se puede desplazar')
        check(g['tabs'][1] == g['vh'] and g['dock'][1] == g['tabs'][0] and g['sc'][1] == g['dock'][0], 'Contenido, franja y pestañas apilados sin huecos ni solapes')
        check(g['max'] > 300, 'La zona de contenido sí se desplaza (%d px)' % g['max'])

        # desplazar con el dedo/rueda hasta el final y más allá: la barra no se mueve ni un píxel
        box = pg.locator('#scroller').bounding_box(); pg.mouse.move(box['x'] + 150, box['y'] + 300)
        pos = []
        for _ in range(12):
            pg.mouse.wheel(0, 400); pg.wait_for_timeout(60)
            q = pg.evaluate(GEO); pos.append((q['tabs'][0], q['tabs'][1], q['dock'][0], q['winY']))
        check(len(set(pos)) == 1 and pos[0][1] == g['vh'] and pos[0][3] == 0, 'Al desplazar hasta el final, la barra se queda quieta abajo')
        q = pg.evaluate(GEO)
        check(q['top'] == q['max'], 'El contenido llega hasta el final')
        db = pg.locator('[data-a=discard]').bounding_box()
        check(db['y'] + db['height'] <= q['dock'][0], '«Descartar entreno» queda visible por encima de la franja')
        pg.screenshot(path=OUT + '/96-barra-fija.png')

        # marcar una serie conserva la posición de lectura
        pg.evaluate("() => { document.querySelector('#scroller').scrollTop = 180; }")
        pg.click('[data-a=t-p]'); pg.click('section.ex.open [data-a=add-set]')
        check(abs(pg.evaluate("() => document.querySelector('#scroller').scrollTop") - 180) < 3, 'Redibujar conserva la posición')
        # cambiar de pestaña empieza arriba
        pg.click('[data-t=prog]')
        check(pg.evaluate("() => document.querySelector('#scroller').scrollTop") == 0, 'Cambiar de pestaña empieza arriba')
        pg.click('[data-t=hoy]')

        # al salir de la app con el teclado abierto, se cierra (iOS no guarda la pantalla encogida)
        pg.locator('section.ex.open input[data-f=r]').last.focus()
        check(pg.evaluate("() => document.activeElement.tagName") == 'INPUT', 'Campo con el foco')
        pg.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }""")
        check(pg.evaluate("() => document.activeElement.tagName") != 'INPUT', 'Al salir de la app se suelta el campo (se cierra el teclado)')
        pg.evaluate("""() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }""")
        q = pg.evaluate(GEO)
        check(q['tabs'][1] == q['vh'] and q['winY'] == 0, 'Al volver, la barra sigue en su sitio')

        # una hoja abierta bloquea el desplazamiento de fondo
        pg.click('[data-a=finish]')
        check(pg.evaluate("() => getComputedStyle(document.querySelector('#scroller')).overflowY") == 'hidden', 'Con una hoja abierta no se desplaza el fondo')
        pg.click('#modal [data-a=close]')

        # pantalla más baja (teclado, otra orientación): todo sigue encajado
        pg.set_viewport_size({'width': 375, 'height': 520}); pg.wait_for_timeout(150)
        q = pg.evaluate(GEO)
        check(q['tabs'][1] == 520 and q['docH'] == 520 and q['dock'][1] == q['tabs'][0], 'Con menos altura sigue encajado')

        # sin entreno: solo pestañas
        pg.set_viewport_size({'width': 375, 'height': 812})
        pg.click('[data-a=discard]'); pg.click('[data-a=confirm-yes]'); pg.wait_for_selector('.routine')
        q = pg.evaluate(GEO)
        check(q['tabs'][1] == 812 and q['sc'][1] == q['tabs'][0] and pg.locator('#dock').is_hidden(), 'Sin entreno: contenido hasta las pestañas')
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
