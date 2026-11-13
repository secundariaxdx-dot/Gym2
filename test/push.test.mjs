// Prueba el Worker de avisos en local (wrangler dev) contra un servicio push falso.
// Requiere: cd push && npm install, y push/.dev.vars con DEV_ORIGINS=1 y VAPID_PRIVATE_JWK.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUSH = path.join(ROOT, 'push');
const W = 'http://localhost:8787', FAKE = 8781, ORIGIN = 'http://localhost:8768';
const fails = [];
const check = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const jwk = JSON.parse(fs.readFileSync(path.join(PUSH, '.dev.vars'), 'utf8').match(/VAPID_PRIVATE_JWK=(.*)/)[1]);
const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });

// servicio push falso: guarda las peticiones; /gone devuelve 410
const got = [];
const fake = http.createServer((req, res) => { got.push({ url: req.url, h: req.headers, t: Date.now() }); res.writeHead(req.url === '/gone' ? 410 : 201); res.end(); }).listen(FAKE);

const wr = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1', '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'gympush-'))], { cwd: PUSH, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; wr.stdout.on('data', d => log += d); wr.stderr.on('data', d => log += d);

const post = (p, body, origin = ORIGIN) => fetch(W + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
const id = crypto.randomBytes(16).toString('hex');

try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(W + '/'); if (r.ok) break; } catch (e) { /* aún arrancando */ } await sleep(500); }
  check((await (await fetch(W + '/')).text()) === 'gym-push ok', 'Worker arranca');

  check((await post('/sub', { id }, 'https://otra-web.com')).status === 403, 'Rechaza otros orígenes');
  check((await post('/sub', { id: 'x' })).status === 400, 'Rechaza id inválido');
  const pre = await fetch(W + '/arm', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'CORS preflight');
  check((await post('/arm', { id, at: Date.now() + 2000 })).status === 409, 'Sin suscripción no programa');
  check((await post('/sub', { id, sub: { endpoint: 'http://localhost:' + FAKE + '/ep1', keys: {} } })).status === 200, 'Guarda la suscripción');
  check((await post('/arm', { id, at: Date.now() + 30 * 60000 })).status === 400, 'Rechaza descansos de más de 20 min');

  // envío inmediato y cabeceras VAPID válidas
  got.length = 0;
  const tr = await (await post('/test', { id })).json();
  check(tr.ok && got.length === 1 && got[0].url === '/ep1', 'Prueba envía un push: ' + JSON.stringify(tr));
  const h = got[0] && got[0].h || {};
  const m = (h.authorization || '').match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  check(!!m, 'Cabecera Authorization vapid');
  if (m) {
    const ok = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
    const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
    const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
    check(ok, 'Firma ES256 válida');
    check(claims.aud === 'http://localhost:' + FAKE && claims.exp > Date.now() / 1000 && /^https:/.test(claims.sub), 'Claims aud/exp/sub: ' + JSON.stringify(claims));
    check(m[4] === pubRaw, 'k = clave pública');
  }
  check(h.ttl === '60' && h.urgency === 'high', 'TTL 60 y Urgency high');

  // alarma al final del descanso
  got.length = 0;
  const at = Date.now() + 2000;
  await post('/arm', { id, at });
  await sleep(4500);
  check(got.length === 1, 'La alarma envía 1 push: ' + got.length);
  if (got[0]) check(got[0].t >= at - 300 && got[0].t < at + 2000, 'Llega a tiempo (desfase ' + (got[0].t - at) + ' ms)');

  // reprogramar (±15 s) sustituye la alarma anterior
  got.length = 0;
  await post('/arm', { id, at: Date.now() + 1500 });
  await post('/arm', { id, at: Date.now() + 3500 });
  await sleep(2500); check(got.length === 0, 'Reprogramar sustituye la alarma anterior');
  await sleep(2500); check(got.length === 1, 'Y suena en la hora nueva');

  // cancelar
  got.length = 0;
  await post('/arm', { id, at: Date.now() + 1500 });
  check((await post('/cancel', { id })).status === 200, 'Cancelar responde');
  await sleep(3000); check(got.length === 0, 'Cancelado: no llega push');

  // suscripción caducada (410) se borra
  await post('/sub', { id, sub: { endpoint: 'http://localhost:' + FAKE + '/gone' } });
  await post('/test', { id });
  check((await post('/arm', { id, at: Date.now() + 2000 })).status === 409, 'Suscripción caducada se borra');
} catch (e) {
  fails.push(String(e)); console.log(String(e)); console.log(log.slice(-3000));
} finally {
  try { process.kill(-wr.pid, 'SIGTERM'); } catch (e) { /* ya cerrado */ } fake.close();
}
console.log('FALLOS:', fails.length ? fails : 'ninguno');
process.exit(fails.length ? 1 : 0);
