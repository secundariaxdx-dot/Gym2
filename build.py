import os, json
CACHE = 'gym-v7'  # súbelo cuando cambie algo que el iPhone deba recargar (se muestra en Ajustes)
from PIL import Image, ImageDraw
root = os.path.dirname(os.path.abspath(__file__))
src, dist = os.path.join(root, 'src'), root  # la web se genera en la raíz: GitHub Pages la sirve desde ahí
os.makedirs(dist, exist_ok=True)
rd = lambda n: open(os.path.join(src, n), encoding='utf-8').read()
html = rd('template.html')
for key, f in (('{{CSS}}', 'style.css'), ('{{ENGINE}}', 'engine.js'), ('{{SEED}}', 'seed.js'), ('{{LIB}}', 'library.js'), ('{{APP}}', 'app.js')):
    html = html.replace(key, rd(f))
html = html.replace('{{VER}}', CACHE)
open(os.path.join(dist, 'index.html'), 'w', encoding='utf-8').write(html)

manifest = {
  "name": "Gym", "short_name": "Gym", "description": "Registro de entrenos con sobrecarga progresiva",
  "start_url": "./", "scope": "./", "display": "standalone", "orientation": "portrait",
  "background_color": "#0d0e0f", "theme_color": "#0d0e0f", "lang": "es",
  "icons": [
    {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
json.dump(manifest, open(os.path.join(dist, 'manifest.webmanifest'), 'w'), indent=2)

sw = """const CACHE = '%%CACHE%%';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Caché primero: abre al instante aunque la señal sea mala. Se actualiza en segundo plano
// y la versión nueva se ve la siguiente vez que abres la app.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request.url, { cache: 'no-cache' }).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await c.match('index.html')) || Response.error();
  }));
});
"""
open(os.path.join(dist, 'sw.js'), 'w').write(sw.replace('%%CACHE%%', CACHE))

def icon(size):
    S = size * 4
    im = Image.new('RGB', (S, S), (13, 14, 15))
    d = ImageDraw.Draw(im)
    acc = (184, 242, 74)
    cx, cy = S // 2, S // 2
    u = S / 100
    def rr(x0, y0, x1, y1, r):
        d.rounded_rectangle([x0 * u, y0 * u, x1 * u, y1 * u], radius=r * u, fill=acc)
    rr(30, 46, 70, 54, 2)        # barra
    rr(18, 30, 30, 70, 4)        # disco izq
    rr(70, 30, 82, 70, 4)        # disco der
    rr(10, 38, 18, 62, 3)        # tope izq
    rr(82, 38, 90, 62, 3)        # tope der
    return im.resize((size, size), Image.LANCZOS)
for n in (180, 192, 512):
    icon(n).save(os.path.join(dist, 'icon-%d.png' % n))
print('build ok', os.path.getsize(os.path.join(dist, 'index.html')), 'bytes')
