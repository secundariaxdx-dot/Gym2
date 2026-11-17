# v3.2: clases dirigidas. Apuntar desde el calendario, con datos opcionales; salen en el día y en el
# registro de Perfil; cuentan en la fatiga de piernas; editar y borrar; migración aditiva.
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8779', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
acts = lambda pg: pg.evaluate("() => window.__gym.state.activities || []")
legs = lambda pg: pg.evaluate("() => window.__gym.E.activitiesAsSessions(window.__gym.state.activities).length")
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8779/'); pg.wait_for_selector('.routine')
        # datos de una versión anterior SIN ninguna clase: migración aditiva
        n0 = pg.evaluate("() => (window.__gym.state.activities || []).length")

        # --- apuntar una clase de spinning con datos opcionales, desde el calendario (hoy)
        pg.click('[data-t=cal]'); pg.wait_for_selector('.cal-grid')
        pg.click('.cal-d.today')
        check(pg.locator('#modal [data-a=class-add]').count() == 1, 'Botón «Apuntar clase dirigida» junto a fútbol y correr')
        pg.click('#modal [data-a=class-add]'); pg.wait_for_selector('#c-kind')
        check(pg.locator('#c-kind option').count() == 10, '10 tipos de clase')
        check(pg.locator('#c-dist').count() == 1, 'Spinning tiene su campo propio (distancia)')
        pg.select_option('#c-kind', 'Yoga'); pg.wait_for_timeout(100)
        check(pg.locator('#c-dist').count() == 0, 'Yoga no tiene campo de distancia')
        pg.select_option('#c-kind', 'Otra'); pg.wait_for_timeout(100)
        check(pg.locator('#c-other').count() == 1, '«Otra» pide nombre libre')
        pg.select_option('#c-kind', 'Spinning'); pg.wait_for_timeout(100)
        # sin duración no deja
        pg.click('[data-a=class-save]')
        check(not pg.locator('#c-err').is_hidden() and len(acts(pg)) == n0, 'Sin duración no se guarda')
        pg.fill('#c-min', '45'); pg.fill('#c-rpe', '8'); pg.fill('#c-kcal', '520'); pg.fill('#c-hrAvg', '142'); pg.fill('#c-dist', '22,5'); pg.fill('#c-notes', 'Buena sesión')
        pg.click('[data-a=class-save]')
        pg.wait_for_function("() => (window.__gym.state.activities || []).some(a => a.type === 'clase')", timeout=5000)
        a = [x for x in acts(pg) if x.get('type') == 'clase'][0]
        check(a['classKind'] == 'Spinning' and a['min'] == 45 and a['rpe'] == 8 and a['kcal'] == 520 and a['hrAvg'] == 142 and a['dist'] == 22.5 and a['notes'] == 'Buena sesión', 'Clase guardada con todos los datos: %s' % a)
        check('hrMax' not in a, 'Los campos en blanco no se guardan')

        # --- aparece en el calendario (icono + resumen)
        pg.wait_for_selector('.cal-grid')
        check(pg.locator('.cal-d.today .ic').inner_text().strip() != '', 'El día lleva el icono de la clase')
        check('🤸 1' in pg.inner_text('.cal-sum'), 'Resumen del mes cuenta la clase: ' + pg.inner_text('.cal-sum').replace('\n', ' '))
        pg.click('.cal-d.today')
        check('Spinning' in pg.inner_text('#modal') and '45 min' in pg.inner_text('#modal'), 'El día muestra la clase')
        pg.screenshot(path=OUT + '/c1-dia-clase.png')

        # --- cuenta en la fatiga de piernas (como correr)
        check(legs(pg) == 1, 'La clase de spinning cuenta en la fatiga de piernas')
        check(pg.evaluate("() => { const ps = window.__gym.E.activitiesAsSessions(window.__gym.state.activities); return ps[0].exercises.some(e => e.muscle === 'Cuádriceps'); }"), 'Spinning fatiga el cuádriceps')

        # --- una clase que no fatiga (yoga)
        # añadir yoga otro día (ayer)
        pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.activities.push({ id: 'cy', type: 'clase', classKind: 'Yoga', min: 60, t: Date.now() - 86400000, day: new Date(Date.now()-86400000).toISOString().slice(0,10) }); localStorage.setItem('gymapp.v1', JSON.stringify(s)); }""")
        pg.reload(); pg.wait_for_selector('.routine')
        check(legs(pg) == 1, 'El yoga no añade fatiga de piernas (sigue 1, solo el spinning)')

        # --- aparece en el registro de Perfil
        pg.click('[data-t=perfil]'); pg.wait_for_selector('.tiles')
        check(pg.locator('.card.clz').count() == 2, 'Las 2 clases salen en el registro de Perfil')
        c0 = pg.locator('.card.clz').first.inner_text()
        check('Spinning' in c0 and '45 min' in c0 and '8/10' in c0 and '22,5 km' in c0 and '520 kcal' in c0 and 'Buena sesión' in c0, 'Tarjeta de clase con sus datos: ' + c0.replace('\n', ' '))
        check(any('ACTIVIDAD' in t.upper() for t in pg.locator('h3.sec').all_inner_texts()), 'El registro se titula «Actividad» cuando hay clases')
        pg.locator('.card.clz').first.scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/c2-registro-clase.png')

        # --- editar y borrar (con Deshacer)
        pg.locator('.card.clz').first.click(); pg.wait_for_selector('#c-min')
        check(pg.input_value('#c-min') == '45' and pg.input_value('#c-rpe') == '8', 'Editar: trae los datos')
        pg.fill('#c-min', '50'); pg.click('[data-a=class-save]'); pg.wait_for_timeout(300)
        check([x for x in acts(pg) if x['id'] == a['id']][0]['min'] == 50, 'Editar guarda el cambio')
        pg.locator('.card.clz').first.click(); pg.wait_for_selector('[data-a=class-del]')
        pg.click('[data-a=class-del]'); pg.wait_for_timeout(300)
        check(pg.locator('.card.clz').count() == 1, 'Borrar quita la clase')
        pg.click('#toast [data-a=undo]'); pg.wait_for_timeout(300)
        check(pg.locator('.card.clz').count() == 2, 'Deshacer la recupera')

        # --- clase mínima: solo duración, todo lo demás en blanco
        pg.click('[data-t=cal]'); pg.click('.cal-d.today'); pg.click('#modal [data-a=class-add]'); pg.wait_for_selector('#c-kind')
        pg.select_option('#c-kind', 'Pilates'); pg.wait_for_timeout(100); pg.fill('#c-min', '30'); pg.click('[data-a=class-save]')
        pg.wait_for_function("() => window.__gym.state.activities.filter(a => a.type === 'clase').length === 3", timeout=5000)
        pm = [x for x in acts(pg) if x.get('classKind') == 'Pilates'][0]
        check(pm['min'] == 30 and 'rpe' not in pm and 'kcal' not in pm and 'notes' not in pm, 'Clase solo con duración: el resto vacío')
        pg.click('[data-t=perfil]'); pg.wait_for_selector('.card.clz')
        pil = [c for c in pg.locator('.card.clz').all() if 'Pilates' in c.inner_text()][0]
        check('30 min' in pil.inner_text() and 'Intensidad' not in pil.inner_text(), 'Pilates sin datos opcionales se ve bien')

        # tema claro
        ctx2 = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='light')
        p2 = ctx2.new_page(); p2.goto('http://localhost:8779/'); p2.wait_for_selector('.routine')
        p2.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.activities = s.activities || []; s.activities.push({ id: 'cx', type: 'clase', classKind: 'Boxeo', min: 40, rpe: 9, rounds: 6, t: Date.now(), day: new Date().toISOString().slice(0,10) }); localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        p2.reload(); p2.wait_for_selector('.routine'); p2.click('[data-t=perfil]'); p2.wait_for_selector('.card.clz')
        p2.locator('.card.clz').first.scroll_into_view_if_needed(); p2.screenshot(path=OUT + '/c3-clase-claro.png')
        ctx2.close(); b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
