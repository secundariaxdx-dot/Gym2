# v2.1: pestaña Perfil con resumen, registro de entrenos y detalle de cada uno; Ajustes dentro de Perfil.
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8774', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
# 25 sesiones de Pull, una por semana hacia atrás (60 min, jalón subiendo de peso; la más reciente con récord)
HIST = """() => {
  const s = JSON.parse(localStorage.getItem('gymapp.v1')), DAY = 86400000, now = Date.now();
  for (let k = 25; k >= 1; k--) {
    const t = now - k * 7 * DAY + 3600000, w = 100 + (25 - k);
    s.sessions.push({ id: 'h' + k, t, t0: t - 3600000, key: 'pull', name: 'Pull', prs: k === 1 ? [{ exId: 'jalon', name: 'Jalón al pecho (máquina)', w, r: 10 }] : [], exercises: [
      { exId: 'jalon', name: 'Jalón al pecho (máquina)', muscle: 'Dorsales', sec: ['Bíceps'], fatigue: 2, sets: [{ w, r: 10 }, { w, r: 9 }, { w: w - 10, r: 11 }] },
      { exId: 'remo', name: 'Remo con agarre neutro (máquina)', muscle: 'Espalda', sec: ['Dorsales', 'Bíceps'], fatigue: 2, sets: [{ w: 90, r: 10 }, { w: 90, r: 9 }] },
      { exId: 'curl-pred', name: 'Curl predicador (máquina)', muscle: 'Bíceps', sec: [], fatigue: 1, sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] },
      { exId: 'martillo', name: 'Martillo unilateral en polea', muscle: 'Bíceps', sec: [], fatigue: 1, sets: [{ w: 14, r: 10 }] },
      { exId: 'dominadas-x', name: 'Dominadas', muscle: 'Dorsales', sec: [], fatigue: 2, sets: [{ w: 0, r: 8 }] } ] });
  }
  localStorage.setItem('gymapp.v1', JSON.stringify(s));
}"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8774/'); pg.wait_for_selector('.routine')

        # --- sin entrenos
        tabs = pg.locator('#tabs .tab span').all_inner_texts()
        check(tabs == ['Hoy', 'Calendario', 'Ejercicios', 'Progreso', 'Perfil'], 'Pestañas: %s' % tabs)
        pg.click('[data-t=perfil]')
        check('Aquí aparecerán tus entrenos' in pg.inner_text('#app') and pg.locator('.tile').count() == 4, 'Perfil vacío con resumen a cero')
        # Ajustes dentro de Perfil
        pg.click('[data-t=aj]')
        check(pg.locator('[data-a=backup]').count() == 1 and pg.locator('#tabs .tab.on span').inner_text() == 'Perfil', 'Ajustes se abre desde Perfil')
        pg.click('.back')
        check(pg.locator('.tiles').count() == 1 and pg.locator('h1').inner_text() == 'Perfil', '‹ Perfil vuelve')

        # --- con historial
        pg.evaluate(HIST); pg.reload(); pg.wait_for_selector('.routine'); pg.click('[data-t=perfil]')
        tl = pg.locator('.tile b').all_inner_texts()
        check(tl[0] == '25' and tl[1] == '25 semanas' and tl[2] == '25 h', 'Resumen: entrenos, racha y tiempo: %s' % tl)
        # volumen por sesión: (w*10 + w*9 + (w-10)*11) + 90*19 + 60*16 + 14*10, con w = 100..124
        vol = sum(w * 10 + w * 9 + (w - 10) * 11 + 1710 + 960 + 140 for w in range(100, 125))
        check(tl[3] == '{:,}'.format(vol).replace(',', '.') + ' kg', 'Volumen total exacto: %s' % tl[3])
        check(pg.locator('[data-a=sess]').count() == 20 and pg.locator('[data-a=pf-more]').count() == 1, 'Registro: 20 entrenos y botón de ver más')
        first = pg.locator('[data-a=sess]').first
        txt = first.inner_text()
        check('Pull' in txt and '1 h 00 min' in txt and '9' in txt and '🏆 1 récord' in txt, 'Tarjeta: nombre, tiempo, series y récord')
        check('3 × Jalón al pecho (máquina)' in txt and '124 kg × 10' in txt, 'Tarjeta: ejercicios con su mejor serie')
        check('+ 1 ejercicio más' in txt, 'Tarjeta: resume los ejercicios que no caben')
        check(pg.locator('.grp').count() >= 4 and 'entreno' in pg.locator('.grp').first.inner_text(), 'Agrupado por meses: ' + pg.locator('.grp').first.inner_text())
        ov = pg.evaluate('() => document.documentElement.scrollWidth > window.innerWidth')
        check(not ov, 'Sin desbordes laterales')
        pg.screenshot(path=OUT + '/80-perfil.png')
        first.scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/81-perfil-registro.png')
        # gráfico de 12 semanas con 3 medidas
        tip = pg.inner_text('.chart-tip')
        check('1 h 00 min' in tip, 'Gráfico de duración: ' + tip)
        pg.click('[data-a=pf-m][data-v=vol]'); check('kg' in pg.inner_text('.chart-tip'), 'Gráfico de volumen: ' + pg.inner_text('.chart-tip'))
        pg.click('[data-a=pf-m][data-v=ser]'); check('9 series' in pg.inner_text('.chart-tip'), 'Gráfico de series: ' + pg.inner_text('.chart-tip'))
        check(pg.locator('.chart path.bar').count() == 11, 'Barras de las semanas con entreno: %d' % pg.locator('.chart path.bar').count())
        pg.click('[data-a=pf-more]')
        check(pg.locator('[data-a=sess]').count() == 25 and pg.locator('[data-a=pf-more]').count() == 0, 'Ver más muestra el resto')

        # --- detalle de un entreno
        pg.locator('[data-a=sess]').nth(3).scroll_into_view_if_needed()
        pg.evaluate("() => document.addEventListener('click', () => { window.__y0 = window.scrollY; }, { capture: true, once: true })")
        pg.locator('[data-a=sess]').first.click(); y0 = pg.evaluate('() => window.__y0')
        check(pg.locator('h1').inner_text() == 'Pull' and pg.evaluate('() => window.scrollY') == 0, 'Abre el detalle arriba del todo')
        tl = pg.locator('.tile b').all_inner_texts()
        check(tl[0] == '1 h 00 min' and tl[2] == '9' and tl[3] == '🏆 1', 'Detalle: duración, series y récords: %s' % tl)
        check(pg.locator('.sd').count() == 5 and pg.locator('.sd-row').count() == 9, 'Todos los ejercicios y series')
        j = pg.locator('.sd').first.inner_text()
        check('124 kg × 10' in j and '165,3 kg' in j and '114 kg × 11' in j, 'Peso, repeticiones y 1RM de cada serie')
        check(pg.locator('.sd').first.locator('.sd-row.pr').count() == 1 and '🏆' in pg.locator('.sd-row.pr').inner_text(), 'La serie del récord va marcada')
        check('▲ +0,8 %' in j, 'Compara con la vez anterior: ' + pg.locator('.sd').first.locator('.chip').inner_text())
        check('= igual' in pg.locator('.sd').nth(1).inner_text(), 'Ejercicio sin cambios: igual')
        check('8 reps' in pg.locator('.sd').nth(4).inner_text(), 'Ejercicio sin peso: repeticiones')
        check('Dorsales · 4' in pg.inner_text('.ss-mus') and 'Bíceps · 3' in pg.inner_text('.ss-mus'), 'Series por músculo: ' + pg.inner_text('.ss-mus').replace('\n', ' '))
        pg.screenshot(path=OUT + '/82-entreno-detalle.png')
        pg.click('[data-a=sess-back]')
        check(pg.locator('[data-a=sess]').count() == 25 and y0 > 100 and abs(pg.evaluate('() => window.scrollY') - y0) < 5, 'Volver deja la lista donde estaba (%d px)' % y0)
        # el más antiguo: primera vez del ejercicio que no estaba en los datos iniciales
        pg.locator('[data-a=sess]').last.click()
        check('Primera vez' in pg.locator('.sd').nth(4).inner_text(), 'Primera vez de un ejercicio')
        pg.click('[data-t=perfil]')
        check(pg.locator('.tiles').count() == 1 and pg.locator('h1').inner_text() == 'Perfil', 'Tocar la pestaña Perfil vuelve al registro')

        # --- acceso desde el calendario
        pg.click('[data-t=cal]'); pg.locator('.cal-d.gym').last.click(); pg.click('#modal [data-a=sess]')
        check(pg.locator('h1').inner_text() == 'Pull' and pg.locator('#modal').is_hidden(), 'Desde el día del calendario se abre el entreno')

        # --- borrar con Deshacer
        n = pg.evaluate('() => window.__gym.state.sessions.length')
        pg.click('[data-a=del-sess]'); pg.click('[data-a=confirm-yes]')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == n - 1 and pg.locator('h1').inner_text() == 'Perfil', 'Borrar vuelve al registro')
        pg.click('#toast [data-a=undo]')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == n, 'Deshacer lo recupera')

        # --- entreno real: al guardar, «Ver entreno» lleva a su detalle
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.click('section.ex.open .chk >> nth=0'); pg.click('[data-a=t-x]')
        pg.click('[data-a=finish]'); pg.click('[data-a=finish-yes]'); pg.wait_for_selector('#modal h2')
        pg.click('#modal [data-a=sess]')
        check(pg.locator('h1').inner_text() == 'Push' and pg.locator('.sd-row').count() == 1 and '105 kg × 8' in pg.inner_text('.sd'), 'Ver entreno tras guardar: ' + pg.inner_text('.sd-row').replace('\n', ' '))
        pg.click('[data-a=sess-back]')
        check(pg.locator('[data-a=sess]').first.inner_text().startswith('Push') and pg.locator('.tile b').first.inner_text() == '26', 'El entreno nuevo sale el primero')
        # Progreso ya no repite el historial
        pg.click('[data-t=prog]')
        check(pg.locator('[data-a=hist]').count() == 0, 'El historial ya no está duplicado en Progreso')

        # tema claro
        ctx2 = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='light')
        p2 = ctx2.new_page(); p2.goto('http://localhost:8774/'); p2.wait_for_selector('.routine'); p2.evaluate(HIST); p2.reload(); p2.wait_for_selector('.routine')
        p2.click('[data-t=perfil]'); p2.screenshot(path=OUT + '/83-perfil-claro.png')
        p2.locator('[data-a=sess]').first.click(); p2.screenshot(path=OUT + '/84-detalle-claro.png')
        ctx2.close(); b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
