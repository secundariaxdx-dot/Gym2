// Prueba la parte social del Worker en local (wrangler dev): grupo con código, cuentas privadas
// (solicitudes), administrador oculto, entrenos/fotos cifrados y permisos.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = 'http://localhost:8788', ORIGIN = 'http://localhost:8768';
const fails = [];
const check = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'gymsoc-'));
const wr = spawn('npx', ['wrangler', 'dev', '--port', '8788', '--ip', '127.0.0.1', '--persist-to', store],
  { cwd: path.join(ROOT, 'push'), env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; wr.stdout.on('data', d => log += d); wr.stderr.on('data', d => log += d);
const call = async (p, body, origin = ORIGIN) => { const r = await fetch(W + '/s/' + p, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const dump = () => { let s = ''; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { s += fs.readFileSync(p, 'latin1'); } catch (x) {} } }); walk(store); return s; };

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(W + '/')).ok) break; } catch (e) {} await sleep(500); }
  const PROOF = 'prueba-del-codigo-del-grupo-0123456789', BAD = 'otro-codigo-cualquiera-9876543210';
  check((await call('register', { proof: PROOF, username: 'pau', name: 'Pau' }, 'https://otra.web')).s === 403, 'Rechaza otros orígenes');
  const a = await call('register', { proof: PROOF, username: 'pau', name: 'Pau' });          // admin
  const b = await call('register', { proof: PROOF, username: 'laura', name: 'Laura' });
  const c = await call('register', { proof: PROOF, username: 'ana', name: 'Ana' });
  check(a.j.created === true && b.j.created === false && c.j.created === false, 'El primero crea el grupo; los demás entran con el código');
  check((await call('register', { proof: BAD, username: 'intrusa', name: 'X' })).s === 403, 'Sin el código no se entra');
  const A = a.j.token, B = b.j.token, C = c.j.token, uA = a.j.uid, uB = b.j.uid, uC = c.j.uid;

  // Laura y Ana publican (cifrado: aquí es texto opaco)
  await call('post', { token: B, id: 's1', t: 2000, v: 'v', data: 'CIF-LAURA-1', photos: ['p1'] });
  await call('post', { token: B, id: 's2', t: 3000, v: 'v', data: 'CIF-LAURA-2', photos: [] });
  await call('photo-put', { token: B, id: 'p1', data: 'FOTO-LAURA' });
  await call('post', { token: C, id: 'a1', t: 2500, v: 'v', data: 'CIF-ANA-1', photos: [] });

  // ---- cuentas privadas: sin aceptar no se ve nada
  check((await call('users', { token: A })).j.users.every(u => !('admin' in u)), 'El flag de administrador no sale en la lista de usuarios');
  const uu = (await call('users', { token: B })).j.users;
  check(uu.length === 3 && uu.every(u => u.name && u.username), 'Lista: nombre y usuario de todos');
  check(uu.filter(u => u.uid !== uB).every(u => !('posts' in u)), 'De quien no sigo no se ve ni cuántos entrenos tiene');
  check((await call('list', { token: B, uid: uA })).s === 403 && (await call('photo', { token: B, uid: uA, id: 'p1' })).s === 403, 'Laura no ve a Pau sin que la acepte');
  const pf0 = (await call('profile', { token: B, uid: uA })).j; check(pf0.canSee === false, 'Perfil de alguien privado: canSee false');

  // ---- solicitud -> aceptar
  check((await call('request', { token: B, uid: uA })).j.rel === 'pending', 'Laura envía solicitud a Pau');
  check((await call('list', { token: B, uid: uA })).s === 403, 'Mientras no acepte, Laura sigue sin ver');
  check((await call('me', { token: B })).j.pending[0] === uA, 'Laura ve su solicitud pendiente');
  const reqs = (await call('me', { token: A })).j.requests;
  check(reqs.length === 1 && reqs[0].uid === uB && reqs[0].name === 'Laura', 'Pau ve la solicitud entrante');
  check((await call('me', { token: A })).j.counts.followers === 0, 'Una solicitud pendiente no cuenta como seguidor');
  await call('post', { token: A, id: 'pw1', t: 4000, v: 'v', data: 'CIF-PAU-1', photos: [] });
  await call('accept', { token: A, uid: uB });
  check((await call('list', { token: B, uid: uA })).j.posts[0].data === 'CIF-PAU-1', 'Aceptada: Laura ya ve los entrenos de Pau');
  check((await call('me', { token: A })).j.counts.followers === 1 && (await call('me', { token: A })).j.requests.length === 0, 'Ahora sí cuenta como seguidor y no quedan solicitudes');
  check((await call('feed', { token: B })).j.posts.length === 1, 'El inicio de Laura muestra el entreno de Pau');

  // ---- rechazar
  await call('request', { token: C, uid: uB });
  await call('reject', { token: B, uid: uC });
  check((await call('me', { token: B })).j.requests.length === 0 && (await call('list', { token: C, uid: uB })).s === 403, 'Rechazar elimina la solicitud y Ana no ve a Laura');

  // ---- quitar seguidor
  await call('request', { token: C, uid: uB }); await call('accept', { token: B, uid: uC });
  check((await call('list', { token: C, uid: uB })).s === 200, 'Ana sigue a Laura tras aceptar');
  await call('remove', { token: B, uid: uC });
  check((await call('list', { token: C, uid: uB })).s === 403 && (await call('me', { token: B })).j.counts.followers === 0, 'Laura quita a Ana de sus seguidores');

  // ---- administrador: ve a cualquiera SIN seguir y SIN dejar rastro
  check((await call('list', { token: A, uid: uB })).j.posts.length === 2, 'Pau (admin) ve los entrenos de Laura sin seguirla');
  check((await call('photo', { token: A, uid: uB, id: 'p1' })).j.data === 'FOTO-LAURA', 'Y sus fotos');
  check((await call('list', { token: A, uid: uC })).j.posts.length === 1, 'Y los de Ana, sin seguirla');
  const pl = (await call('profile', { token: A, uid: uB })).j;
  check(pl.canSee === true && pl.rel === 'none', 'El admin puede ver aunque su relación sea «ninguna»');
  check((await call('me', { token: B })).j.counts.followers === 0, 'Que el admin la vea NO la suma como seguidora de Laura');
  check((await call('me', { token: B })).j.followers.indexOf(uA) < 0 && (await call('me', { token: B })).j.requests.length === 0, 'El admin no aparece como seguidor ni como solicitud');
  // Ana (no admin) nunca ve a quien no le acepta
  check((await call('list', { token: C, uid: uA })).s === 403, 'Una cuenta normal NO puede ver a quien no le ha aceptado');

  // ---- el servidor solo guarda texto cifrado
  const d = dump();
  check(d.length > 0 && !d.includes('CIF-LAURA') === false && !d.includes('Piernas'), 'Los entrenos van cifrados (el texto en claro no aparece)');
  check(d.includes('laura') && d.includes('ana'), 'Solo los nombres de usuario van en claro');

  // ---- salir del grupo
  check((await call('leave', { token: C })).s === 200 && (await call('me', { token: C })).s === 401, 'Ana se da de baja');
  check((await call('users', { token: A })).j.users.length === 2, 'Ya no está en el grupo');
} catch (e) {
  fails.push(String(e)); console.log(String(e)); console.log(log.slice(-3000));
} finally {
  try { process.kill(-wr.pid, 'SIGTERM'); } catch (e) {}
}
console.log('FALLOS:', fails.length ? fails : 'ninguno');
process.exit(fails.length ? 1 : 0);
