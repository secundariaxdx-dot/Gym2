# v1.7: clic más audible, línea de progreso del entreno, gráficos por ejercicio y por grupo muscular.
import subprocess, sys, time, os, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8772', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

# Espía de ganancia: guarda el volumen máximo de cada tono
SPY = """
window.__gains = [];
(function () {
  var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  var cg = C.prototype.createGain;
  C.prototype.createGain = function () { var g = cg.call(this), rec = { max: 0 }; window.__gains.push(rec);
    var orig = g.gain.exponentialRampToValueAtTime.bind(g.gain);
    g.gain.exponentialRampToValueAtTime = function (v, t) { rec.max = Math.max(rec.max, v); return orig(v, t); }; return g; };
})();
"""
# 8 semanas de Pull (jalón sube de peso) para tener gráficos
HIST = """() => {
  const s = JSON.parse(localStorage.getItem('gymapp.v1')), DAY = 86400000, now = Date.now();
  for (let k = 8; k >= 1; k--) {
    const t = now - k * 7 * DAY + 3600000, w = 100 + (8 - k) * 2.5;
    s.sessions.push({ id: 'h' + k, t, t0: t - 3600000, key: 'pull', name: 'Pull', prs: [], exercises: [
      { exId: 'jalon', name: 'Jalón al pecho (máquina)', muscle: 'Dorsales', sec: ['Bíceps'], fatigue: 2, sets: [{ w, r: 10 }, { w, r: 9 }, { w: w - 10, r: 11 }] },
      { exId: 'remo', name: 'Remo con agarre neutro (máquina)', muscle: 'Espalda', sec: ['Dorsales', 'Bíceps'], fatigue: 2, sets: [{ w: 90, r: 10 }, { w: 90, r: 9 }] },
      { exId: 'curl-pred', name: 'Curl predicador (máquina)', muscle: 'Bíceps', sec: [], fatigue: 1, sets: [{ w: 60 + k, r: 8 }, { w: 60, r: 8 }] } ] });
  }
  localStorage.setItem('gymapp.v1', JSON.stringify(s));
}"""

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        ctx.add_init_script(SPY)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8772/'); pg.wait_for_selector('.routine')
        pg.evaluate(HIST); pg.reload(); pg.wait_for_selector('.routine')
        n_sess = pg.evaluate('() => window.__gym.state.sessions.length')

        # --- Clic más audible (bajito pero claro)
        check(pg.locator('#wprog').is_hidden(), 'Sin entreno no hay línea de progreso')
        pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        total = pg.evaluate('() => window.__gym.state.active.entries.reduce((a, e) => a + e.sets.length, 0)')
        check(pg.locator('#wprog').is_visible(), 'Línea de progreso visible en el entreno')
        check(pg.inner_text('#wprog .wp-t') == '0/%d series · 0 %%' % total, 'Empieza en 0: ' + pg.inner_text('#wprog .wp-t'))
        g0 = pg.evaluate('() => window.__gains.length')
        pg.click('section.ex.open .chk >> nth=0')
        gains = pg.evaluate('(n) => window.__gains.slice(n).map(g => g.max)', g0)
        check(len(gains) >= 1 and 0.15 <= gains[0] <= 0.3, 'Clic más alto pero suave (ganancia %s, antes 0,07)' % gains[:1])

        # --- Línea de progreso avanza y retrocede
        pct = lambda: pg.evaluate("() => parseFloat(document.querySelector('#wprog .wp-bar i').style.width)")
        p1 = pct()
        check(pg.inner_text('#wprog .wp-t').startswith('1/%d' % total) and abs(p1 - round(100 / total)) < 0.6, 'Avanza al marcar: ' + pg.inner_text('#wprog .wp-t'))
        pg.click('section.ex.open .chk >> nth=1')
        check(pg.inner_text('#wprog .wp-t').startswith('2/%d' % total), 'Avanza con la 2.ª serie')
        p2 = pct()
        pg.click('section.ex.open [data-a=add-set]')
        check(pg.inner_text('#wprog .wp-t').startswith('2/%d' % (total + 1)) and pct() < p2, 'Añadir serie hace retroceder: ' + pg.inner_text('#wprog .wp-t'))
        pg.click('section.ex.open [data-a=del-set]')
        check(pg.inner_text('#wprog .wp-t').startswith('2/%d' % total), 'Quitar serie vuelve a avanzar')
        pg.click('section.ex.open .chk >> nth=1')
        check(pg.inner_text('#wprog .wp-t').startswith('1/%d' % total), 'Desmarcar resta')
        # no tapa el temporizador ni las pestañas
        tb = pg.locator('#timer').bounding_box(); wb = pg.locator('#wprog').bounding_box(); nb = pg.locator('#tabs').bounding_box()
        check(tb['y'] + tb['height'] <= wb['y'] + 0.5 and wb['y'] + wb['height'] <= nb['y'] + 1, 'Temporizador, línea y pestañas no se solapan')
        pg.wait_for_timeout(2800); pg.screenshot(path=OUT + '/60-linea-progreso.png')
        pg.wait_for_timeout(2800)
        pg.click('[data-t=prog]')
        check(pg.locator('#wprog').is_hidden(), 'La línea solo se ve en la pestaña del entreno')

        # --- Gráfico por ejercicio
        pg.wait_for_selector('[data-a=prog-ex]')
        pg.click('[data-a=prog-ex][data-id=jalon]')
        ch = pg.locator('.li.open .chart')
        check(ch.count() == 1, 'Tocar un ejercicio abre su gráfico')
        npts = pg.locator('.li.open .chart circle.dot').count()
        check(npts == 9, 'Un punto por sesión (8 + la inicial): %d' % npts)
        summ = pg.inner_text('.li.open .chart-sum')
        check('→' in summ and '%' in summ, 'Resumen inicio → ahora: ' + summ.replace('\n', ' '))
        tip0 = pg.inner_text('.li.open .chart-tip')
        check('1RM' in tip0 and 'kg ×' in tip0, 'Muestra la última sesión: ' + tip0)
        box = pg.locator('.li.open .chart svg').bounding_box()
        pg.mouse.click(box['x'] + box['width'] * 0.15, box['y'] + box['height'] / 2)
        tip1 = pg.inner_text('.li.open .chart-tip')
        check(tip1 != tip0 and '1RM' in tip1, 'Tocar el gráfico muestra otro punto: ' + tip1)
        pg.locator('.li.open').scroll_into_view_if_needed()
        pg.screenshot(path=OUT + '/61-grafico-ejercicio.png')
        pg.click('[data-a=prog-ex][data-id=jalon]')
        check(pg.locator('.li.open').count() == 0, 'Tocar otra vez lo cierra')

        # --- Grupo muscular
        opts = pg.locator('select.musc option').all_inner_texts()
        check(len(opts) >= 15 and any(o.startswith('Pecho') for o in opts) and any(o.startswith('Gemelos') for o in opts), 'Desplegable con todos los grupos (%d)' % len(opts))
        # orden: fatiga, grupo muscular, récords, historial
        secs = [x.strip().lower() for x in pg.locator('h3.sec').all_inner_texts()]
        check(secs == ['fatiga y descanso', 'por grupo muscular', 'récords personales'], 'Orden de secciones: %s' % secs)
        # récords: todos los ejercicios (17), también sin datos
        check(pg.locator('[data-a=prog-ex]').count() == len(pg.evaluate('() => window.__gym.state.exercises')), 'Récords: aparecen todos los ejercicios (%d)' % pg.locator('[data-a=prog-ex]').count())
        # gráficos ocultos hasta pulsar el botón
        pg.select_option('select.musc', 'Dorsales')
        check(pg.locator('.musc-row + section').count() == 0 and pg.inner_text('[data-a=musc-tog]') == 'Ver gráficos', 'Gráficos del grupo ocultos por defecto')
        pg.click('[data-a=musc-tog]')
        check(pg.inner_text('[data-a=musc-tog]') == 'Ocultar', 'Botón cambia a Ocultar')
        sec = pg.locator('.musc-row + section')
        check(sec.locator('.chart').count() == 2, 'Dorsales: gráficos de series y volumen')
        bars = sec.locator('.chart').first.locator('path.bar').count()
        check(bars >= 8, 'Barras de las semanas con datos: %d' % bars)
        tip = sec.locator('.chart-tip').first.inner_text()
        check('series' in tip and not tip.endswith(' 0 series'), 'Tip inicial = última semana con datos: ' + tip)
        # 3 series de jalón + mitad de 2 de remo = 4 por semana
        sx = pg.evaluate("() => JSON.parse(document.querySelector('.musc-row + section .chart').getAttribute('data-tips'))")
        check(any('<b>4 series</b>' in t for t in sx), 'Cuenta directas + ½ secundarias (4/semana)')
        check('Jalón' in sec.inner_text() and '→' in sec.inner_text(), 'Lista de fuerza de los ejercicios del grupo')
        sec.scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/62-grafico-musculo.png')
        pg.select_option('select.musc', 'Gemelos')
        check('Sin series' in pg.locator('.musc-row + section').inner_text(), 'Grupo sin datos lo indica')
        pg.click('[data-a=musc-tog]')
        check(pg.locator('.musc-row + section').count() == 0 and pg.inner_text('[data-a=musc-tog]') == 'Ver gráficos', 'Ocultar los esconde')
        pg.locator('.musc-row').scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/64-progreso-orden.png')
        check(pg.evaluate('() => window.__gym.state.sessions.length') == n_sess, 'No se tocan las sesiones')

        # tema claro: el gráfico se lee
        ctx2 = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='light')
        p2 = ctx2.new_page(); p2.goto('http://localhost:8772/'); p2.wait_for_selector('.routine'); p2.evaluate(HIST); p2.reload(); p2.wait_for_selector('.routine')
        p2.click('[data-t=prog]'); p2.click('[data-a=prog-ex][data-id=jalon]'); p2.select_option('select.musc', 'Dorsales'); p2.click('[data-a=musc-tog]')
        p2.locator('.li.open').scroll_into_view_if_needed(); p2.screenshot(path=OUT + '/63-graficos-claro.png')
        ctx2.close()
        b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
