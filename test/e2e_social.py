# v3.0/3.1: grupo de amigos con cuentas privadas y administrador. Pau (admin) y Laura en navegadores
# distintos contra el Worker local: solicitudes, aceptar/rechazar, cuenta privada, admin que ve sin seguir.
import subprocess, sys, time, os, re, json, tempfile, signal, urllib.request
from PIL import Image
import _pau  # noqa: simula el iPhone de Pau (pesos de partida)
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shots'); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8777', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
store = tempfile.mkdtemp()
wr = subprocess.Popen(['npx', 'wrangler', 'dev', '--port', '8789', '--ip', '127.0.0.1', '--persist-to', store], cwd=os.path.join(ROOT, 'push'),
                      env={**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
tmp = tempfile.mkdtemp(); pic = os.path.join(tmp, 'f.jpg'); Image.new('RGB', (1200, 1600), (200, 80, 40)).save(pic)
STUB = "window.__GYM_PUSH = { url: 'http://localhost:8789', key: 'x' };"
APP = 'http://localhost:8777/'
HIST = """() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')), now = Date.now();
  s.sessions.push({ id: 'lw1', t: now - 2 * 86400000, t0: now - 2 * 86400000 - 3600000, key: 'legs', name: 'Piernas', prs: [{ exId: 'prensa', name: 'Prensa', w: 120, r: 10 }], exercises: [
    { exId: 'prensa', name: 'Prensa', muscle: 'Cuádriceps', sec: ['Glúteos'], fatigue: 3, sets: [{ w: 110, r: 10 }, { w: 120, r: 10 }] },
    { exId: 'hip', name: 'Hip thrust', muscle: 'Glúteos', sec: ['Isquios'], fatigue: 2, sets: [{ w: 80, r: 12 }, { w: 80, r: 12 }, { w: 80, r: 11 }] } ] });
  localStorage.setItem('gymapp.v1', JSON.stringify(s)); }"""
def server_dump():
    blob = b''
    for dp, _, fs in os.walk(store):
        for f in fs:
            try: blob += open(os.path.join(dp, f), 'rb').read()
            except Exception: pass
    return blob
def page(b, scheme='dark'):
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme)
    ctx.add_init_script(STUB); ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='http://localhost:8777')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto(APP); pg.wait_for_selector('.routine')
    return ctx, pg
def synced(pg):
    pg.wait_for_function("() => !window.__gym.socBusy", timeout=20000)
    pg.evaluate("() => window.__gym.socSync(true)")
    pg.wait_for_function("() => !window.__gym.socBusy", timeout=20000)
