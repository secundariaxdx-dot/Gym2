"""v3.4: cada usuario con sus propios datos. Tres iPhones simulados (contextos separados):
   Pau (datos ya guardados con los pesos de partida), Novia nueva (instalación limpia) y Amiga que heredó los pesos de Pau."""
import subprocess, sys, time, os, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '-d', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://localhost:8771/'
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

def phone(b):
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    return ctx, ctx.new_page()

def aj(pg):
    pg.click('#tabs [data-a=tab][data-t=perfil]'); pg.click('[data-a=tab][data-t=aj]')

def seed_state(pg):
    """Estado como el de una instalación antigua (v3.3): ejercicios con los pesos de partida + una sesión propia."""
    return pg.evaluate('''() => { const s = JSON.parse(JSON.stringify({v:1, exercises: SEED.exercises, routines: SEED.routines,
      sessions:[{id:'s1', routine:'pull', t: Date.now()-86400000, start: Date.now()-90000000, exercises:[{exId:'jalon', sets:[{w:107.5,r:10}]}]}],
      activities:[], routineOrder:['push','pull','legs'], active:null,
      settings:{sound:true,lastBackup:0,actFatigue:true, social:{uid:'u1',token:'SECRETO',username:'pau',name:'Pau',code:'GYM1-XXXX'}}, created: 1}));
      return s; }''')

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

        # --- Novia: instalación nueva, a cero
        c2, n = phone(b)
        n.goto(URL); n.wait_for_selector('.routine')
        st = n.evaluate('window.__gym.state')
        check(all('baseline' not in e for e in st['exercises']), 'Usuario nuevo: ningún ejercicio trae los pesos de Pau')
        check(len(st['sessions']) == 0 and len(st['routines']) > 0, 'Usuario nuevo: sin historial pero con las rutinas de plantilla')
        plan = n.evaluate("(() => { const G = window.__gym, ex = G.state.exercises.find(e => e.id==='jalon'); return G.E.planSets(ex, G.E.reference(ex, G.state.sessions)); })()")
        check(all(s['w'] == 0 for s in plan), 'Usuario nuevo: el primer entreno no propone los pesos de Pau')
        aj(n); time.sleep(0.3)
        check(n.locator('#seed-card').count() == 0, 'Usuario nuevo: no le sale el aviso de pesos de partida')

        # --- Pau: datos de antes intactos
        c1, a = phone(b)
        a.goto(URL); a.wait_for_selector('.routine')
        old = seed_state(a)
        a.evaluate('s => localStorage.setItem("gymapp.v1", JSON.stringify(s))', old)
        a.reload(); a.wait_for_selector('.routine')
        st = a.evaluate('window.__gym.state')
        check(st['exercises'][0].get('baseline') == old['exercises'][0]['baseline'], 'Pau: sus pesos de partida se conservan al actualizar')
        check(len(st['sessions']) == 1 and st['sessions'][0]['exercises'][0]['sets'][0]['w'] == 107.5, 'Pau: su historial se conserva')
        aj(a); a.wait_for_selector('#seed-card')
        check(True, 'Pau: en Ajustes ve la tarjeta «Pesos de partida»')
        a.click('#seed-card [data-a=seed-mine]'); time.sleep(0.2)
        check(a.locator('#seed-card').count() == 0, 'Pau: «Son míos» oculta la tarjeta')
        st = a.evaluate('window.__gym.state')
        check(sum(1 for e in st['exercises'] if 'baseline' in e) == len(old['exercises']), 'Pau: «Son míos» no quita nada')
        txt = a.evaluate('window.__gym.exportData()')
        if txt:
            d = json.loads(txt)
            check('social' not in d['settings'] and 'SECRETO' not in txt and 'GYM1-XXXX' not in txt, 'Copia de seguridad: sin token ni código del grupo')
            check(len(d['sessions']) == 1, 'Copia de seguridad: lleva el historial')
        else:
            check(False, 'No se pudo leer el texto de la copia')

        # --- Amiga que heredó los pesos de Pau
        c3, m = phone(b)
        m.goto(URL); m.wait_for_selector('.routine')
        st0 = seed_state(m); st0['settings'].pop('social')
        m.evaluate('s => localStorage.setItem("gymapp.v1", JSON.stringify(s))', st0)
        m.reload(); m.wait_for_selector('.routine')
        aj(m); m.wait_for_selector('#seed-card')
        m.click('#seed-card [data-a=seed-clear]'); m.wait_for_selector('.modal, .sheet');
        m.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim()==='Quitar' && !x.dataset.a.startsWith('seed')).click()")
        time.sleep(0.3)
        st = m.evaluate('window.__gym.state')
        check(all('baseline' not in e for e in st['exercises']), 'Heredado: «Quitar» deja los ejercicios sin los pesos de Pau')
        check(len(st['sessions']) == 1, 'Heredado: sus entrenos guardados no se tocan')
        m.reload(); m.wait_for_selector('.routine')
        check(all('baseline' not in e for e in m.evaluate('window.__gym.state.exercises')), 'Heredado: sigue así tras cerrar y abrir')
        aj(m); m.wait_for_selector('[data-a=seed-undo]')
        m.click('[data-a=seed-undo]'); time.sleep(0.2)
        check(sum(1 for e in m.evaluate('window.__gym.state.exercises') if 'baseline' in e) == len(st0['exercises']), 'Heredado: «Recuperarlos» los devuelve')

        # --- aislamiento entre teléfonos: lo de uno no aparece en otro
        check(n.evaluate('window.__gym.state.sessions.length') == 0, 'La novia sigue sin el historial de Pau')
        b.close()
finally:
    srv.terminate()
print('\n' + ('TODO OK' if not fails else 'FALLOS: %d' % len(fails)))
sys.exit(1 if fails else 0)
