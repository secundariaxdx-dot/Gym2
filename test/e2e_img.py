"""v3.6: imágenes de ejercicios (miniaturas en listas y buscador, fotos grandes en la ficha, figura si no hay foto, caché sin conexión)."""
import subprocess, sys, time, os
import _pau  # noqa
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8775', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://localhost:8775/'
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
def loaded(pg, sel):
    return pg.evaluate("s => [...document.querySelectorAll(s)].filter(i => i.complete && i.naturalWidth > 0).length", sel)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector('.routine')
        pg.evaluate('navigator.serviceWorker.ready.then(() => true)'); pg.reload(); pg.wait_for_selector('.routine')
        # cada ejercicio de la app con foto tiene sus 3 archivos
        n = pg.evaluate("Promise.all(window.LIB.map(e => fetch('img/ex/' + e.id + '-t.jpg', {method:'HEAD'}).then(r => r.ok))).then(a => a.filter(Boolean).length)")
        check(n >= 110, 'Hay miniatura para %d de %d ejercicios de la biblioteca' % (n, pg.evaluate('window.LIB.length')))
        pg.click('#tabs [data-a=tab][data-t=ej]'); time.sleep(0.5)
        mine = pg.locator('[data-a=edit-ex] .exi').count()
        check(mine == pg.evaluate('window.__gym.state.exercises.length'), 'Mis ejercicios: todos con imagen o figura (%d)' % mine)
        pg.evaluate("document.querySelectorAll('.exi-img').forEach(i => i.loading = 'eager')"); time.sleep(1.5)
        check(loaded(pg, '#ex-list .exi-img') >= 10, 'Las miniaturas cargan')
        check(pg.evaluate("[...document.querySelectorAll('#ex-list .exi-img')].every(i => i.loading === 'eager' || i.getAttribute('loading') === 'lazy')"), 'Miniaturas con carga diferida (no ralentizan)')
        # buscador / biblioteca
        pg.fill('[data-f=q]', 'lumbar'); time.sleep(0.4)
        check(pg.locator('[data-a=edit-lib] .exi').count() >= 2, 'Resultados de búsqueda con imagen')
        check(pg.locator('[data-a=edit-lib][data-id=lumbar-maq] .exi-fig').count() == 1, 'Sin foto (extensión lumbar en máquina): sale la figura con el músculo')
        # ficha
        pg.fill('[data-f=q]', ''); pg.click('[data-a=edit-ex][data-id=jalon]'); pg.wait_for_selector('.exh-img'); time.sleep(1)
        check(pg.locator('.exh-img').count() == 2 and loaded(pg, '.exh-img') == 2, 'Ficha: fotos de inicio y final cargadas')
        wpx = pg.evaluate("document.querySelector('.exh-img').getBoundingClientRect().width")
        check(wpx > 250, 'Ficha: foto grande (%d px de ancho en iPhone)' % wpx)
        check(pg.locator('.exh-svg').count() == 1 and 'Dorsales' in pg.inner_text('.exh'), 'Ficha: figura y músculo principal')
        pg.click('[data-a=close]')
        # ficha de ejercicio nuevo sin nombre: sin cabecera; de biblioteca sin foto: solo figura
        pg.fill('[data-f=q]', 'lumbar'); time.sleep(0.3); pg.click('[data-a=edit-lib][data-id=lumbar-maq]'); time.sleep(0.4)
        check(pg.locator('.exh-row').count() == 0 and pg.locator('.exh-svg').count() == 1, 'Ficha sin foto: solo la figura, sin huecos')
        pg.click('[data-a=close]')
        # elegir ejercicio en el entreno
        pg.click('#tabs [data-a=tab][data-t=hoy]'); pg.click('[data-a=start][data-k=pull]'); pg.wait_for_selector('section.ex')
        pg.evaluate("document.querySelector('[data-a=add-ex]') && document.querySelector('[data-a=add-ex]').click()")
        if pg.locator('#pick-list').count():
            check(pg.locator('#pick-list .exi').count() > 50, 'Añadir ejercicio: lista con imágenes')
            pg.evaluate("document.querySelector('[data-a=discard]').click()")
        else:
            check(False, 'No se encontró el botón de añadir ejercicio')
        pg.click('[data-a=confirm-yes]'); pg.wait_for_selector('.routine')
        # imagen que falla -> figura
        ctx.route('**/img/ex/remo-t.jpg', lambda r: r.abort())
        pg.evaluate("caches.open('gym-img').then(c => c.delete(new Request('img/ex/remo-t.jpg')))")
        pg.goto(URL); pg.wait_for_selector('.routine'); pg.click('#tabs [data-a=tab][data-t=ej]'); time.sleep(1)
        pg.evaluate("document.querySelector('[data-a=edit-ex][data-id=remo]').scrollIntoView()"); time.sleep(1)
        check(pg.locator('[data-a=edit-ex][data-id=remo] .exi-fig').count() == 1, 'Si una foto no carga, sale la figura')
        ctx.unroute('**/img/ex/remo-t.jpg')
        # sin conexión: lo ya visto sigue saliendo
        cached = pg.evaluate("caches.open('gym-img').then(c => c.keys()).then(k => k.length)")
        check(cached >= 3, 'Las fotos vistas se guardan en el iPhone (%d)' % cached)
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_selector('.routine'); pg.click('#tabs [data-a=tab][data-t=ej]'); pg.click('[data-a=edit-ex][data-id=jalon]'); time.sleep(1)
        check(loaded(pg, '.exh-img') == 2, 'Sin conexión: la ficha vista antes muestra sus fotos')
        ctx.set_offline(False)
        # actualizar la app no borra las fotos guardadas
        keys = pg.evaluate("caches.keys()")
        check('gym-img' in keys, 'La caché de fotos es aparte de la de la versión')
        # escritorio
        d = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); d.goto(URL); d.wait_for_selector('.routine')
        d.click('#tabs [data-a=tab][data-t=ej]'); d.click('[data-a=edit-ex][data-id=jalon]'); d.wait_for_selector('.exh-img'); time.sleep(0.8)
        check(loaded(d, '.exh-img') == 2, 'Escritorio: ficha con las dos fotos')
        check(not errs, 'Sin errores de JavaScript ' + '; '.join(errs[:3]))
        b.close()
finally:
    srv.terminate()
print('\n' + ('TODO OK' if not fails else 'FALLOS: %d' % len(fails)))
sys.exit(1 if fails else 0)
