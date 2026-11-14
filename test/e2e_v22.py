# v2.2: fotos en los entrenos (IndexedDB) y figura con los músculos trabajados en un carrusel deslizable.
import subprocess, sys, time, os, tempfile
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8775', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
# fotos de prueba grandes (como las de una cámara) para comprobar que se reducen
tmp = tempfile.mkdtemp(); pics = []
for i, col in enumerate([(200, 60, 40), (40, 110, 200), (60, 160, 80)]):
    im = Image.new('RGB', (3000, 4000), col); d = ImageDraw.Draw(im)
    for k in range(0, 4000, 200): d.rectangle([0, k, 3000, k + 90], fill=(col[2], col[0], col[1]))
    f = os.path.join(tmp, 'foto%d.jpg' % i); im.save(f, quality=92); pics.append(f)
HIST = """() => {
  const s = JSON.parse(localStorage.getItem('gymapp.v1')), now = Date.now();
  const mk = (id, t, name, exs) => s.sessions.push({ id, t, t0: t - 3600000, key: 'pull', name, prs: [], exercises: exs });
  mk('pull1', now - 2 * 86400000, 'Pull', [
    { exId: 'jalon', name: 'Jalón al pecho (máquina)', muscle: 'Dorsales', sec: ['Bíceps'], fatigue: 2, sets: [{ w: 100, r: 10 }, { w: 100, r: 9 }, { w: 90, r: 11 }, { w: 90, r: 10 }] },
    { exId: 'remo', name: 'Remo con agarre neutro (máquina)', muscle: 'Espalda', sec: ['Dorsales', 'Bíceps'], fatigue: 2, sets: [{ w: 90, r: 10 }, { w: 90, r: 9 }] },
    { exId: 'curl-pred', name: 'Curl predicador (máquina)', muscle: 'Bíceps', sec: [], fatigue: 1, sets: [{ w: 60, r: 8 }] } ]);
  mk('legs1', now - 86400000, 'Piernas', [
    { exId: 'prensa', name: 'Prensa', muscle: 'Cuádriceps', sec: ['Glúteos'], fatigue: 3, sets: [{ w: 200, r: 10 }, { w: 200, r: 9 }, { w: 200, r: 8 }] },
    { exId: 'curl-fem', name: 'Curl femoral', muscle: 'Isquios', sec: [], fatigue: 2, sets: [{ w: 60, r: 10 }, { w: 60, r: 10 }] },
    { exId: 'gemelo', name: 'Elevación de gemelos', muscle: 'Gemelos', sec: [], fatigue: 1, sets: [{ w: 80, r: 12 }] } ]);
  localStorage.setItem('gymapp.v1', JSON.stringify(s));
}"""
on = lambda pg, scope, m: pg.locator('%s .bm-m.on[data-m="%s"]' % (scope, m)).count()
op = lambda pg, scope, m: float(pg.locator('%s .bm-m.on[data-m="%s"]' % (scope, m)).first.evaluate('e => getComputedStyle(e).fillOpacity'))
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8775/'); pg.wait_for_selector('.routine')
        pg.evaluate(HIST); pg.reload(); pg.wait_for_selector('.routine')
        pg.click('[data-t=perfil]')
        check(pg.locator('.sess .media').count() == 0, 'Registro: sin fotos no hay carrusel en la tarjeta')

        # --- detalle sin fotos: solo la figura
        pg.locator('[data-a=sess][data-id=pull1]').click()
        check(pg.locator('.media .slide').count() == 1 and pg.locator('.media .slide.fig svg.bm').count() == 1 and pg.locator('.dots').count() == 0, 'Detalle: figura de músculos, sin puntos')
        check(on(pg, '.media', 'Dorsales') == 2 and on(pg, '.media', 'Espalda') == 2 and on(pg, '.media', 'Bíceps') == 2, 'Pull: dorsales, espalda y bíceps marcados (los dos lados)')
        check(on(pg, '.media', 'Pecho') == 0 and on(pg, '.media', 'Cuádriceps') == 0 and on(pg, '.media', 'Glúteos') == 0, 'Lo que no se entrenó queda sin marcar')
        # dorsales 4 + 1 (secundario del remo) = 5 -> máximo; bíceps 2 + 1 + 1 = 4; espalda 2
        od, ob, oe = op(pg, '.media', 'Dorsales'), op(pg, '.media', 'Bíceps'), op(pg, '.media', 'Espalda')
        check(od == 1 and od > ob > oe > 0.3, 'Más series = color más intenso (dorsales %.2f > bíceps %.2f > espalda %.2f)' % (od, ob, oe))
        check('Dorsales' in pg.locator('svg.bm').get_attribute('aria-label'), 'La figura tiene descripción de texto')
        box = pg.locator('.slide.fig').bounding_box(); sv = pg.locator('svg.bm').bounding_box()
        check(abs(box['width'] - box['height']) < 2 and sv['height'] > 220 and sv['y'] + sv['height'] <= box['y'] + box['height'], 'Figura dentro de su tarjeta cuadrada (%dx%d)' % (box['width'], box['height']))
        pg.locator('.media').scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/90-figura-pull.png')

        # --- añadir una foto
        pg.set_input_files('input[data-f=photo]', pics[0])
        pg.wait_for_function("() => (window.__gym.state.sessions.find(s => s.id === 'pull1').photos || []).length === 1", timeout=15000)
        pg.wait_for_selector('.media .slide.ph img[src^="blob:"]')
        check(pg.locator('.media .slide').count() == 2 and pg.locator('.dots i').count() == 2, 'Foto añadida: 2 diapositivas y 2 puntos')
        kinds = pg.locator('.media .slide').evaluate_all('els => els.map(e => e.classList.contains("ph") ? "foto" : "figura")')
        check(kinds == ['foto', 'figura'], 'Primero la foto; al deslizar, la figura: %s' % kinds)
        dim = pg.locator('.media .slide.ph img').evaluate('e => [e.naturalWidth, e.naturalHeight]')
        check(max(dim) == 1280 and dim == [960, 1280], 'La foto se reduce a 1280 px (%s, original 3000x4000)' % dim)
        size = pg.evaluate("""async () => { const id = window.__gym.state.sessions.find(s => s.id === 'pull1').photos[0];
          const db = await new Promise(r => { const q = indexedDB.open('gym-photos'); q.onsuccess = () => r(q.result); });
          return await new Promise(r => { const q = db.transaction('p').objectStore('p').get(id); q.onsuccess = () => r(q.result.buf.byteLength); }); }""")
        check(0 < size < 600000, 'Guardada en el iPhone (IndexedDB), %d KB' % (size // 1024))
        check(len(pg.evaluate("() => localStorage.getItem('gymapp.v1')")) < 40000, 'Los datos de entrenos no engordan con las fotos')
        # deslizar
        check(pg.locator('.dots i.on').evaluate('e => [...e.parentNode.children].indexOf(e)') == 0, 'Punto 1 activo al principio')
        pg.locator('.media').evaluate('e => e.scrollTo({ left: e.scrollWidth, behavior: "instant" })'); pg.wait_for_timeout(300)
        check(pg.locator('.dots i.on').evaluate('e => [...e.parentNode.children].indexOf(e)') == 1, 'Al deslizar, el punto pasa a la figura')
        fig = pg.locator('.slide.fig').bounding_box()
        check(0 <= fig['x'] <= 20, 'La figura queda centrada tras deslizar (x=%d)' % fig['x'])
        pg.screenshot(path=OUT + '/91-carrusel-figura.png')
        pg.locator('.media').evaluate('e => e.scrollTo({ left: 0, behavior: "instant" })'); pg.wait_for_timeout(200)
        pg.screenshot(path=OUT + '/92-carrusel-foto.png')

        # --- varias a la vez y límite
        pg.set_input_files('input[data-f=photo]', [pics[1], pics[2]])
        pg.wait_for_function("() => window.__gym.state.sessions.find(s => s.id === 'pull1').photos.length === 3", timeout=20000)
        check(pg.locator('.media .slide').count() == 4 and pg.locator('.dots i').count() == 4, 'Varias fotos de una vez')

        # --- persisten tras cerrar y abrir
        pg.reload(); pg.wait_for_selector('.routine'); pg.click('[data-t=perfil]')
        card = pg.locator('[data-a=sess][data-id=pull1]')
        pg.wait_for_selector('[data-id=pull1] .slide.ph img[src^="blob:"]')
        check(card.locator('.media .slide').count() == 4, 'Tras reabrir: la tarjeta del registro lleva fotos + figura')
        check(pg.locator('[data-a=sess][data-id=legs1] .media').count() == 0, 'El entreno sin fotos sigue sin carrusel')
        card.scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/93-registro-con-foto.png')
        card.locator('.slide.ph img').first.click()
        check(pg.locator('h1').inner_text() == 'Pull', 'Tocar la tarjeta (aunque sea en la foto) abre el entreno')

        # --- ver y borrar una foto, con Deshacer
        pg.locator('.media .slide.ph img').first.click()
        check(pg.locator('#modal img.ph-full[src^="blob:"]').count() == 1, 'Tocar la foto la abre en grande')
        pg.click('[data-a=photo-del]')
        check(pg.locator('.media .slide.ph').count() == 2, 'Borrar foto')
        pg.click('#toast [data-a=undo]')
        pg.wait_for_selector('.media .slide.ph img[src^="blob:"]')
        check(pg.locator('.media .slide.ph').count() == 3, 'Deshacer la recupera')

        # --- piernas: otra figura
        pg.click('[data-a=sess-back]'); pg.locator('[data-a=sess][data-id=legs1]').click()
        check(on(pg, '.media', 'Cuádriceps') == 2 and on(pg, '.media', 'Isquios') == 2 and on(pg, '.media', 'Glúteos') == 2 and on(pg, '.media', 'Gemelos') == 4, 'Piernas: cuádriceps, isquios, glúteos y gemelos (delante y detrás)')
        check(on(pg, '.media', 'Dorsales') == 0, 'Piernas: sin espalda')
        pg.locator('.media').scroll_into_view_if_needed(); pg.screenshot(path=OUT + '/94-figura-piernas.png')

        # --- foto de la copia que no está en este iPhone: se oculta sin romper nada
        pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.sessions.find(x => x.id === 'legs1').photos = ['noexiste']; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        pg.reload(); pg.wait_for_selector('.routine'); pg.click('[data-t=perfil]'); pg.locator('[data-a=sess][data-id=legs1]').click()
        pg.wait_for_function("() => document.querySelectorAll('.media .slide').length === 1", timeout=5000)
        check(pg.locator('.media .slide.fig').count() == 1 and pg.locator('.dots i').count() <= 1, 'Foto que falta: queda solo la figura')

        # --- tras guardar un entreno se puede añadir foto desde el resumen
        pg.click('[data-t=hoy]'); pg.click('[data-a=start][data-k=push]'); pg.wait_for_selector('header.top h1')
        pg.click('section.ex.open .chk >> nth=0'); pg.click('[data-a=t-x]')
        pg.click('[data-a=finish]'); pg.click('[data-a=finish-yes]'); pg.wait_for_selector('#modal h2')
        check(pg.locator('#modal input[data-f=photo]').count() == 1, 'Resumen al guardar: botón Añadir foto')
        pg.set_input_files('#modal input[data-f=photo]', pics[0])
        pg.wait_for_selector('.media .slide.ph img[src^="blob:"]', timeout=15000)
        check(pg.locator('h1').inner_text() == 'Push' and pg.locator('#modal').is_hidden() and on(pg, '.media', 'Pecho') == 2, 'Añadida desde el resumen: abre el entreno con su foto y su figura')

        # tema claro
        ctx2 = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='light')
        p2 = ctx2.new_page(); p2.goto('http://localhost:8775/'); p2.wait_for_selector('.routine'); p2.evaluate(HIST); p2.reload(); p2.wait_for_selector('.routine')
        p2.click('[data-t=perfil]'); p2.locator('[data-a=sess][data-id=pull1]').click(); p2.wait_for_timeout(400)
        p2.locator('.media').scroll_into_view_if_needed(); p2.screenshot(path=OUT + '/95-figura-claro.png')
        ctx2.close(); b.close()
finally:
    srv.terminate()
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
