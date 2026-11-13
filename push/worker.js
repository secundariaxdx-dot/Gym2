// Servidor de avisos de descanso para Gym (Cloudflare Worker + Durable Object).
// Cada iPhone tiene un id aleatorio; su Durable Object guarda la suscripción push y
// programa una alarma para el final del descanso. Al saltar, envía un Web Push sin
// contenido (el service worker de la app pone el texto). No guarda nada más.
//
// Rutas (POST, JSON): /sub {id, sub}  /arm {id, at}  /cancel {id}  /test {id}  /status {id}
// Secreto: VAPID_PRIVATE_JWK (JWK de la clave privada P-256). Var: VAPID_SUB.

const ORIGINS = ['https://secundariaxdx-dot.github.io'];
const PUSH_HOSTS = /^(web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)$/;
const ID_RE = /^[a-f0-9]{32}$/;
const MAX_AHEAD = 20 * 60 * 1000; // un descanso no dura más de 20 min

function cors(req, env) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGINS.includes(o) || (env.DEV_ORIGINS === '1' && /^http:\/\/localhost(:\d+)?$/.test(o));
  return ok ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : null;
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...h } });

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: h ? 204 : 403, headers: h || {} });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('gym-push ok');
    if (!h) return json({ error: 'origin' }, 403);
    if (req.method !== 'POST' || !['/sub', '/arm', '/cancel', '/test', '/status'].includes(url.pathname)) return json({ error: 'not found' }, 404, h);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'json' }, 400, h); }
    if (!body || !ID_RE.test(body.id || '')) return json({ error: 'id' }, 400, h);
    if (url.pathname === '/sub') {
      const ep = body.sub && body.sub.endpoint;
      let host = '';
      try { host = new URL(ep).hostname; } catch (e) { /* nada */ }
      if (!(env.DEV_ORIGINS === '1' ? /^https?:/.test(ep || '') : /^https:/.test(ep || '') && PUSH_HOSTS.test(host))) return json({ error: 'endpoint' }, 400, h);
    }
    if (url.pathname === '/arm') {
      const at = Number(body.at), now = Date.now();
      if (!(at > now - 5000 && at < now + MAX_AHEAD)) return json({ error: 'at' }, 400, h);
    }
    const stub = env.REST.get(env.REST.idFromName(body.id));
    const r = await stub.fetch('https://do' + url.pathname, { method: 'POST', body: JSON.stringify(body) });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', ...h } });
  }
};

export class Rest {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(req) {
    const path = new URL(req.url).pathname, body = await req.json(), st = this.ctx.storage;
    if (path === '/sub') { await st.put('sub', { endpoint: body.sub.endpoint }); return json({ ok: true }, 200); }
    if (path === '/cancel') { await st.deleteAlarm(); await st.delete('at'); return json({ ok: true }, 200); }
    if (path === '/status') return json({ sub: !!(await st.get('sub')), at: (await st.get('at')) || 0, last: (await st.get('last')) || null }, 200);
    if (!(await st.get('sub'))) return json({ error: 'nosub' }, 409);
    if (path === '/arm') { await st.put('at', Number(body.at)); await st.setAlarm(Math.max(Date.now(), Number(body.at))); return json({ ok: true }, 200); }
    if (path === '/test') { const s = await this.send(); return json({ ok: s.status >= 200 && s.status < 300, status: s.status, reason: s.reason }, 200); }
    return json({ error: 'not found' }, 404);
  }
  async alarm() { await this.ctx.storage.delete('at'); await this.send(); }
  async send() {
    const sub = await this.ctx.storage.get('sub'); if (!sub) return { status: 0, reason: 'nosub' };
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidAuth(sub.endpoint, this.env), TTL: '60', Urgency: 'high', 'Content-Length': '0' }
    });
    if (r.status === 404 || r.status === 410) await this.ctx.storage.delete('sub'); // suscripción caducada
    let reason = '';
    if (r.status >= 300) { try { reason = (await r.text()).slice(0, 200); } catch (e) { /* nada */ } }
    await this.ctx.storage.put('last', { t: Date.now(), status: r.status, reason });
    return { status: r.status, reason };
  }
}

// ---- VAPID (RFC 8292): JWT ES256 firmado con la clave privada
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let keyCache = null;
async function vapidAuth(endpoint, env) {
  if (!keyCache) {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const pub = new Uint8Array(65); pub[0] = 4; pub.set(fromB64u(jwk.x), 1); pub.set(fromB64u(jwk.y), 33);
    keyCache = { key, pub: b64u(pub) };
  }
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUB };
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc(claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyCache.key, new TextEncoder().encode(data));
  return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + keyCache.pub;
}
