import json, subprocess, time, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True)
errors = []
fails = []

def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, has_touch=True, is_mobile=True,
                            color_scheme='dark', accept_downloads=True)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error',) else None)
        pg.goto('http://localhost:8765/')
        pg.wait_for_selector('.routine')
        check(pg.locator('.routine').count() == 3, 'Hoy muestra 3 rutinas')
        pg.screenshot(path=OUT + '/01-hoy.png')

        # ---- empezar Push
        pg.click('[data-a=start][data-k=push]')
        pg.wait_for_selector('.wk-head, header.top h1')
        check(pg.locator('section.ex').count() == 6, 'Push tiene 6 ejercicios')
        first_targets = pg.locator('section.ex.open .set:not(.head) .tgt').all_inner_texts()
        check(first_targets == ['105 × 8', '85 × 11', '85 × 11'], 'Objetivos press inclinado: ' + str(first_targets))
        txt = pg.locator('section.ex.open .hint').first.inner_text()
        check('105×7' in txt and '85×10' in txt, 'Muestra la última vez: ' + txt.replace('\n', ' '))
        check(pg.locator('section.ex.open .warmup').count() == 1, 'Sugiere calentamiento en el 1.º ejercicio de pecho')
        pg.screenshot(path=OUT + '/02-entreno.png')

        # peso precargado
        w0 = pg.locator('section.ex.open input[data-f=w]').first.input_value()
        check(w0 == '105', 'Peso precargado con el objetivo (' + w0 + ')')

        # marcar sin escribir reps -> se apunta el objetivo tal cual (105 × 8)
        pg.click('section.ex.open .chk >> nth=0')
        s0 = pg.evaluate('() => window.__gym.state.active.entries[0].sets[0]')
        check(s0['done'] and s0['w'] == 105 and s0['r'] == 8, 'Clic directo apunta el objetivo: %s' % s0)
        check(pg.locator('section.ex.open input[data-f=r][data-j="0"]').input_value() == '8', 'Las reps del objetivo se ven en la serie')
        pg.click('section.ex.open .chk >> nth=0')
        check(pg.locator('section.ex.open .set.done').count() == 0, 'Se puede desmarcar')
        # serie extra sin objetivo y sin reps -> sigue pidiendo reps
        pg.click('section.ex.open [data-a=add-set]')
        pg.click('section.ex.open .chk >> nth=3')
        check(pg.locator('section.ex.open .set.done').count() == 0, 'Serie extra sin objetivo: pide repeticiones')
        pg.click('section.ex.open [data-a=del-set]')
        # cambiar solo las reps respeta lo escrito
        pg.fill('section.ex.open input[data-f=w][data-j="1"]', '')
        pg.fill('section.ex.open input[data-f=r][data-j="1"]', '9')
        pg.click('section.ex.open .chk >> nth=1')
        s1 = pg.evaluate('() => window.__gym.state.active.entries[0].sets[1]')
        check(s1['done'] and s1['r'] == 9 and s1['w'] == 85, 'Reps escritas se respetan, peso vacío = objetivo: %s' % s1)
        pg.click('section.ex.open .chk >> nth=1')

        # rellenar 3 series del primer ejercicio (8 reps al tope sube? no: 12 en la 2ª y 3ª)
        reps = ['8', '12', '12']
        for j, r in enumerate(reps):
            pg.fill('section.ex.open input[data-f=r][data-j="%d"]' % j, r)
            pg.click('section.ex.open .chk >> nth=%d' % j)
        check(pg.locator('#timer:not([hidden])').count() == 1, 'Temporizador visible tras marcar serie')
        check(pg.locator('#timer .t').inner_text() != '', 'Temporizador con tiempo: ' + pg.locator('#timer .t').inner_text())
        pg.screenshot(path=OUT + '/03-timer.png')
        pg.click('[data-a=t-p]'); pg.click('[data-a=t-m]'); pg.click('[data-a=t-x]')
        check(pg.locator('#timer[hidden]').count() == 1, 'Saltar descanso oculta el temporizador')
        # al completar el ejercicio se abre el siguiente
        check('Press de pecho sentado' in pg.locator('section.ex.open .ex-name').inner_text(), 'Se abre el siguiente ejercicio al completar uno')

        # ---- añadir ejercicio, cambiar y quitar
        pg.click('[data-a=add-ex]')
        pg.wait_for_selector('#pick-list .item')
        pg.fill('#pq', 'jalón')
        check(pg.locator('#pick-list .item.mine').count() == 1, 'Buscador filtra en el selector')
        pg.click('#pick-list .item.mine')
        check(pg.locator('section.ex').count() == 7, 'Ejercicio añadido a la sesión')
        pg.screenshot(path=OUT + '/04-anadido.png')
        # quitar el recién añadido
        pg.click('[data-a=rm-ex]'); pg.click('[data-a=confirm-yes]')
        check(pg.locator('section.ex').count() == 6, 'Ejercicio quitado de la sesión')
        # cambiar el abierto
        pg.click('[data-a=swap]')
        pg.wait_for_selector('#pick-list .item')
        pg.click('#modal [data-a=flt].on')
        pg.fill('#pq', 'press de pecho sentado')
        check(pg.locator('#pick-list .item').count() >= 1, 'Selector de cambio funciona')
        pg.click('[data-a=close]') if pg.locator('[data-a=close]').count() else pg.mouse.click(10, 10)

        # ---- terminar
        pg.click('[data-a=finish]')
        pg.wait_for_selector('[data-a=finish-yes]')
        pg.screenshot(path=OUT + '/05-terminar.png')
        pg.click('[data-a=finish-yes]')
        pg.wait_for_selector('#modal .sheet h2')
        check('guardado' in pg.locator('#modal h2').inner_text().lower(), 'Resumen de entreno guardado')
        sm = pg.locator('#modal .sheet').inner_text()
        check('Press de pecho inclinado' in sm or 'Sin récords' in sm, 'Resumen: ' + sm.replace('\n', ' | ')[:120])
        pg.screenshot(path=OUT + '/06-resumen.png')
        pg.click('[data-a=close]')
        st = pg.evaluate('window.__gym.state')
        check(len(st['sessions']) == 1 and st['active'] is None, 'Sesión guardada en el estado')
        check(len(st['sessions'][0]['exercises']) == 1 and len(st['sessions'][0]['exercises'][0]['sets']) == 3, 'Solo se guardan las series marcadas')

        # ---- persistencia tras recargar
        pg.reload(); pg.wait_for_selector('.routine')
        check(pg.evaluate('window.__gym.state.sessions.length') == 1, 'Los datos persisten tras recargar')

        # ---- el siguiente push ya lleva objetivos nuevos
        pg.click('[data-a=start][data-k=push]')
        pg.wait_for_selector('section.ex.open')
        nt = pg.locator('section.ex.open .set:not(.head) .tgt').all_inner_texts()
        # 105x8 -> 105x9 ; 85x12 (tope) -> sube a 90 ; 85x12 -> 90
        check(nt[0] == '105 × 9' and nt[1].startswith('90 ×') and nt[2].startswith('90 ×'), 'Progresión tras sesión: ' + str(nt))
        pg.click('[data-a=discard]'); pg.click('[data-a=confirm-yes]')
        check(pg.evaluate('window.__gym.state.active') is None, 'Descartar entreno limpia la sesión')

        # ---- fatiga: hoy aparece aviso de descanso en Push
        chips = pg.locator('.routine').first.inner_text()
        check('Pecho' in chips, 'Hoy avisa de descanso del pecho: ' + chips.replace('\n', ' | ')[:100])
        pg.screenshot(path=OUT + '/07-hoy-aviso.png')

        # ---- Progreso
        pg.click('[data-t=prog]'); pg.wait_for_selector('h3.sec')
        ptxt = pg.locator('#app').inner_text().lower()
        check('récords personales' in ptxt and 'fatiga y descanso' in ptxt and 'historial' in ptxt, 'Pantalla de progreso completa')
        check('descansando' in ptxt, 'Progreso muestra músculos descansando')
        pg.screenshot(path=OUT + '/08-progreso.png', full_page=True)

        # ---- Ejercicios y editor
        pg.click('[data-t=ej]'); pg.wait_for_selector('#ex-list .item')
        check(pg.locator('#ex-list .item.mine').count() == 17, '17 ejercicios en la lista')
        pg.fill('#q', 'remo'); check(pg.locator('#ex-list .item.mine').count() == 1, 'Búsqueda de ejercicios')
        pg.click('#ex-list .item.mine')
        pg.wait_for_selector('#f-name')
        check(pg.input_value('#f-unit') == 'lb', 'Remo configurado con salto en libras')
        pg.screenshot(path=OUT + '/09-editor.png')
        pg.fill('#f-name', 'Remo prueba'); pg.click('[data-a=exedit-save]')
        check(pg.evaluate("window.__gym.state.exercises.find(e=>e.id==='remo').name") == 'Remo prueba', 'Editar ejercicio guarda cambios')
        pg.fill('#q', '')
        # nuevo ejercicio
        pg.click('[data-a=new-ex]'); pg.wait_for_selector('#f-name')
        pg.click('[data-a=exedit-save]')
        check(pg.locator('#toast:not([hidden])').count() == 1, 'Valida nombre vacío')
        pg.fill('#f-name', 'Sentadilla hack'); pg.select_option('#f-muscle', 'Cuádriceps'); pg.select_option('#f-equip', 'maquina')
        pg.click('[data-a=exedit-save]')
        check(pg.evaluate('window.__gym.state.exercises.length') == 18, 'Nuevo ejercicio creado')

        # ---- editar rutina
        pg.click('[data-a=edit-routine][data-k=legs]'); pg.wait_for_selector('[data-a=r-add]')
        pg.click('[data-a=r-add]'); pg.wait_for_selector('#pick-list .item')
        pg.fill('#pq', 'hack'); pg.click('#pick-list .item.mine')
        check(pg.evaluate("window.__gym.state.routines.legs.ids.length") == 5, 'Añadir ejercicio a la rutina de piernas')
        pg.click('[data-a=r-up][data-i="4"]')
        check(pg.evaluate("window.__gym.state.routines.legs.ids[3]") != 'talones', 'Reordenar rutina')
        pg.click('[data-a=close]')

        # ---- nuevo ejercicio sin historial en entreno
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=legs]'); pg.wait_for_selector('section.ex')
        pg.locator('section.ex .ex-head').nth(3).click()
        hint = pg.locator('section.ex.open .hint').first.inner_text()
        check('Sin historial' in hint, 'Ejercicio nuevo: ' + hint)
        pg.screenshot(path=OUT + '/10-nuevo-sin-historial.png')
        pg.click('[data-a=discard]'); pg.click('[data-a=confirm-yes]')

        # ---- ajustes: exportar / importar
        pg.click('[data-t=aj]'); pg.wait_for_selector('[data-a=backup]')
        pg.screenshot(path=OUT + '/11-ajustes.png', full_page=True)
        data = pg.evaluate('JSON.stringify(window.__gym.state)')
        pg.click('[data-a=import-paste]'); pg.fill('#paste', 'esto no es json'); pg.click('[data-a=paste-yes]')
        check(pg.locator('#toast:not([hidden])').count() == 1, 'Importar texto inválido avisa')
        pg.fill('#paste', data.replace('"sessions":[', '"sessions":[', 1)); pg.click('[data-a=paste-yes]')
        pg.wait_for_selector('[data-a=confirm-yes]'); pg.click('[data-a=confirm-yes]')
        check(pg.evaluate('window.__gym.state.sessions.length') == 1, 'Importar copia válida restaura sesiones')
        pg.click('[data-t=aj]'); pg.wait_for_selector('[data-a=backup]')
        with pg.expect_download() as dl:
            pg.click('[data-a=backup]')
        path = dl.value.path()
        check(json.load(open(path))['v'] == 1, 'Descarga de copia en JSON válida')
        check(pg.evaluate('window.__gym.state.settings.lastBackup') > 0, 'Se anota la fecha de la última copia')

        # ---- tema claro
        pg.emulate_media(color_scheme='light'); pg.click('[data-t=hoy]'); pg.wait_for_selector('.routine')
        pg.screenshot(path=OUT + '/12-hoy-claro.png')

        # ---- estancamiento: simular 3 sesiones sin mejora en un ejercicio de fatiga alta
        pg.emulate_media(color_scheme='dark')
        pg.evaluate("""() => {
          const s = window.__gym.state; const now = Date.now();
          s.sessions = [];
          for (let k = 0; k < 3; k++) s.sessions.push({id:'t'+k, t: now - (10 - k) * 86400000 * 2, key:'push', name:'Push', prs:[],
            exercises:[{exId:'press-inc', name:'Press inclinado', muscle:'Pecho', sec:[], fatigue:3, sets:[{w:105,r:7},{w:85,r:10}]}]});
        }""")
        pg.evaluate('localStorage.setItem("gymapp.v1", JSON.stringify(window.__gym.state))')
        pg.reload(); pg.wait_for_selector('.routine')
        pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('section.ex.open')
        check(pg.locator('section.ex.open .banner.warn').count() == 1, 'Detecta estancamiento y propone ajuste')
        pg.screenshot(path=OUT + '/13-estancado.png')
        pg.click('[data-a=stall-apply]')
        tg = pg.locator('section.ex.open .set:not(.head) .tgt').all_inner_texts()
        check(tg[0].startswith('95 ×'), 'Ajuste baja ~10 %: ' + str(tg))
        check(pg.locator('section.ex.open .banner.warn').count() == 0, 'El aviso desaparece tras aplicar')

        b.close()
finally:
    srv.terminate()

print('\nErrores de consola/página:', errors if errors else 'ninguno')
print('FALLOS:', fails if fails else 'ninguno')
sys.exit(1 if (fails or errors) else 0)