try:
    for _ in range(120):
        try: urllib.request.urlopen('http://127.0.0.1:8789/', timeout=1); break
        except Exception: time.sleep(0.5)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        cP, P = page(b); cL, L = page(b)
        tabs = P.locator('#tabs .tab span').all_inner_texts()
        check(tabs == ['Hoy', 'Amigos', 'Calendario', 'Ejercicios', 'Progreso', 'Perfil'], 'Pestaña Amigos: %s' % tabs)

        # ---- Pau crea el grupo (será administrador), Laura entra con el código
        P.click('[data-t=amigos]'); P.click('[data-a=soc-start][data-m=create]')
        P.fill('#s-name', 'Pau'); P.fill('#s-user', 'pau'); P.click('[data-a=soc-go]')
        P.wait_for_selector('#soc-code'); code = P.inner_text('#soc-code').strip()
        check(re.fullmatch(r'GYM1-[A-Za-z0-9_-]{43}', code) is not None, 'Grupo creado con código')
        L.evaluate(HIST); L.reload(); L.wait_for_selector('.routine')
        L.click('[data-t=amigos]'); L.click('[data-a=soc-start][data-m=join]')
        L.fill('#s-code', code); L.fill('#s-name', 'Laura'); L.fill('#s-user', 'laura'); L.click('[data-a=soc-go]')
        L.wait_for_function("() => (window.__gym.state.settings.social || {}).username === 'laura'", timeout=10000)
        synced(L)
        L.click('[data-t=perfil]'); L.locator('[data-a=sess][data-id=lw1]').click()
        L.set_input_files('input[data-f=photo]', pic)
        L.wait_for_function("() => (window.__gym.state.sessions.find(s => s.id === 'lw1').photos || []).length === 1", timeout=15000)
        L.evaluate("() => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.activities = s.activities || []; s.activities.push({ id: 'csp', type: 'clase', classKind: 'Spinning', min: 45, rpe: 8, dist: 20, t: Date.now() - 86400000, day: 'x' }); localStorage.setItem('gymapp.v1', JSON.stringify(s)); }")
        L.reload(); L.wait_for_selector('.routine'); synced(L)

        # ---- cuentas privadas: Laura pide seguir a Pau y hasta que acepta no ve nada
        L.click('[data-t=amigos]'); L.click('.soc-hero [data-a=people]'); L.wait_for_selector('.li.ppl')
        pau_row = [r for r in L.locator('.li.ppl').all() if '@pau' in r.inner_text()][0]
        check('entreno' not in pau_row.inner_text(), 'De Pau (a quien no sigue) solo se ve nombre y usuario, no sus entrenos')
        check(pau_row.locator('.fol').inner_text() == 'Seguir', 'Botón: Seguir')
        pau_row.locator('[data-a=followtog]').click()
        L.wait_for_selector('.li.ppl .fol:has-text("Solicitado")')
        check(True, 'Laura envía solicitud (queda «Solicitado»)')
        L.click('[data-a=people-back]'); L.wait_for_selector('.soc-hero')
        check('Aún no hay entrenos' in L.inner_text('#app'), 'Mientras no la acepten, el inicio sigue vacío')
        # perfil de Pau = cuenta privada
        L.click('.soc-hero [data-a=people]'); L.wait_for_selector('.li.ppl')
        [r for r in L.locator('.li.ppl').all() if '@pau' in r.inner_text()][0].locator('.by').click()
        L.wait_for_selector('.priv')
        check('Cuenta privada' in L.inner_text('#app') and 'Solicitud enviada' in L.inner_text('.priv'), 'Perfil de Pau: cuenta privada, solicitud enviada')
        check(L.locator('.card.sess').count() == 0, 'No ve sus entrenos')
        L.screenshot(path=OUT + '/b1-privada.png')
        L.click('[data-a=who-back]')

        # ---- Pau (admin) recibe la solicitud y la ve como aviso
        P.click('[data-t=amigos]'); P.wait_for_timeout(1500)
        check(P.locator('.ic-btn .badge').count() == 1 and P.inner_text('.ic-btn .badge') == '1', 'Pau ve el aviso de 1 solicitud')
        check('1 solicitud' in P.inner_text('.banner'), 'Aviso de solicitud en Amigos')
        P.screenshot(path=OUT + '/b2-solicitud.png')
        P.click('.banner'); P.wait_for_selector('.req-b')
        check('Laura' in P.inner_text('.req-b, .ppl') or 'Laura' in P.inner_text('#app'), 'La solicitud es de Laura')
        # rechazar primero para probarlo, Laura reintenta
        P.locator('[data-a=req-reject]').click(); P.wait_for_timeout(800)
        check(P.locator('.req-b').count() == 0, 'Pau rechaza: desaparece la solicitud')
        L.click('[data-a=people]') if L.locator('[data-a=people]').first.count() else None
        L.wait_for_timeout(1200)
        # Laura vuelve a pedir y ahora Pau acepta
        L.click('[data-t=amigos]'); L.click('.soc-hero [data-a=people]'); L.wait_for_selector('.li.ppl')
        pr = [r for r in L.locator('.li.ppl').all() if '@pau' in r.inner_text()][0]
        if pr.locator('.fol').inner_text() == 'Seguir':
            pr.locator('[data-a=followtog]').click(); L.wait_for_selector('.li.ppl .fol:has-text("Solicitado")')
        P.click('[data-t=amigos]'); P.wait_for_timeout(1500); P.click('.banner'); P.wait_for_selector('.req-b')
        P.locator('[data-a=req-accept]').click(); P.wait_for_timeout(800)
        check(P.locator('.req-b').count() == 0, 'Pau acepta la solicitud')
        L.click('[data-t=amigos]'); L.wait_for_timeout(1500)
        check(L.locator('.card.fd').count() >= 0 and 'Cuenta privada' not in L.inner_text('#app'), 'Laura ya puede entrar en el perfil de Pau')
        L.click('.ic-btn.rel'); L.wait_for_selector('.li.ppl'); L.wait_for_timeout(400)
        [r for r in L.locator('.li.ppl').all() if '@pau' in r.inner_text()][0].locator('.by').click()
        L.wait_for_function("() => { const n = document.querySelector('.who-n'); return n && !document.querySelector('.priv') && /Siguiendo/.test(n.textContent); }", timeout=10000)
        check(True, 'Perfil de Pau: ahora Siguiendo y sin candado')

        # ---- Pau es ADMIN: ve los entrenos de Laura sin seguirla y sin dejar rastro
        P.click('[data-t=amigos]'); P.click('.ic-btn.rel'); P.wait_for_selector('.li.ppl')
        laura_row = [r for r in P.locator('.li.ppl').all() if '@laura' in r.inner_text()][0]
        check(laura_row.locator('.fol').inner_text() == 'Seguir', 'Pau NO sigue a Laura (botón Seguir)')
        laura_row.locator('.by').click(); P.wait_for_selector('.who-n', timeout=10000)
        check(L.locator('.priv').count() == 0 and P.locator('.card.sess').count() >= 1 and P.locator('.priv').count() == 0, 'Admin: ve el perfil y los entrenos de Laura aunque ponga «Seguir»')
        P.wait_for_selector('.card.sess .slide.ph img[src^="blob:"]', timeout=15000)
        check(P.locator('.card.sess .slide.ph').count() >= 1, 'Admin: ve también sus fotos (descifradas)')
        check(P.locator('.card.clz').count() == 1 and 'Spinning' in P.inner_text('.card.clz') and '45 min' in P.inner_text('.card.clz'), 'Admin: ve la clase dirigida de Laura (compartida y descifrada)')
        P.screenshot(path=OUT + '/b3-admin-ve.png')
        # ...y eso NO aparece en los seguidores de Laura
        synced(P)
        me_followers = L.evaluate("() => window.__gym.socSync")  # noop ref
        L.click('[data-t=perfil]'); L.wait_for_selector('.me-card'); L.wait_for_timeout(800)
        L.evaluate("() => { window.__rc = null; }")
        L.click('.me-b[data-k=followers]'); L.wait_for_timeout(1200)
        foll = L.inner_text('#app')
        check('Pau' not in foll, 'El administrador NO figura en los seguidores de Laura')
        check(L.evaluate("() => window.__gym.socBusy") is False, 'sin operaciones colgadas')

        # ---- el servidor solo guarda texto cifrado
        dump = server_dump()
        check(len(dump) > 0 and b'Prensa' not in dump and b'Hip thrust' not in dump and b'Piernas' not in dump, 'En el servidor no aparecen ejercicios ni nombres de entreno (cifrados)')
        check(b'laura' in dump, 'Solo los nombres de usuario van en claro')

        # ---- Laura quita a Pau de seguidores (Pau la seguía de forma normal? no; probamos con Laura->Pau ya aceptado)
        # Pau sigue a Laura de forma normal para probar «quitar seguidor»
        P.click('[data-t=amigos]'); P.click('.ic-btn.rel'); P.wait_for_selector('.li.ppl')
        lr = [r for r in P.locator('.li.ppl').all() if '@laura' in r.inner_text()][0]
        lr.locator('[data-a=followtog]').click(); P.wait_for_selector('.li.ppl .fol:has-text("Solicitado")')
        L.click('[data-t=amigos]'); L.wait_for_timeout(1500); L.click('.banner'); L.wait_for_selector('.req-b')
        L.locator('[data-a=req-accept]').click(); L.wait_for_timeout(800)
        L.click('[data-t=perfil]'); L.wait_for_selector('.me-card'); L.wait_for_timeout(600)
        L.click('.me-b[data-k=followers]'); L.wait_for_selector('.li.ppl')
        check('Pau' in L.inner_text('#app'), 'Ahora Pau sí es seguidor normal de Laura')
        L.locator('[data-a=rm-follower]').click(); L.click('[data-a=confirm-yes]'); L.wait_for_timeout(800)
        check('Pau' not in L.inner_text('#app') or L.locator('.empty').count() == 1, 'Laura quita a Pau de seguidores')

        # ---- salir del grupo
        L.click('[data-t=amigos]'); L.click('.ic-btn.rel') if L.locator('.ic-btn.rel').count() else L.click('[data-a=people]')
        L.wait_for_selector('[data-a=soc-leave]'); L.click('[data-a=soc-leave]'); L.click('[data-a=confirm-yes]')
        L.wait_for_function("() => !window.__gym.state.settings.social", timeout=8000)
        check(L.locator('[data-a=soc-start]').count() == 2 and L.evaluate('() => window.__gym.state.sessions.length') >= 1, 'Salir del grupo sin borrar nada del iPhone')

        # tema claro: perfil de otra persona con cuenta privada
        cC, C = page(b, 'light')
        C.evaluate("c => { const s = JSON.parse(localStorage.getItem('gymapp.v1')); s.settings.social = c; localStorage.setItem('gymapp.v1', JSON.stringify(s)); }", P.evaluate('() => window.__gym.state.settings.social'))
        C.reload(); C.wait_for_selector('.routine'); C.click('[data-t=perfil]'); C.wait_for_selector('.me-card'); C.wait_for_timeout(600)
        C.screenshot(path=OUT + '/b4-perfil-claro.png')
        b.close()
finally:
    srv.terminate()
    try: os.killpg(wr.pid, signal.SIGTERM)
    except Exception: pass
print('Errores:', errors or 'ninguno'); print('FALLOS:', fails or 'ninguno')
sys.exit(1 if fails or errors else 0)
