"""Las pruebas antiguas simulan el iPhone de Pau: desde v3.4 una instalación nueva ya no trae sus pesos de partida,
así que aquí se los ponemos (solo si el almacenamiento está vacío), como los tiene su iPhone desde v1.0."""
from playwright.sync_api import Browser
JS = """(() => { let v; Object.defineProperty(window, 'SEED', { configurable: true, get() { return v; }, set(x) { v = x;
  try { if (!localStorage.getItem('gymapp.v1')) localStorage.setItem('gymapp.v1', JSON.stringify({ v: 1, exercises: x.exercises, routines: x.routines,
    sessions: [], activities: [], routineOrder: ['push', 'pull', 'legs'], active: null, settings: { sound: true, lastBackup: 0, actFatigue: true, seedMine: true }, created: Date.now() })); } catch (e) {} } }); })()"""
_orig = Browser.new_context
def _nc(self, *a, **k):
    c = _orig(self, *a, **k); c.add_init_script(JS); return c
Browser.new_context = _nc
