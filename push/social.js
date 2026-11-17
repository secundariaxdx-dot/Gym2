// Parte social de Gym: grupo privado, cuentas privadas (solicitudes de seguimiento) y entrenos/clases.
// Un único Durable Object ("main") con SQLite guarda:
//   - usuarios (nombre de usuario y nombre visible) y seguimientos con estado (pendiente / aceptado),
//   - entrenos y fotos CIFRADOS en el móvil (AES-GCM con la clave del grupo): aquí solo hay texto ilegible.
// Cuentas privadas: para ver los entrenos de alguien hay que enviarle una solicitud y que la acepte.
// El creador del grupo queda marcado como administrador; puede ver a cualquiera sin seguirle y sin dejar
// rastro (no crea seguimiento, no cuenta como seguidor). Ese flag NUNCA sale en ninguna respuesta.

const USER_RE = /^[a-z0-9_.]{3,20}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const UID_RE = /^[a-f0-9]{16}$/;
const MAX_USERS = 30, MAX_POST = 300000, MAX_PHOTO = 450000, MAX_POSTS = 4000;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); };
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const out = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

export class Social {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT, tok TEXT UNIQUE, admin INTEGER DEFAULT 0, created INTEGER)`);
      // state: 'ok' aceptado, 'pending' solicitud enviada sin aceptar
      this.sql.exec(`CREATE TABLE IF NOT EXISTS follows (a TEXT, b TEXT, t INTEGER, state TEXT DEFAULT 'ok', PRIMARY KEY (a, b))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS posts (uid TEXT, id TEXT, t INTEGER, v TEXT, data TEXT, photos TEXT, PRIMARY KEY (uid, id))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS photos (uid TEXT, id TEXT, data TEXT, PRIMARY KEY (uid, id))`);
    });
  }
  q(sql, ...args) { return this.sql.exec(sql, ...args).toArray(); }
  one(sql, ...args) { return this.q(sql, ...args)[0] || null; }
  user(uid) { return this.one(`SELECT uid, username, name, created FROM users WHERE uid = ?`, uid); } // sin admin
  isAdmin(uid) { const r = this.one(`SELECT admin FROM users WHERE uid = ?`, uid); return !!(r && r.admin); }
  followOk(a, b) { const r = this.one(`SELECT state FROM follows WHERE a = ? AND b = ?`, a, b); return !!(r && r.state === 'ok'); }
  rel(me, uid) { if (me === uid) return 'me'; const r = this.one(`SELECT state FROM follows WHERE a = ? AND b = ?`, me, uid); return r ? (r.state === 'ok' ? 'following' : 'pending') : 'none'; }
  // El administrador ve a todos; los demás, solo a quien les ha aceptado (o a sí mismos)
  canSee(me, uid) { return me === uid || this.isAdmin(me) || this.followOk(me, uid); } // siempre booleano (isAdmin y followOk lo son)
  counts(uid) {
    return {
      posts: this.one(`SELECT COUNT(*) AS n FROM posts WHERE uid = ?`, uid).n,
      followers: this.one(`SELECT COUNT(*) AS n FROM follows WHERE b = ? AND state = 'ok'`, uid).n,
      following: this.one(`SELECT COUNT(*) AS n FROM follows WHERE a = ? AND state = 'ok'`, uid).n
    };
  }

  async fetch(req) {
    const path = new URL(req.url).pathname.replace(/^\/s\//, '');
    let b;
    try { b = await req.json(); } catch (e) { return out({ error: 'json' }, 400); }
    if (!b || typeof b !== 'object') return out({ error: 'json' }, 400);

    if (path === 'register') {
      const proof = String(b.proof || ''), username = String(b.username || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 30);
      if (proof.length < 20) return out({ error: 'code' }, 400);
      if (!USER_RE.test(username)) return out({ error: 'username' }, 400);
      if (!name) return out({ error: 'name' }, 400);
      const ph = await sha(proof), cur = this.one(`SELECT v FROM meta WHERE k = 'proof'`);
      if (cur && cur.v !== ph) return out({ error: 'code' }, 403);
      if (this.one(`SELECT 1 AS x FROM users WHERE username = ?`, username)) return out({ error: 'taken' }, 409);
      if (this.one(`SELECT COUNT(*) AS n FROM users`).n >= MAX_USERS) return out({ error: 'full' }, 403);
      if (!cur) this.sql.exec(`INSERT INTO meta (k, v) VALUES ('proof', ?)`, ph);
      const uid = rand(8), token = rand(32);
      // quien crea el grupo (primer registro) queda como administrador
      this.sql.exec(`INSERT INTO users (uid, username, name, tok, admin, created) VALUES (?, ?, ?, ?, ?, ?)`, uid, username, name, await sha(token), cur ? 0 : 1, Date.now());
      return out({ uid, token, created: !cur });
    }

    const tk = String(b.token || '');
    const me = tk.length === 64 ? this.one(`SELECT uid FROM users WHERE tok = ?`, await sha(tk)) : null;
    if (!me) return out({ error: 'auth' }, 401);
    const uid = me.uid;

    switch (path) {
      case 'me': {
        return out({ user: this.user(uid), counts: this.counts(uid),
          following: this.q(`SELECT b FROM follows WHERE a = ? AND state = 'ok'`, uid).map(r => r.b),
          followers: this.q(`SELECT a FROM follows WHERE b = ? AND state = 'ok'`, uid).map(r => r.a),
          requests: this.q(`SELECT a FROM follows WHERE b = ? AND state = 'pending' ORDER BY t`, uid).map(r => this.user(r.a)),
          pending: this.q(`SELECT b FROM follows WHERE a = ? AND state = 'pending'`, uid).map(r => r.b) });
      }
      case 'users': {
        // solo nombre y usuario de cada persona, más mi relación; conteos solo de quien puedo ver
        return out({ users: this.q(`SELECT uid, username, name, created FROM users ORDER BY created`).map(u => {
          const o = { uid: u.uid, username: u.username, name: u.name, created: u.created, rel: this.rel(uid, u.uid) };
          if (this.canSee(uid, u.uid)) o.posts = this.counts(u.uid).posts;
          return o;
        }) });
      }
      case 'request': {
        const o = String(b.uid || '');
        if (!UID_RE.test(o) || o === uid || !this.user(o)) return out({ error: 'uid' }, 400);
        if (!this.one(`SELECT 1 AS x FROM follows WHERE a = ? AND b = ?`, uid, o)) this.sql.exec(`INSERT INTO follows (a, b, t, state) VALUES (?, ?, ?, 'pending')`, uid, o, Date.now());
        return out({ ok: true, rel: this.rel(uid, o) });
      }
      case 'unfollow': { // cancelar solicitud o dejar de seguir
        this.sql.exec(`DELETE FROM follows WHERE a = ? AND b = ?`, uid, String(b.uid || ''));
        return out({ ok: true });
      }
      case 'accept': {
        const o = String(b.uid || '');
        this.sql.exec(`UPDATE follows SET state = 'ok', t = ? WHERE a = ? AND b = ? AND state = 'pending'`, Date.now(), o, uid);
        return out({ ok: true });
      }
      case 'reject': { // rechazar solicitud entrante
        this.sql.exec(`DELETE FROM follows WHERE a = ? AND b = ? AND state = 'pending'`, String(b.uid || ''), uid);
        return out({ ok: true });
      }
      case 'remove': { // quitar a un seguidor
        this.sql.exec(`DELETE FROM follows WHERE a = ? AND b = ? AND state = 'ok'`, String(b.uid || ''), uid);
        return out({ ok: true });
      }
      case 'profile': {
        const o = String(b.uid || ''), u = this.user(o);
        if (!u) return out({ error: 'uid' }, 404);
        const see = this.canSee(uid, o);
        const r = { user: u, rel: this.rel(uid, o), followsMe: this.followOk(o, uid), canSee: see };
        if (see) r.counts = this.counts(o);
        return out(r);
      }
      case 'rename': {
        const name = String(b.name || '').trim().slice(0, 30);
        if (!name) return out({ error: 'name' }, 400);
        this.sql.exec(`UPDATE users SET name = ? WHERE uid = ?`, name, uid);
        return out({ ok: true });
      }
      case 'index': {
        return out({ posts: this.q(`SELECT id, v FROM posts WHERE uid = ?`, uid), photos: this.q(`SELECT id FROM photos WHERE uid = ?`, uid).map(r => r.id) });
      }
      case 'post': {
        const id = String(b.id || ''), data = String(b.data || ''), t = Number(b.t) || 0, v = String(b.v || '').slice(0, 40);
        const photos = Array.isArray(b.photos) ? b.photos.filter(x => ID_RE.test(String(x))).slice(0, 12) : [];
        if (!ID_RE.test(id) || !data || data.length > MAX_POST || !t) return out({ error: 'post' }, 400);
        if (!this.one(`SELECT 1 AS x FROM posts WHERE uid = ? AND id = ?`, uid, id) && this.one(`SELECT COUNT(*) AS n FROM posts WHERE uid = ?`, uid).n >= MAX_POSTS) return out({ error: 'full' }, 403);
        this.sql.exec(`INSERT OR REPLACE INTO posts (uid, id, t, v, data, photos) VALUES (?, ?, ?, ?, ?, ?)`, uid, id, t, v, data, JSON.stringify(photos));
        return out({ ok: true });
      }
      case 'del': {
        this.sql.exec(`DELETE FROM posts WHERE uid = ? AND id = ?`, uid, String(b.id || ''));
        return out({ ok: true });
      }
      case 'photo-put': {
        const id = String(b.id || ''), data = String(b.data || '');
        if (!ID_RE.test(id) || !data || data.length > MAX_PHOTO) return out({ error: 'photo' }, 400);
        this.sql.exec(`INSERT OR REPLACE INTO photos (uid, id, data) VALUES (?, ?, ?)`, uid, id, data);
        return out({ ok: true });
      }
      case 'photo-del': {
        this.sql.exec(`DELETE FROM photos WHERE uid = ? AND id = ?`, uid, String(b.id || ''));
        return out({ ok: true });
      }
      case 'photo': {
        const o = String(b.uid || ''), id = String(b.id || '');
        if (!this.canSee(uid, o)) return out({ error: 'forbidden' }, 403);
        const r = this.one(`SELECT data FROM photos WHERE uid = ? AND id = ?`, o, id);
        return r ? out({ data: r.data }) : out({ error: 'missing' }, 404);
      }
      case 'list': {
        const o = String(b.uid || uid);
        if (!this.canSee(uid, o)) return out({ error: 'forbidden' }, 403);
        return out({ posts: this.q(`SELECT id, t, data, photos FROM posts WHERE uid = ? ORDER BY t DESC LIMIT 1500`, o).map(p => ({ uid: o, id: p.id, t: p.t, data: p.data, photos: JSON.parse(p.photos || '[]') })) });
      }
      case 'feed': {
        // entrenos de quien sigo (aceptado); el administrador NO ve a todos en el inicio, solo a quien sigue
        const before = Number(b.before) || 8.64e15, limit = Math.min(50, Math.max(1, Number(b.limit) || 20));
        const rows = this.q(`SELECT p.uid AS uid, p.id AS id, p.t AS t, p.data AS data, p.photos AS photos FROM posts p JOIN follows f ON f.b = p.uid AND f.a = ? AND f.state = 'ok'
                             WHERE p.t < ? ORDER BY p.t DESC LIMIT ?`, uid, before, limit);
        const users = {};
        rows.forEach(r => { if (!users[r.uid]) users[r.uid] = this.user(r.uid); });
        return out({ posts: rows.map(p => ({ uid: p.uid, id: p.id, t: p.t, data: p.data, photos: JSON.parse(p.photos || '[]') })), users });
      }
      case 'leave': {
        this.sql.exec(`DELETE FROM posts WHERE uid = ?`, uid);
        this.sql.exec(`DELETE FROM photos WHERE uid = ?`, uid);
        this.sql.exec(`DELETE FROM follows WHERE a = ? OR b = ?`, uid, uid);
        this.sql.exec(`DELETE FROM users WHERE uid = ?`, uid);
        return out({ ok: true });
      }
    }
    return out({ error: 'not found' }, 404);
  }
}
