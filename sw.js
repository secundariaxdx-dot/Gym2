const CACHE = 'gym-v12';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'gym-meta').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Caché primero: abre al instante aunque la señal sea mala. Se actualiza en segundo plano
// y la versión nueva se ve la siguiente vez que abres la app.
// Aviso de fin de descanso. El servidor manda un push vacío; el texto (siguiente serie)
// lo dejó la app en la caché 'gym-meta' al marcar la serie, sin salir del iPhone.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let body = 'A por la siguiente serie 💪';
    try {
      const r = await (await caches.open('gym-meta')).match('/__next');
      const n = r && await r.json();
      if (n && n.body && Math.abs(Date.now() - n.end) < 15 * 60000) body = n.body;
    } catch (err) { /* texto por defecto */ }
    await self.registration.showNotification('⏱️ Descanso terminado', { body, tag: 'rest', renotify: true, icon: 'icon-192.png' });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request.url, { cache: 'no-cache' }).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await c.match('index.html')) || Response.error();
  }));
});
