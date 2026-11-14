# v1.10: franja compacta, biblioteca plegada, "1 día", ir al siguiente ejercicio, deshacer,
# reordenar ejercicios, vibración, reloj solo cuando hace falta y guardado aplazado.
import subprocess, sys, time, os, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8773', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
# una sesión de Pull hace 3 días (mismo mes salvo a principios de mes: se calcula abajo)
HIST = """() => {
  const s = JSON.parse(localStorage.getItem('gymapp.v1')), now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 1), 10).getTime();
  s.sessions.push({ id: 'h1', t: d, t0: d - 3600000, key: 'pull', name: 'Pull', prs: [], exercises: [
    { exId: 'jalon', name: 'Jalón al pecho (máquina)', muscle: 'Dorsales', sec: ['Bíceps'], fatigue: 2, sets: [{ w: 100, r: 10 }] } ] });
  localStorage.setItem('gymapp.v1', JSON.stringify(s));
}"""
stored = lambda pg: json.loads(pg.evaluate("() => localStorage.getItem('gymapp.v1')"))
names = lambda pg: pg.locator('section.ex .ex-head .ex-name').all_inner_texts()
G = '() => window.__gym'

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8773/'); pg.wait_for_selector('.routine')
        pg.evaluate(HIST); pg.reload(); pg.wait_for_selector('.routine')

        # --- v2.0: resumen de la semana en Hoy
        check(pg.locator('.week .wk-d').count() == 7 and pg.locator('.week .wk-d.today').count() == 1, 'Hoy: semana con 7 días y hoy marcado')
        ngym = pg.locator('.week .wk-d.gym').count()
        check(ngym >= 0 and (('%d' % ngym) in pg.inner_text('.wk-n') or ngym == 0), 'Semana: %s' % pg.inner_text('.wk-n'))
        pg.click('.week'); check(pg.locator('.cal-grid').count() == 1, 'Tocar la semana abre el calendario')
        pg.click('[data-t=hoy]')

        # --- 12: reloj parado sin entreno
        pg.wait_for_timeout(400)
        check(pg.evaluate('() => window.__gym.clockOn') is False, 'Reloj interno parado sin entreno ni descanso')
        check(pg.locator('#dock').is_hidden(), 'Sin entreno no hay franja')

        # --- 5: singular
        pg.click('[data-t=cal]')
        check('1 día de gimnasio' in pg.inner_text('.cal-sum'), 'Calendario: ' + pg.inner_text('.cal-sum').split('\n')[0].strip())

        # --- 3: biblioteca plegada
        pg.click('[data-t=ej]'); pg.wait_for_selector('#ex-list')
        check(pg.locator('#ex-list .item.mine').count() == 17 and pg.locator('#ex-list .item.lib').count() == 0, 'Ejercicios: solo los míos, biblioteca plegada')
        h_closed = pg.evaluate('() => document.documentElement.scrollHeight')
        pg.screenshot(path=OUT + '/70-biblioteca-plegada.png')
        pg.click('[data-a=lib-tog]')
        check(pg.locator('#ex-list .item.lib').count() == 105, 'Ver: muestra los 105 de la biblioteca')
        check(pg.evaluate('() => document.documentElement.scrollHeight') > h_closed * 2, 'La página plegada es mucho más corta (%d px)' % h_closed)
        pg.click('[data-a=lib-tog]')
        check(pg.locator('#ex-list .item.lib').count() == 0, 'Ocultar la pliega')
        pg.fill('#q', 'hack')
        check(pg.locator('#ex-list .item.lib').count() >= 1, 'Al buscar se muestra la biblioteca sola')
        pg.fill('#q', '')
        check(pg.locator('#ex-list .item.lib').count() == 0, 'Sin búsqueda vuelve a plegarse')

        # --- entreno
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.wait_for_timeout(300)
        check(pg.evaluate('() => window.__gym.clockOn') is True, 'Reloj en marcha durante el entreno')
        order0 = names(pg)

        # --- 13: guardado aplazado
        pg.locator('section.ex.open input[data-f=r][data-j="0"]').press_sequentially('7', delay=20)
        check(stored(pg)['active']['entries'][0]['sets'][0]['r'] == '', 'Al escribir no guarda en cada tecla')
        pg.wait_for_timeout(800)
        check(stored(pg)['active']['entries'][0]['sets'][0]['r'] == '7', 'Guarda al parar de escribir')
        pg.locator('section.ex.open input[data-f=r][data-j="0"]').fill('9')
        pg.reload(); pg.wait_for_selector('header.top h1')
        check(pg.input_value('section.ex.open input[data-f=r][data-j="0"]') == '9', 'Si cierras justo después de escribir, no se pierde')

        pg.click('section.ex.open .chk >> nth=0')

        # --- 1: franja compacta
        dock = pg.locator('#dock').bounding_box(); tb = pg.locator('#timer').bounding_box(); wb = pg.locator('#wprog').bounding_box(); nb = pg.locator('#tabs').bounding_box()
        check(dock['height'] <= 76, 'Descanso + progreso en una franja de %d px (antes 114)' % dock['height'])
        check(abs(dock['y'] + dock['height'] - nb['y']) <= 1.5 and tb['y'] + tb['height'] <= wb['y'] + 0.5, 'Franja pegada a las pestañas, sin solapes')
        check(dock['x'] == 0 and dock['width'] == 375, 'Ocupa todo el ancho')
        btns = pg.locator('#timer button').evaluate_all('els => els.map(e => e.getBoundingClientRect()).map(r => [Math.round(r.height), Math.round(r.right)])')
        check(all(h >= 38 for h, r in btns) and max(r for h, r in btns) <= 375, 'Botones del descanso cómodos y dentro de la pantalla: %s' % btns)
        last = pg.locator('section.ex').last.bounding_box()
        pg.wait_for_timeout(2800); pg.screenshot(path=OUT + '/71-franja-compacta.png')
        pg.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_timeout(200)
        db = pg.locator('[data-a=discard]').bounding_box(); dk = pg.locator('#dock').bounding_box()
        check(db['y'] + db['height'] <= dk['y'], 'La franja no tapa el final de la página')
        pg.evaluate('() => window.scrollTo(0, 0)')

        # --- 10: reordenar
        check(pg.locator('section.ex.open [data-a=ex-up]').is_disabled(), 'El primero no puede subir')
        pg.click('section.ex.open [data-a=ex-down]')
        o1 = names(pg)
        check(o1[0] == order0[1] and o1[1] == order0[0], 'Bajar mueve el ejercicio una posición')
        check(pg.locator('section.ex').nth(1).get_attribute('class').find('open') >= 0, 'Sigue abierto el que has movido')
        check(pg.evaluate("() => window.__gym.state.active.entries[1].sets[0].done") is True, 'Conserva sus series marcadas')
        pg.click('section.ex.open [data-a=ex-up]')
        check(names(pg) == order0, 'Subir lo devuelve a su sitio')
        # mover el último arriba del todo queda guardado en el orden del entreno
        n = len(order0)
        pg.locator('section.ex').last.locator('[data-a=toggle]').click()
        check(pg.locator('section.ex.open [data-a=ex-down]').is_disabled(), 'El último no puede bajar')
        pg.click('section.ex.open [data-a=ex-up]')
        check(names(pg)[n - 2] == order0[n - 1], 'El último sube una posición')
        pg.click('section.ex.open [data-a=ex-down]')
        pg.locator('section.ex').first.locator('[data-a=toggle]').click()

        # --- 9: deshacer quitar ejercicio (con series marcadas pregunta antes)
        pg.click('section.ex.open [data-a=rm-ex]')
        check(pg.locator('[data-a=confirm-yes]').count() == 1, 'Con series marcadas pregunta antes de quitar')
        pg.click('[data-a=confirm-yes]')
        check(len(names(pg)) == n - 1 and pg.locator('#toast [data-a=undo]').is_visible(), 'Quitado, con botón Deshacer')
        pg.click('#toast [data-a=undo]')
        check(names(pg) == order0 and pg.evaluate("() => window.__gym.state.active.entries[0].sets[0].done") is True, 'Deshacer devuelve el ejercicio con sus series')

        # --- 7: ir solo al siguiente ejercicio
        pg.click('[data-a=t-x]')
        pg.click('section.ex.open .chk >> nth=1'); pg.click('[data-a=t-x]')
        row = pg.locator('section.ex.open .chk').nth(2)
        pg.evaluate("() => { const r = document.querySelectorAll('section.ex.open .chk')[2].getBoundingClientRect(); window.scrollBy(0, r.top - 20); }")
        pg.wait_for_timeout(200)
        row.click(); pg.wait_for_timeout(900)
        top = pg.locator('section.ex.open').bounding_box()['y']
        check(pg.locator('section.ex').nth(1).get_attribute('class').find('open') >= 0 and 0 <= top <= 120, 'Al acabar un ejercicio, la pantalla va al siguiente (arriba a %d px)' % top)
        pg.click('[data-a=t-x]')
        # si el siguiente ya está hecho, salta al primero con series pendientes
        pg.locator('section.ex').nth(3).locator('[data-a=toggle]').click()
        k = pg.locator('section.ex.open .chk').count()
        for j in range(k):
            pg.locator('section.ex.open .chk').nth(j).click(); pg.click('[data-a=t-x]')
        check(pg.locator('section.ex').nth(4).get_attribute('class').find('open') >= 0, 'Sigue con el de después')
        pg.locator('section.ex').nth(2).locator('[data-a=toggle]').click()
        k = pg.locator('section.ex.open .chk').count()
        for j in range(k):
            pg.locator('section.ex.open .chk').nth(j).click(); pg.click('[data-a=t-x]')
        check(pg.locator('section.ex').nth(4).get_attribute('class').find('open') >= 0, 'Se salta el que ya está hecho')

        # la vibración experimental se retiró en la v2.0
        pg.click('[data-t=aj]')
        check(pg.locator('[data-f=haptic]').count() == 0, 'Sin ajuste de vibración')
        sw = pg.locator('[data-f=sound]').bounding_box()
        check(sw['width'] >= 50 and 30 <= sw['height'] <= 32, 'Interruptores con forma de interruptor (%dx%d)' % (sw['width'], sw['height']))
        pg.click('[data-t=hoy]')
        pg.click('section.ex.open .chk >> nth=0'); pg.click('[data-a=t-x]')

        # --- terminar: orden cambiado ofrece guardar en la rutina; borrar sesión con Deshacer
        pg.click('[data-a=finish]'); pg.click('[data-a=finish-yes]'); pg.wait_for_selector('#modal h2'); pg.click('#modal [data-a=close]')
        pg.wait_for_timeout(500)
        check(pg.evaluate('() => window.__gym.clockOn') is False, 'Reloj parado al terminar el entreno')
        nses = pg.evaluate('() => window.__gym.state.sessions.length')
        pg.click('[data-t=prog]'); pg.locator('[data-a=hist]').first.click()
        pg.click('[data-a=del-sess]'); pg.click('[data-a=confirm-yes]')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == nses - 1, 'Sesión borrada')
        pg.click('#toast [data-a=undo]')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == nses and stored(pg)['sessions'][-1]['name'] == 'Push', 'Deshacer recupera la sesión')
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
