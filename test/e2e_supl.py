"""v3.5: suplementos (Perfil → Suplementos). Privados: no entran en lo que se comparte con el grupo."""
import subprocess, sys, time, os, json
import _pau  # noqa
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8772', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8772/'); pg.wait_for_selector('.routine')
        pg.click('#tabs [data-a=tab][data-t=perfil]')
        check(pg.locator('.supp-empty').count() == 1, 'Perfil sin suplementos: tarjeta para añadir')
        pg.click('.supp-empty'); pg.wait_for_selector('h1:text("Suplementos")')
        check('Aún no has añadido' in pg.inner_text('#app'), 'Estado vacío en Suplementos')
        # crear: creatina cada día 08:00 y 21:00
        pg.click('[data-a=supp-new]'); pg.click('[data-a=supp-save]')
        check(pg.locator('#sp-err:not([hidden])').count() == 1, 'Sin nombre: avisa y no guarda')
        pg.fill('#sp-name', 'Creatina'); pg.fill('#sp-dose', '5'); pg.select_option('#sp-unit', 'g')
        pg.click('[data-a=sp-time-add]'); pg.fill('[data-f=sp-time][data-k="0"]', '08:00')
        pg.click('[data-a=sp-time-add]'); pg.fill('[data-f=sp-time][data-k="1"]', '21:00')
        check(pg.input_value('#sp-name') == 'Creatina', 'Lo escrito se conserva al añadir horas')
        pg.click('[data-a=supp-save]'); time.sleep(0.2)
        st = pg.evaluate('window.__gym.state')
        check(len(st['supps']) == 1 and st['supps'][0]['times'] == ['08:00', '21:00'] and st['supps'][0]['dose'] == 5, 'Se guarda creatina 5 g a las 08:00 y 21:00')
        # dosis decimal y días concretos
        pg.click('[data-a=supp-new]'); pg.fill('#sp-name', 'Vitamina D'); pg.fill('#sp-dose', '0,25'); pg.select_option('#sp-unit', 'mg')
        pg.select_option('#sp-freq', 'dias'); pg.click('[data-a=supp-save]')
        check(pg.locator('#sp-err:not([hidden])').count() == 1, 'Algunos días sin elegir día: avisa')
        check(pg.input_value('#sp-name') == 'Vitamina D', 'Cambiar frecuencia conserva el nombre')
        for i in range(7): pg.click('[data-a=sp-day][data-k="%d"]' % i)
        pg.click('[data-a=supp-save]'); time.sleep(0.2)
        check('0,25 mg' in pg.inner_text('#app'), 'Dosis decimal se muestra tal cual (0,25 mg)')
        # a demanda
        pg.click('[data-a=supp-new]'); pg.fill('#sp-name', 'Cafeína'); pg.select_option('#sp-freq', 'demanda'); pg.click('[data-a=supp-save]'); time.sleep(0.2)
        pg.click('[data-a=supp-take]'); time.sleep(0.2)
        check('hoy 1 toma' in pg.inner_text('#app'), 'A demanda: «+ Toma» suma una toma de hoy')
        # marcar tomas de hoy
        rows = pg.locator('[data-a=supp-tick]')
        check(rows.count() == 3, 'Hoy: 3 tomas programadas (2 creatina + 1 vitamina D)')
        rows.first.click(); time.sleep(0.2)
        check(pg.locator('.supp-row.done').count() == 1, 'Marcar una toma la deja hecha')
        pg.locator('.supp-row.done').first.click(); time.sleep(0.2)
        check(pg.locator('.supp-row.done').count() == 0, 'Tocar otra vez la desmarca')
        pg.locator('[data-a=supp-tick]').first.click(); time.sleep(0.2)
        # Perfil muestra resumen del día
        pg.click('.back'); pg.wait_for_selector('#supp-card')
        check('1 de 3 tomas' in pg.inner_text('#supp-card'), 'Perfil: «1 de 3 tomas» hoy')
        pg.locator('#supp-card [data-a=supp-tick]').nth(1).click(); time.sleep(0.2)
        check('2 de 3 tomas' in pg.inner_text('#supp-card'), 'Se puede marcar desde Perfil')
        # pausar
        pg.click('#supp-card [data-a=tab][data-t=supl]'); pg.wait_for_selector('[data-a=supp-edit]')
        pg.locator('[data-a=supp-edit]').nth(1).click(); pg.click('[data-a=supp-pause]'); time.sleep(0.2)
        check('En pausa' in pg.inner_text('#app') and pg.locator('[data-a=supp-tick]').count() == 2, 'Pausar: sale «En pausa» y no cuenta hoy')
        pg.locator('[data-a=supp-edit]').nth(1).click(); pg.click('[data-a=supp-pause]'); time.sleep(0.2)
        check(pg.locator('[data-a=supp-tick]').count() == 3, 'Reanudar: vuelve a contar')
        # editar
        pg.locator('[data-a=supp-edit]').first.click(); pg.fill('#sp-dose', '3'); pg.click('[data-a=supp-save]'); time.sleep(0.2)
        check(pg.evaluate('window.__gym.state.supps[0].dose') == 3, 'Editar la dosis')
        # historial: simular ayer
        pg.evaluate('''() => { const G = window.__gym, d = new Date(); d.setDate(d.getDate()-1); const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          const sp = G.state.supps[0]; sp.created = 0; G.state.suppLog[k] = {}; G.state.suppLog[k][sp.id+'@08:00'] = {t: d.getTime(), n: sp.name}; }''')
        pg.click('.back'); pg.click('#supp-card [data-a=tab][data-t=supl]'); pg.wait_for_selector('[data-a=supp-edit]')
        hist = pg.inner_text('#app').split('Historial')[1]
        check('Creatina' in hist and '1/' in hist, 'Historial: ayer aparece la toma de creatina')
        # borrar con deshacer
        pg.locator('[data-a=supp-edit]').last.click(); pg.click('[data-a=supp-del]'); time.sleep(0.2)
        check(pg.evaluate('window.__gym.state.supps.length') == 2, 'Borrar un suplemento')
        pg.click('#toast [data-a=undo]'); time.sleep(0.2)
        check(pg.evaluate('window.__gym.state.supps.length') == 3, 'Deshacer lo recupera')
        # persistencia
        pg.reload(); pg.wait_for_selector('#app')
        st = pg.evaluate('window.__gym.state')
        check(len(st['supps']) == 3 and len(st['suppLog']) >= 1, 'Tras cerrar y abrir siguen los suplementos y las tomas')
        # privacidad: lo que se sube al grupo no lleva suplementos
        share = pg.evaluate('JSON.stringify(window.__gym.state.sessions.concat(window.__gym.state.activities))')
        check('Creatina' not in share, 'Los suplementos no están en lo que se comparte con el grupo')
        # copia de seguridad: sí van (son tus datos)
        check('Creatina' in pg.evaluate('window.__gym.exportData()'), 'La copia de seguridad incluye tus suplementos')
        # datos antiguos sin suplementos: migración aditiva
        pg.evaluate('''() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); delete s.supps; delete s.suppLog; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }''')
        pg.reload(); pg.wait_for_selector('#app')
        st = pg.evaluate('window.__gym.state')
        check(st['supps'] == [] and st['suppLog'] == {} and len(st['exercises']) > 0, 'Datos de antes (sin suplementos) se abren bien')
        pg.click('#tabs [data-a=tab][data-t=perfil]')
        pg.screenshot(path=os.path.join(ROOT, 'test', 'shots', 'supl-perfil.png')) if os.path.isdir(os.path.join(ROOT, 'test', 'shots')) else None
        # escritorio
        d = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); d.goto('http://localhost:8772/'); d.wait_for_selector('.routine')
        d.click('#tabs [data-a=tab][data-t=perfil]'); d.click('.supp-empty'); d.click('[data-a=supp-new]')
        check(d.locator('#sp-name').is_visible(), 'Escritorio: la hoja de suplemento se ve')
        check(not errs, 'Sin errores de JavaScript: ' + '; '.join(errs[:3]))
        b.close()
finally:
    srv.terminate()
print('\n' + ('TODO OK' if not fails else 'FALLOS: %d' % len(fails)))
sys.exit(1 if fails else 0)
