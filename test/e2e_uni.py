"""v3.7: ejercicios unilaterales (ronda de dos lados con el mismo peso y reps, descanso entre lados y entre series)."""
import subprocess, sys, time, os
import _pau  # noqa
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8776', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://localhost:8776/'
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
G = 'window.__gym'
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector('.routine')
        ex = lambda id: pg.evaluate("id => window.__gym.state.exercises.find(e => e.id === id)", id)

        # --- nada se marca solo
        check(not any(e.get('uni') for e in pg.evaluate(G + '.state.exercises')), 'Ningún ejercicio sale marcado como unilateral por defecto')

        # --- marcar «Martillo unilateral en polea» como unilateral desde su ficha
        pg.click('#tabs [data-a=tab][data-t=ej]'); pg.click('[data-a=edit-ex][data-id=martillo]')
        check(pg.locator('#f-uni-box').is_hidden(), 'Ficha: las opciones unilaterales están ocultas mientras es bilateral')
        pg.check('#f-uni'); check(pg.locator('#f-uni-box').is_visible(), 'Al activar «Unilateral» aparecen sus opciones')
        check(pg.input_value('#f-rside') == '60', 'Descanso entre lados propuesto: 60 s')
        pg.fill('#f-rside', '45'); pg.click('[data-a=exedit-save]'); time.sleep(0.2)
        m = ex('martillo')
        check(m.get('uni') is True and m.get('restSide') == 45 and m.get('uniFirst') == 'L', 'Se guarda: unilateral, 45 s entre lados, empieza izquierda')

        # --- entreno Pull
        pg.click('#tabs [data-a=tab][data-t=hoy]'); pg.click('[data-a=start][data-k=pull]'); pg.wait_for_selector('section.ex')
        i = pg.evaluate(G + ".state.active.entries.findIndex(e => e.exId === 'martillo')")
        pg.click('[data-a=toggle][data-i="%d"]' % i); pg.wait_for_selector('.uni-panel')
        sec = 'section.ex.open'
        check('Unilateral' in pg.inner_text(sec + ' .ex-head'), 'Indicador «Unilateral» en el ejercicio')
        check('Serie 1 de 2' in pg.inner_text('.uni-panel') and 'Primer lado: izquierdo' in pg.inner_text('.uni-panel'), 'Panel: «Serie 1 de 2 · Primer lado: izquierda»')
        check(pg.inner_text('.uni-go').strip() == 'Terminar izquierda', 'Botón grande «Terminar izquierda»')
        hgt = pg.evaluate("document.querySelector('.uni-go').getBoundingClientRect().height")
        check(hgt >= 54, 'El botón es grande (%d px de alto)' % hgt)

        # primer lado: 12 kg × 12
        pg.fill(sec + ' input[data-f=w][data-j="0"]', '12'); pg.fill(sec + ' input[data-f=r][data-j="0"]', '12')
        pg.click('.uni-go'); time.sleep(0.2)
        st = pg.evaluate(G + '.state.active.entries[%d].sets[0]' % i); t = pg.evaluate(G + '.state.timer')
        check(st.get('half') == 'L' and not st['done'], 'Tras «Terminar izquierda»: lado izquierdo hecho, ronda sin completar')
        check(t and t.get('kind') == 'side' and t['total'] == 45, 'Empieza el descanso entre lados (45 s)')
        check(pg.text_content('#timer .tl') == 'Entre lados', 'La barra de descanso dice «Entre lados»')
        check(pg.inner_text('.uni-go').strip() == 'Terminar derecha' and 'Ahora: lado derecho' in pg.inner_text('.uni-panel'), 'Ahora toca la derecha, sin volver a escribir')
        check(pg.evaluate(G + '.state.active.entries[%d].sets.filter(s => s.done).length' % i) == 0, 'El ejercicio no cuenta series hechas todavía')

        # corregir reps antes del segundo lado
        pg.fill(sec + ' input[data-f=r][data-j="0"]', '11'); time.sleep(0.7)
        check(str(pg.evaluate(G + '.state.active.entries[%d].sets[0].r' % i)) == '11' and pg.evaluate(G + '.state.active.entries[%d].sets[0].half' % i) == 'L', 'Cambiar las reps no pierde el lado hecho')

        # cerrar y abrir la app: se conserva la ronda y el descanso
        pg.reload(); pg.wait_for_selector('.uni-panel')
        st = pg.evaluate(G + '.state.active.entries[%d].sets[0]' % i); t = pg.evaluate(G + '.state.timer')
        check(st.get('half') == 'L' and t and t.get('kind') == 'side', 'Tras cerrar y abrir: sigue «falta la derecha» y el descanso entre lados')

        # fin del descanso entre lados
        pg.evaluate(G + '.state.timer.end = Date.now() - 500'); time.sleep(0.6)
        check(pg.inner_text('#timer .t') == 'Toca derecha', 'Al acabar el descanso: «Toca derecha»')

        # segundo lado
        pg.click('.uni-go'); time.sleep(0.2)
        s0 = pg.evaluate(G + '.state.active.entries[%d].sets[0]' % i); t = pg.evaluate(G + '.state.timer')
        check(s0['done'] and s0['w'] == 12 and s0['r'] == 11, 'Ronda completada con 12 kg × 11 (sin escribir otra vez)')
        check(t['kind'] == 'round' and t['total'] == 120, 'Empieza el descanso entre series (2 min por defecto)')
        check(pg.text_content('#timer .tl') == 'Entre series', 'La barra dice «Entre series»')
        check(pg.evaluate(G + '.state.active.entries[%d].sets.length' % i) == 2, 'No se crean series duplicadas')
        check('Serie 2 de 2' in pg.inner_text('.uni-panel'), 'Panel pasa a «Serie 2 de 2»')
        pg.evaluate(G + '.state.timer.end = Date.now() - 500'); time.sleep(0.6)
        check(pg.inner_text('#timer .t') == 'Siguiente serie', 'Al acabar: «Siguiente serie»')

        # elegir que empiece la derecha (se recuerda en el ejercicio)
        pg.click('[data-a=side-first][data-v=R]'); time.sleep(0.2)
        check(ex('martillo').get('uniFirst') == 'R' and pg.inner_text('.uni-go').strip() == 'Terminar derecha', '«Empieza por derecha» se guarda en el ejercicio')
        pg.click('.uni-go'); time.sleep(0.2)
        check(pg.evaluate(G + '.state.active.entries[%d].sets[1].half' % i) == 'R' and pg.inner_text('.uni-go').strip() == 'Terminar izquierda', 'Serie 2: primero derecha, luego izquierda')
        # deshacer el lado
        pg.click('[data-a=side-undo]'); time.sleep(0.2)
        check(not pg.evaluate(G + '.state.active.entries[%d].sets[1].half' % i) and pg.evaluate(G + '.state.timer') is None, '«Deshacer lado» quita el lado y su descanso')
        pg.click('.uni-go'); time.sleep(0.2)  # vuelve a hacer el primer lado y se olvida del segundo

        # corregir una ronda ya hecha: sigue hecha con el dato nuevo
        pg.fill(sec + ' input[data-f=w][data-j="0"]', '13'); time.sleep(0.7)
        s0 = pg.evaluate(G + '.state.active.entries[%d].sets[0]' % i)
        check(s0['done'] and str(s0['w']) == '13', 'Corregir el peso de una ronda hecha no la reabre')

        # un bilateral en el mismo entreno funciona como siempre
        pg.click('[data-a=toggle][data-i="0"]'); time.sleep(0.2)
        pg.click('section.ex.open .chk >> nth=0'); time.sleep(0.2)
        t = pg.evaluate(G + '.state.timer')
        check(pg.evaluate(G + '.state.active.entries[0].sets[0].done') and 'kind' not in t, 'Bilateral: un toque marca la serie, descanso normal')
        check(pg.text_content('#timer .tl') == 'Descanso', 'Bilateral: la barra dice «Descanso»')
        check(pg.locator('section.ex.open .uni-panel').count() == 0, 'Bilateral: sin panel de lados')

        # terminar: la ronda a medias (serie 2) NO se guarda
        pg.click('[data-a=finish]'); pg.wait_for_selector('[data-a=finish-yes]')
        check('sin marcar no se guardarán' in pg.inner_text('#modal'), 'Al terminar avisa de lo que no se guardará')
        pg.click('[data-a=finish-yes]'); time.sleep(0.4)
        sess = pg.evaluate(G + '.state.sessions[' + G + '.state.sessions.length - 1]')
        mx = [x for x in sess['exercises'] if x['exId'] == 'martillo']
        check(len(mx) == 1 and len(mx[0]['sets']) == 1 and mx[0]['sets'][0] == {'w': 13, 'r': 11}, 'Se guarda solo la ronda completa (13 kg × 11), una vez')
        check(mx and mx[0].get('uni') is True, 'La sesión marca el ejercicio como unilateral')
        check(pg.evaluate(G + '.state.active') is None, 'Entreno cerrado')

        # la próxima vez propone a partir de esa ronda
        pg.click('[data-a=close]') if pg.locator('[data-a=close]').count() else None
        pg.evaluate("document.querySelector('#modal [data-a=close]') && document.querySelector('#modal [data-a=close]').click()")
        plan = pg.evaluate("(() => { const G = window.__gym, x = G.state.exercises.find(e => e.id==='martillo'); return G.E.planSets(x, G.E.reference(x, G.state.sessions)); })()")
        check(plan[0]['w'] >= 13, 'La progresión sigue funcionando con la ronda guardada (%s kg)' % plan[0]['w'])

        # volver a bilateral
        pg.click('#tabs [data-a=tab][data-t=ej]'); pg.click('[data-a=edit-ex][data-id=martillo]'); pg.uncheck('#f-uni'); pg.click('[data-a=exedit-save]'); time.sleep(0.2)
        check(ex('martillo').get('uni') is False, 'Se puede volver a bilateral')
        check(not errs, 'Sin errores de JavaScript ' + '; '.join(errs[:3]))
        b.close()
finally:
    srv.terminate()
print('\n' + ('TODO OK' if not fails else 'FALLOS: %d' % len(fails)))
sys.exit(1 if fails else 0)
