import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8767', '-d', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # Datos antiguos de la v1.1 (sin activities ni actFatigue) siguen funcionando
        pg.goto('http://localhost:8767/'); pg.wait_for_selector('.routine')
        pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); delete s.activities; delete s.settings.actFatigue; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }""")
        pg.reload(); pg.wait_for_selector('.routine')
        check(pg.evaluate('Array.isArray(window.__gym.state.activities) && window.__gym.state.settings.actFatigue === true'), 'Migra datos de la v1.1')
        check(pg.locator('.tab').count() == 5, '5 pestañas')

        # --- Calendario: marcar fútbol hoy
        pg.click('[data-t=cal]'); pg.wait_for_selector('.cal-grid')
        check(pg.locator('.cal-d.today').count() == 1, 'Marca el día de hoy')
        pg.click('.card [data-a=act][data-type=futbol]')
        check(pg.evaluate("window.__gym.state.activities.length") == 1, 'Fútbol anotado hoy')
        check('⚽' in pg.locator('.cal-d.today').inner_text(), 'Icono de fútbol en el calendario')
        check(pg.locator('.card [data-a=act][data-type=futbol].on').count() == 1, 'Botón de fútbol marcado')
        # día pasado: correr
        past = pg.locator('.cal-d[data-a=day]').first
        past_key = past.get_attribute('data-d')
        if pg.evaluate("new Date().getDate()") > 1:
            past.click(); pg.wait_for_selector('#modal .sheet')
            pg.click('#modal [data-a=act][data-type=correr]')
            check('✓' in pg.locator('#modal [data-a=act][data-type=correr]').inner_text(), 'Correr marcado en un día pasado')
            pg.click('#modal [data-a=close]')
            check('👟' in pg.locator('.cal-d[data-d="%s"]' % past_key).inner_text(), 'Icono de zapatilla en ese día')
        check(pg.locator('.cal-d.fut[disabled]').count() >= 0, 'Días futuros desactivados')
        pg.screenshot(path=OUT + '/20-calendario.png', full_page=True)

        # fatiga: piernas descansando tras el fútbol
        pg.click('[data-t=hoy]'); pg.wait_for_selector('.routine')
        legs = pg.locator('.routine').nth(2).inner_text()
        check('Isquios' in legs or 'Cuádriceps' in legs, 'Piernas avisa tras el fútbol: ' + legs.replace('\n', ' | ')[:90])
        # interruptor en ajustes
        pg.click('[data-t=perfil]'); pg.click('[data-t=aj]'); pg.click('[data-f=actFatigue]')
        pg.click('[data-t=hoy]'); pg.wait_for_selector('.routine')
        check('Isquios' not in pg.locator('.routine').nth(2).inner_text(), 'Con el interruptor apagado no cuenta')
        pg.click('[data-t=perfil]'); pg.click('[data-t=aj]'); pg.click('[data-f=actFatigue]')

        # --- Récord al marcar la serie
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('section.ex.open')
        pg.fill('section.ex.open input[data-f=r][data-j="0"]', '10')   # 105x10 > 105x7 anterior
        pg.click('section.ex.open .chk >> nth=0')
        check(pg.locator('#pr:not([hidden])').count() == 1, 'Aparece la animación de récord')
        check(pg.locator('canvas.confetti').count() == 1, 'Confeti en pantalla')
        check('🏆' in pg.locator('section.ex.open .set:not(.head)').first.inner_text(), 'Trofeo en la fila de la serie')
        pg.wait_for_timeout(400)
        pg.screenshot(path=OUT + '/21-record.png')
        pg.wait_for_timeout(2600)
        check(pg.locator('#pr[hidden]').count() == 1 and pg.locator('canvas.confetti').count() == 0, 'La animación desaparece sola')
        # desmarcar quita el trofeo
        pg.click('section.ex.open .chk >> nth=0')
        check('🏆' not in pg.locator('section.ex.open .set:not(.head)').first.inner_text(), 'Desmarcar quita el trofeo')
        pg.click('section.ex.open .chk >> nth=0')
        # serie normal, sin récord
        pg.fill('section.ex.open input[data-f=r][data-j="1"]', '9')
        pg.click('section.ex.open .chk >> nth=1')
        check('🏆' not in pg.locator('section.ex.open .set:not(.head)').nth(1).inner_text(), 'Serie sin récord no lleva trofeo')
        # segundo ejercicio: una serie que baja
        pg.click('[data-a=timer-x]') if pg.locator('[data-a=timer-x]').count() else None
        pg.locator('section.ex .ex-head').nth(1).click()
        pg.fill('section.ex.open input[data-f=r][data-j="0"]', '8')
        pg.click('section.ex.open .chk >> nth=0')

        # --- Terminar: resumen con análisis
        pg.click('[data-a=finish]'); pg.click('[data-a=finish-yes]')
        pg.wait_for_selector('#modal h2')
        txt = pg.locator('#modal .sheet').inner_text()
        check('Análisis' in txt or 'ANÁLISIS' in txt, 'El resumen incluye el análisis')
        check('Press de pecho inclinado' in txt and 'Mejoras' in txt, 'Análisis del press inclinado: mejora')
        check('rendido algo menos' in txt, 'Análisis del press en cable: rinde menos')
        check('series/sem' in txt, 'Muestra volumen semanal por músculo')
        pg.wait_for_timeout(300)
        pg.screenshot(path=OUT + '/22-analisis.png', full_page=False)
        sh = pg.locator('#modal .sheet'); sh.evaluate('e => e.scrollTop = e.scrollHeight'); pg.screenshot(path=OUT + '/23-analisis-2.png')
        pg.click('#modal [data-a=close]')

        # Historial muestra el análisis
        pg.click('[data-t=perfil]'); pg.locator('[data-a=sess]').first.click()
        check('Mejoras' in pg.locator('#app').inner_text(), 'El análisis queda en el detalle del entreno (Perfil)')

        # calendario marca el día de gimnasio
        pg.click('[data-t=cal]'); pg.wait_for_selector('.cal-grid')
        check(pg.locator('.cal-d.today.gym').count() == 1, 'Hoy aparece como día de gimnasio')
        pg.click('.cal-d.today'); pg.wait_for_selector('#modal .sheet')
        check('Push' in pg.locator('#modal').inner_text(), 'El día muestra el entreno')
        pg.screenshot(path=OUT + '/24-dia.png'); pg.click('#modal [data-a=close]')

        # --- Aplicar sugerencia de series (simulada: dos bajadas seguidas)
        pg.evaluate("""() => {
          const s = window.__gym.state, now = Date.now(), D = 86400000;
          const mk = (id, t, r) => ({id, t, key:'pull', name:'Pull', prs:[], exercises:[{exId:'jalon', name:'Jalón al pecho (máquina)', muscle:'Dorsales', sec:[], fatigue:2, sets:[{w:105,r},{w:85,r},{w:85,r}]}]});
          s.sessions.push(mk('a1', now - 6*D, 12), mk('a2', now - 3*D, 10));
          s.exercises.find(e => e.id === 'jalon').baseline.t = now - 10*D;
          localStorage.setItem('gymapp.v1', JSON.stringify(s));
        }""")
        pg.reload(); pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=pull]'); pg.wait_for_selector('section.ex.open')
        for j in range(3):
            pg.fill('section.ex.open input[data-f=r][data-j="%d"]' % j, '8'); pg.click('section.ex.open .chk >> nth=%d' % j)
        pg.click('[data-a=finish]'); pg.click('[data-a=finish-yes]'); pg.wait_for_selector('#modal h2')
        check(pg.locator('[data-a=an-apply]').count() >= 1, 'Propone −1 serie tras dos bajadas')
        pg.click('[data-a=an-apply] >> nth=0')
        check(pg.evaluate("window.__gym.state.exercises.find(e => e.id === 'jalon').sets") == 2, 'Aplicar deja el jalón en 2 series')
        check(pg.locator('#modal .chip.ok', has_text='Aplicado').count() == 1, 'Marca la sugerencia como aplicada')
        pg.click('#modal [data-a=close]')
        pg.click('[data-a=start][data-k=pull]'); pg.wait_for_selector('section.ex.open')
        check(pg.locator('section.ex.open .set:not(.head)').count() == 2, 'El siguiente entreno ya tiene 2 series')
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
