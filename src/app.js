(function () {
  'use strict';
  var E = window.Engine, SEED = window.SEED;
  var KEY = 'gymapp.v1';
  var LB = 0.45359237;
  var MUSCLES = ['Pecho', 'Hombros', 'Tríceps', 'Bíceps', 'Antebrazos', 'Dorsales', 'Espalda', 'Trapecio', 'Lumbares', 'Abdominales', 'Cuádriceps', 'Isquios', 'Glúteos', 'Aductores', 'Gemelos'];
  var EQUIP = { maquina: 'Máquina', polea: 'Polea / cable', mancuerna: 'Mancuerna', barra: 'Barra', corporal: 'Peso corporal' };
  var STEP_DEFAULT = { maquina: 5, polea: 2.5, mancuerna: 2, barra: 2.5, corporal: 1 };
  var FAT = { 1: 'Baja', 2: 'Media', 3: 'Alta' };

  /* ---------- utilidades ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return parseFloat(String(v).replace(',', '.')); }
  function fmt(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + two(sec % 60); }
  function fmtDate(t) { return new Date(t).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function ago(t) {
    var h = (Date.now() - t) / 3600000;
    if (h < 1) return 'hace menos de 1 h';
    if (h < 48) return 'hace ' + Math.round(h) + ' h';
    return 'hace ' + Math.round(h / 24) + ' d';
  }
  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'ej'; }

  /* ---------- estado y guardado ---------- */
  var memoryOnly = false;
  function fresh() {
    return {
      v: 1, exercises: JSON.parse(JSON.stringify(SEED.exercises)), routines: JSON.parse(JSON.stringify(SEED.routines)),
      sessions: [], activities: [], routineOrder: ['push', 'pull', 'legs'], active: null, settings: { sound: true, lastBackup: 0, actFatigue: true }, created: Date.now()
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.v === 1 && s.exercises && s.routines) { s.settings = s.settings || { sound: true, lastBackup: 0 }; if (s.settings.actFatigue === undefined) s.settings.actFatigue = true; s.sessions = s.sessions || []; s.activities = s.activities || []; return s; } }
    } catch (e) { memoryOnly = true; }
    return fresh();
  }
  var state = load();
  var timer = state.timer || null; // el descanso en marcha sobrevive a un reinicio de la app
  var saveT = null;
  function save() { if (saveT) { clearTimeout(saveT); saveT = null; } state.timer = timer; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; } if (typeof socSoon === 'function') socSoon(); }
  // Al escribir: guarda cuando paras medio segundo (y siempre al salir de la app), no en cada tecla
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(function () { saveT = null; save(); }, 500); }
  document.addEventListener('visibilitychange', function () { if (document.hidden && saveT) save(); });
  window.addEventListener('pagehide', function () { if (saveT) save(); });
  save();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }

  var ui = { tab: 'hoy', modal: null, query: '', histOpen: null, toast: '', cal: null, fm: '', fe: '' };
  function fatigueSessions() { return state.settings.actFatigue === false ? state.sessions : state.sessions.concat(E.activitiesAsSessions(state.activities)); }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
  function exMap() { var m = {}; state.exercises.forEach(function (e) { m[e.id] = e; }); return m; }
  function exById(id) { for (var i = 0; i < state.exercises.length; i++) if (state.exercises[i].id === id) return state.exercises[i]; return null; }

  /* ---------- entreno en curso ---------- */
  function buildEntry(ex, taken) {
    var ref = E.reference(ex, state.sessions);
    var plan = E.planSets(ex, ref);
    var first = !taken[ex.muscle];
    taken[ex.muscle] = 1;
    var hist = E.history(ex, state.sessions);
    var st = E.stallInfo(ex, hist);
    return {
      exId: ex.id, name: ex.name, muscle: ex.muscle, sec: ex.sec || [], fatigue: ex.fatigue || 2,
      prevBest: hist.reduce(function (a, h) { return Math.max(a, E.bestE1(h.sets)); }, 0), celebrated: false,
      plan: plan, warm: E.warmups(ex, plan[0] ? plan[0].w : 0, first),
      last: ref ? ref.sets : [], hasHist: !!ref,
      stall: st.stalled ? { prevBest: st.prevBest, n: st.n } : null,
      sets: plan.map(function (p) { return { w: p.w ? p.w : '', r: '', done: false }; })
    };
  }
  function takenMuscles(a) { var t = {}; a.entries.forEach(function (e) { t[e.muscle] = 1; }); return t; }
  function startWorkout(key) {
    var taken = {}, entries = [];
    if (key !== 'free') {
      state.routines[key].ids.forEach(function (id) { var ex = exById(id); if (ex) entries.push(buildEntry(ex, taken)); });
    }
    state.active = { id: uid(), key: key, name: key === 'free' ? 'Sesión libre' : state.routines[key].name, t0: Date.now(), entries: entries, open: 0 };
    save(); ui.tab = 'hoy'; wake(); render();
  }

  function startTimer(ex) {
    var rest = E.restFor(ex || {});
    timer = { end: Date.now() + rest * 1000, total: rest, fired: false };
    save(); updateTimer(); pushSync(); clockSync();
  }
  function clearTimer() { if (timer && timer.armed) pushStop(); timer = null; }

  /* ---------- aviso con la app cerrada (Web Push vía servidor gym-push) ---------- */
  var PUSH = window.__GYM_PUSH || { url: '{{PUSH_URL}}', key: '{{PUSH_KEY}}' };
  if (/\{\{/.test(PUSH.url)) PUSH.url = '';
  function noop() { }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function pushReady() { return state.settings.push === true && !!state.settings.pushId && !!PUSH.url; }
  function pushCall(path, body, keep) {
    body.id = state.settings.pushId;
    // text/plain = petición simple, sin preflight (más rápida y compatible con keepalive)
    return fetch(PUSH.url + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), keepalive: !!keep })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  // Programa el aviso para el final del descanso. Con la app delante, se anula 2,5 s antes y suena el pitido de la app.
  function pushSync(keep) {
    if (!pushReady()) return;
    var want = !!timer && !timer.fired && soundOn() && (document.hidden || timer.end - Date.now() > 2500);
    if (want) {
      if (timer.armed === timer.end) return;
      var t = timer; t.armed = t.end; save(); saveNextNote(t.end);
      pushCall('/arm', { at: t.end }, keep).catch(function () { if (t.armed === t.end) t.armed = 0; });
    } else if (timer && timer.armed) { timer.armed = 0; save(); pushCall('/cancel', {}, keep).catch(noop); }
  }
  // Texto de la siguiente serie para la notificación (sin nombre de ejercicio). Se queda en el iPhone:
  // el servidor solo sabe la hora del aviso.
  var lastDoneI = -1;
  // siguiente ejercicio con series sin marcar: primero los de después, luego los de antes
  function nextPending(i) {
    var es = state.active.entries, n = es.length;
    for (var k = 1; k <= n; k++) { var x = (i + k) % n; if (x !== i && es[x].sets.some(function (st) { return !st.done; })) return x; }
    return -1;
  }
  function animOpen() { var bd = $('section.ex.open .ex-body'); if (bd) bd.classList.add('anim'); }
  // El contenido se desplaza dentro de #scroller; el documento no se mueve (ver style.css, v2.3)
  function getY() { var sc = $('#scroller'); return sc ? sc.scrollTop : 0; }
  function setY(y) { var sc = $('#scroller'); if (sc) sc.scrollTop = y; }
  // iOS: al cerrar el teclado o volver de otra app puede dejar la pantalla desplazada; se recoloca
  function resetViewport() { try { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) { /* nada */ } }
  document.addEventListener('focusout', function () { setTimeout(function () { var a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) resetViewport(); }, 80); });
  document.addEventListener('visibilitychange', function () {
    // al salir de la app se cierra el teclado para que iOS no la guarde con la pantalla encogida
    if (document.hidden) { var a = document.activeElement; if (a && a.blur && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur(); }
    else resetViewport();
  });
  window.addEventListener('pageshow', resetViewport);
  function scrollToOpen(block) {
    var sec = $('section.ex.open'); if (!sec) return;
    var smooth = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    requestAnimationFrame(function () { try { sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: block }); } catch (e) { sec.scrollIntoView(); } });
  }
  function nextSetText() {
    var a = state.active; if (!a) return '';
    function find(i) { var e = a.entries[i]; if (!e) return -1; for (var j = 0; j < e.sets.length; j++) if (!e.sets[j].done) return j; return -1; }
    var i = lastDoneI >= 0 && lastDoneI < a.entries.length ? lastDoneI : Math.max(0, a.open), j = find(i), other = false;
    if (j < 0) { other = true; i = nextPending(i); j = i >= 0 ? find(i) : -1; }
    if (i < 0) return 'Última serie hecha 💪 Ya puedes terminar el entreno';
    var e = a.entries[i], st = e.sets[j], p = e.plan && e.plan[j] || {};
    var w = String(st.w).trim() !== '' ? num(st.w) : p.w, r = String(st.r).trim() !== '' ? num(st.r) : p.r;
    var what = w > 0 && r > 0 ? fmt(w) + ' kg × ' + r : r > 0 ? r + ' reps' : w > 0 ? fmt(w) + ' kg' : '';
    return (other ? 'Siguiente ejercicio · serie ' : 'Serie ') + (j + 1) + '/' + e.sets.length + (what ? ': ' + what : '');
  }
  function saveNextNote(end, text) {
    try {
      if (!window.caches) return;
      var body = JSON.stringify({ body: text || nextSetText(), end: end });
      caches.open('gym-meta').then(function (c) { return c.put('/__next', new Response(body, { headers: { 'Content-Type': 'application/json' } })); }).catch(noop);
    } catch (e) { /* nada */ }
  }
  function pushStop() { if (pushReady()) pushCall('/cancel', {}).catch(noop); }
  function b64uBytes(s) { var b = atob(s.replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (var k = 0; k < b.length; k++) a[k] = b.charCodeAt(k); return a; }
  function newPushId() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function pushSubscribe(reg) {
    var key = b64uBytes(PUSH.key);
    return reg.pushManager.getSubscription().then(function (old) {
      return old ? old.unsubscribe().catch(noop).then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); })
        : reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    });
  }
  function enablePush() {
    function fail(msg) { state.settings.push = false; save(); render(); toast(msg); }
    if (!PUSH.url) return fail('Aviso no configurado');
    if (!pushSupported()) return fail('Abre la app desde el icono de inicio para activar el aviso');
    var perm;
    try { perm = Notification.requestPermission(); } catch (e) { return fail('No se pudo pedir permiso'); }
    Promise.resolve(perm).then(function (p) {
      if (p !== 'granted') throw new Error('perm');
      return navigator.serviceWorker.ready;
    }).then(pushSubscribe).then(function (sub) {
      if (!state.settings.pushId) state.settings.pushId = newPushId();
      return pushCall('/sub', { sub: sub.toJSON() });
    }).then(function () {
      state.settings.push = true; save(); render(); toast('Aviso activado'); pushSync();
    }).catch(function (e) {
      fail(e && e.message === 'perm' ? 'Permiso denegado: actívalo en Ajustes del iPhone › Notificaciones › Gym' : 'No se pudo activar el aviso (¿sin internet?)');
    });
  }
  // Al abrir: renueva la suscripción en el servidor (o avisa si iOS la ha retirado)
  function pushRefresh() {
    if (!pushReady() || !pushSupported()) return;
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) { state.settings.push = false; save(); render(); toast('El aviso con la app cerrada se ha desactivado; vuelve a activarlo en Ajustes'); return; }
      return pushCall('/sub', { sub: sub.toJSON() }).then(function () { pushSync(); });
    }).catch(noop);
  }
  function closeRestNotes() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(function (reg) { return reg && reg.getNotifications ? reg.getNotifications({ tag: 'rest' }) : []; })
      .then(function (ns) { (ns || []).forEach(function (n) { n.close(); }); }).catch(noop);
  }
  var audio = null;
  var sounds = []; // registro para los tests: qué sonidos se han pedido
  function soundOn() { return state.settings.sound !== false; }
  function unlockAudio() {
    try {
      // 'ambient': se mezcla con la música sin pararla y respeta el modo silencio
      if (navigator.audioSession && navigator.audioSession.type !== 'ambient') navigator.audioSession.type = 'ambient';
      if (!audio) { var C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state !== 'running' && audio.resume) { var pr = audio.resume(); if (pr && pr.catch) pr.catch(function () {}); }
    } catch (e) { /* nada */ }
  }
  function tone(f, at, dur, vol, type) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    var t = audio.currentTime + at; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function play(kind) {
    if (!soundOn()) return;
    sounds.push(kind);
    unlockAudio();
    if (!audio) return;
    try {
      if (kind === 'tick') { tone(1250, 0, 0.08, 0.22); }
      else if (kind === 'end') {
        // dos tandas de campanilla ascendente, clara por encima de la música
        [0, 0.9].forEach(function (b) { tone(880, b, 0.22, 0.55, 'triangle'); tone(1175, b + 0.16, 0.22, 0.55, 'triangle'); tone(1568, b + 0.32, 0.4, 0.6, 'triangle'); });
      }
    } catch (e) { /* nada */ }
  }
  function beep() { play('end'); }
  function updateTimer() {
    var el = $('#timer'); if (!el) return;
    if (!timer) { el.hidden = true; document.body.classList.remove('has-timer'); return; }
    var left = (timer.end - Date.now()) / 1000;
    el.hidden = false; document.body.classList.add('has-timer');
    if (timer.armed && !document.hidden && left <= 2.5) pushSync();
    if (left <= 0) {
      if (!timer.fired) { timer.fired = true; if (-left <= 5) beep(); } // si vuelves mucho después, no suena
      if (-left > 5) { timer = null; save(); el.hidden = true; document.body.classList.remove('has-timer'); return; }
      el.classList.add('fin'); $('.t', el).textContent = '¡Listo!'; $('.bar i', el).style.width = '100%';
    } else {
      el.classList.remove('fin'); $('.t', el).textContent = mmss(left); $('.bar i', el).style.width = Math.max(0, 100 - (left / timer.total) * 100) + '%';
    }
  }
  // Reloj interno: solo corre con un entreno o un descanso en marcha y la app a la vista
  var clock = null, clockRuns = 0;
  function clockTick() {
    updateTimer();
    var el = $('#elapsed');
    if (el && state.active) el.textContent = mmss((Date.now() - state.active.t0) / 1000);
    clockSync();
  }
  function clockSync() {
    var need = (!!timer || !!state.active) && !document.hidden;
    if (need && !clock) { clock = setInterval(clockTick, 250); clockRuns++; }
    else if (!need && clock) { clearInterval(clock); clock = null; }
  }
  document.addEventListener('visibilitychange', clockSync);

  var wl = null;
  function wake() { try { if (state.active && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wl = l; }).catch(function () { }); } catch (e) { /* nada */ } }
  function unwake() { try { if (wl) { wl.release(); wl = null; } } catch (e) { /* nada */ } }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { wake(); updateTimer(); } });

  /* ---------- vistas ---------- */
  var ICON = {
    hoy: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    ej: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    prog: '<path d="M5 20v-7M12 20V5M19 20v-11"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    aj: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
    amigos: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.6-3 3-4.6 6-4.6s5.4 1.6 6 4.6"/><path d="M15.5 5.6a3.3 3.3 0 0 1 0 5.8M17.5 14.9c1.9.6 3.1 2.2 3.5 4.6"/>',
    perfil: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.9-3.9 4-5.6 7.5-5.6s6.6 1.7 7.5 5.6"/>'
  };
  function svg(p) { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var CHEV = '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderTabs() {
    var tabs = [['hoy', 'Hoy'], ['amigos', 'Amigos'], ['cal', 'Calendario'], ['ej', 'Ejercicios'], ['prog', 'Progreso'], ['perfil', 'Perfil']];
    var cur = ui.tab === 'aj' ? 'perfil' : ui.tab; // Ajustes vive dentro de Perfil
    $('#tabs').innerHTML = tabs.map(function (t) {
      return '<button class="tab' + (cur === t[0] ? ' on' : '') + '" data-a="tab" data-t="' + t[0] + '">' + svg(ICON[t[0]]) + '<span>' + t[1] + '</span></button>';
    }).join('');
  }

  function targetText(p) {
    if (!p) return '';
    if (!p.w) return 'reps ' + p.r;
    return fmt(p.w) + ' × ' + p.r;
  }
  function setsText(sets) { return sets.map(function (s) { return fmt(s.w) + '×' + s.r; }).join(' · '); }

  // Semana en curso (lunes a domingo): días entrenados de un vistazo; al tocar abre el calendario
  function weekStrip() {
    var info = dayInfo(), now = new Date(), today = dayKey(Date.now()), n = 0, cells = '';
    var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(function (l, i) {
      var d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i), k = dayKey(d.getTime()), di = info[k];
      var gym = !!(di && di.gym.length), act = !!(di && di.acts.length); if (gym) n++;
      cells += '<span class="wk-d' + (gym ? ' gym' : act ? ' act' : '') + (k === today ? ' today' : '') + (k > today ? ' fut' : '') + '"><span class="wk-l">' + l + '</span><span class="wk-c">' + (gym ? CHECK : d.getDate()) + '</span></span>';
    });
    return '<button class="card week" data-a="tab" data-t="cal" aria-label="Esta semana: ' + n + ' entrenos. Abrir calendario"><span class="wk-top"><span class="wk-t">Esta semana</span><span class="wk-n">' + (n ? '<b>' + n + '</b> ' + (n === 1 ? 'entreno' : 'entrenos') : 'Sin entrenos todavía') + '</span></span><span class="wk-row">' + cells + '</span></button>';
  }
  function viewHoy() {
    var now = Date.now();
    var fs = E.fatigueSummary(fatigueSessions(), now), fm = {};
    fs.forEach(function (f) { fm[f.muscle] = f; });
    var d = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    var h = '<header class="top"><div><h1>Hoy</h1><div class="sub cap">' + esc(d) + '</div></div></header>';
    h += weekStrip();
    if (memoryOnly) h += '<div class="banner warn">No se puede guardar en este navegador. Los datos se perderán al cerrar. Instala la app en la pantalla de inicio.</div>';
    var since = state.settings.lastBackup || 0;
    if (state.sessions.length >= 3 && now - since > 14 * 86400000) {
      h += '<div class="banner"><div>Hace tiempo que no haces copia de seguridad.</div><button class="btn sm" data-a="backup">Hacer copia</button></div>';
    }
    routineKeys().forEach(function (key) {
      var r = state.routines[key]; if (!r) return;
      var exs = r.ids.map(exById).filter(Boolean);
      var nsets = exs.reduce(function (a, e) { return a + (e.sets || 0); }, 0);
      var last = null;
      state.sessions.forEach(function (s) { if (s.key === key && (!last || s.t > last.t)) last = s; });
      var ms = [];
      exs.forEach(function (e) { if (ms.indexOf(e.muscle) < 0) ms.push(e.muscle); });
      var warns = [];
      ms.forEach(function (m) {
        var f = fm[m]; if (!f) return;
        if (f.status === 'descanso') warns.push('<span class="chip warn">' + esc(m) + ' · ' + ago(now - f.hours * 3600000) + '</span>');
        else if (f.status === 'alta') warns.push('<span class="chip warn">' + esc(m) + ' · carga alta</span>');
      });
      h += '<section class="card routine"><div class="r-top"><h2>' + esc(r.name) + '</h2><div class="muted">' + exs.length + (exs.length === 1 ? ' ejercicio · ' : ' ejercicios · ') + nsets + (nsets === 1 ? ' serie' : ' series') + '</div></div>' +
        '<div class="muted small">' + (last ? 'Última vez: ' + fmtDate(last.t) : 'Aún sin sesiones registradas') + '</div>' +
        '<div class="chips">' + (warns.length ? warns.join('') : (state.sessions.length ? '<span class="chip ok">Músculos descansados</span>' : '')) + '</div>' +
        '<div class="r-btns"><button class="btn primary" data-a="start" data-k="' + key + '">Empezar</button><button class="btn" data-a="edit-routine" data-k="' + key + '">Editar</button></div></section>';
    });
    h += '<button class="link" data-a="start" data-k="free">Empezar sesión libre</button>';
    return h;
  }

  function cardHtml(e, i, open) {
    var d = e.sets.filter(function (s) { return s.done; }).length;
    var h = '<section class="card ex' + (open ? ' open' : '') + '"><button class="ex-head" data-a="toggle" data-i="' + i + '"><div><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(e.muscle) + '</div></div><div class="ex-meta"><div class="ex-count' + (d && d === e.sets.length ? ' full' : '') + '">' + d + '/' + e.sets.length + '</div>' + CHEV + '</div></button>';
    if (!open) return h + '</section>';
    h += '<div class="ex-body">';
    if (e.stall) {
      h += '<div class="banner warn col"><div><b>Estancado.</b> Llevas ' + e.stall.n + ' sesiones sin mejorar tu mejor marca. Te propongo bajar un ~10 % y volver a subir.</div><div class="r-btns"><button class="btn sm primary" data-a="stall-apply" data-i="' + i + '">Aplicar ajuste</button><button class="btn sm" data-a="stall-ignore" data-i="' + i + '">Ignorar</button></div></div>';
    }
    var top = e.plan[0];
    if (!e.hasHist) h += '<div class="hint">Sin historial: pon el peso que vas a usar y apunta tus repeticiones.</div>';
    else {
      var badge = top.kind === 'sube' ? '<span class="chip ok">Sube peso</span>' : top.kind === 'bajo' ? '<span class="chip warn">Por debajo del rango</span>' : '';
      h += '<div class="hint">Última vez: <b>' + esc(setsText(e.last)) + '</b> ' + badge + '</div>';
    }
    if (e.warm && e.warm.length) h += '<div class="hint warmup">Calentamiento sugerido: ' + e.warm.map(function (w) { return fmt(w.w) + ' kg × ' + w.r; }).join(' · ') + ' <span class="muted">(no cuenta)</span></div>';
    h += '<div class="set head"><div>#</div><div>Objetivo</div><div>kg</div><div>Reps</div><div></div></div>';
    e.sets.forEach(function (s, j) {
      var p = e.plan[Math.min(j, e.plan.length - 1)];
      h += '<div class="set' + (s.done ? ' done' : '') + '" data-row="' + i + '-' + j + '"><div class="n">' + (s.pr ? '🏆' : (j + 1)) + '</div><div class="tgt">' + targetText(p) + '</div>' +
        '<input class="in" data-f="w" data-i="' + i + '" data-j="' + j + '" inputmode="decimal" autocomplete="off" value="' + esc(typeof s.w === 'number' ? fmt(s.w) : s.w) + '" placeholder="kg" aria-label="Peso serie ' + (j + 1) + '">' +
        '<input class="in" data-f="r" data-i="' + i + '" data-j="' + j + '" inputmode="numeric" autocomplete="off" value="' + esc(s.r) + '" placeholder="' + (p ? p.r : '') + '" aria-label="Repeticiones serie ' + (j + 1) + '">' +
        '<button class="chk" data-a="done" data-i="' + i + '" data-j="' + j + '" aria-label="Marcar serie ' + (j + 1) + '">' + CHECK + '</button></div>';
    });
    h += '<div class="ex-actions"><button class="btn sm" data-a="add-set" data-i="' + i + '">+ Serie</button><button class="btn sm" data-a="del-set" data-i="' + i + '">− Serie</button><button class="btn sm" data-a="swap" data-i="' + i + '">Cambiar</button><button class="btn sm" data-a="ex-set" data-i="' + i + '">Ajustes</button><button class="btn sm danger" data-a="rm-ex" data-i="' + i + '">Quitar</button>' +
      '<button class="btn sm" data-a="ex-up" data-i="' + i + '" aria-label="Mover antes"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn sm" data-a="ex-down" data-i="' + i + '" aria-label="Mover después"' + (i === state.active.entries.length - 1 ? ' disabled' : '') + '>↓</button></div></div></section>';
    return h;
  }

  function viewWorkout() {
    var a = state.active, done = 0, total = 0;
    a.entries.forEach(function (e) { e.sets.forEach(function (s) { total++; if (s.done) done++; }); });
    var h = '<header class="top"><div><h1>' + esc(a.name) + '</h1><div class="sub"><span id="elapsed">' + mmss((Date.now() - a.t0) / 1000) + '</span> · <span id="progress">' + done + '/' + total + ' series</span></div></div><div class="top-act"><button class="btn sm mute-b" data-a="mute" aria-label="Silenciar sonidos">' + muteIcon() + '</button><button class="btn primary sm" data-a="finish">Terminar</button></div></header>';
    if (!a.entries.length) h += '<div class="empty">Sesión vacía. Añade ejercicios para empezar.</div>';
    a.entries.forEach(function (e, i) { h += cardHtml(e, i, a.open === i); });
    h += '<button class="btn wide" data-a="add-ex">+ Añadir ejercicio</button><button class="link danger" data-a="discard">Descartar entreno</button>';
    return h;
  }

  /* ---------- calendario ---------- */
  var MINI_DB = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-label="Gimnasio"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';
  function calState() { if (!ui.cal) { var n = new Date(); ui.cal = { y: n.getFullYear(), m: n.getMonth() }; } return ui.cal; }
  function dayInfo() {
    var map = {};
    function get(k) { return map[k] || (map[k] = { gym: [], acts: [], classes: [] }); }
    state.sessions.forEach(function (s) { get(dayKey(s.t)).gym.push(s); });
    (state.activities || []).forEach(function (a) {
      if (a.type === 'clase') { get(a.day).classes.push(a); }
      else if (get(a.day).acts.indexOf(a.type) < 0) get(a.day).acts.push(a.type);
    });
    return map;
  }
  function hasAct(day, type) { return (state.activities || []).some(function (a) { return a.day === day && a.type === type; }); }
  function toggleAct(day, type) {
    state.activities = state.activities || [];
    var i = -1;
    state.activities.forEach(function (a, k) { if (a.day === day && a.type === type) i = k; });
    if (i >= 0) { state.activities.splice(i, 1); toast(E.ACT[type].label + ' quitado'); }
    else {
      var p = day.split('-').map(Number);
      var t = day === dayKey(Date.now()) ? Date.now() : new Date(p[0], p[1] - 1, p[2], 19, 0).getTime();
      state.activities.push({ id: uid(), day: day, type: type, t: t });
      toast(E.ACT[type].icon + ' ' + E.ACT[type].label + ' anotado');
    }
    save();
  }
  function actButtons(day) {
    return '<div class="r-btns">' + ['futbol', 'correr'].map(function (k) {
      var on = hasAct(day, k);
      return '<button class="btn act' + (on ? ' on' : '') + '" data-a="act" data-type="' + k + '" data-d="' + day + '" aria-pressed="' + on + '">' + E.ACT[k].icon + ' ' + E.ACT[k].label + (on ? ' ✓' : '') + '</button>';
    }).join('') + '</div><button class="btn wide" data-a="class-add" data-d="' + day + '">🤸 Apuntar clase dirigida</button>';
  }
  /* ---------- clases dirigidas ---------- */
  function classActs() { return (state.activities || []).filter(function (a) { return a.type === 'clase'; }); }
  function classById(id) { var r = null; (state.activities || []).forEach(function (a) { if (a.id === id) r = a; }); return r; }
  function classIcon(k) { return E.classDef(k).icon; }
  // datos opcionales comunes + los propios del tipo (p. ej. distancia en spinning)
  function classFields(kind) {
    var base = [['min', 'Duración (min)', 'numeric', true], ['rpe', 'Intensidad percibida (1–10)', 'numeric'], ['kcal', 'Calorías', 'numeric'], ['hrAvg', 'Pulso medio (ppm)', 'numeric'], ['hrMax', 'Pulso máximo (ppm)', 'numeric']];
    (E.classDef(kind).fields || []).forEach(function (f) { base.push([f[0], f[1], f[2]]); });
    return base;
  }
  function classStats(a) {
    var out = [];
    if (a.rpe) out.push(['Intensidad', a.rpe + '/10']);
    if (a.dist) out.push(['Distancia', fmt(a.dist) + ' km']);
    if (a.rounds) out.push(['Asaltos', a.rounds]);
    if (a.kcal) out.push(['Calorías', a.kcal + ' kcal']);
    if (a.hrAvg) out.push(['Pulso medio', a.hrAvg + ' ppm']);
    if (a.hrMax) out.push(['Pulso máx.', a.hrMax + ' ppm']);
    return out;
  }
  function classModalHtml(m) {
    var a = m.edit ? classById(m.id) || {} : {}, kind = m.kind || a.classKind || 'Spinning';
    var opts = Object.keys(E.CLASSES).map(function (k) { return '<option value="' + esc(k) + '"' + (k === kind ? ' selected' : '') + '>' + classIcon(k) + ' ' + esc(k === 'Otra' ? 'Otra…' : k) + '</option>'; }).join('');
    var h = '<h2>' + (m.edit ? 'Editar clase' : 'Clase dirigida') + '</h2>' +
      '<label>Tipo<select id="c-kind" data-f="c-kind">' + opts + '</select></label>' +
      (kind === 'Otra' ? '<label>Nombre de la clase<input id="c-other" maxlength="24" value="' + esc(a.other || '') + '" placeholder="Ej.: TRX"></label>' : '') +
      '<div class="muted small" style="margin-top:12px">Duración obligatoria; lo demás, si lo sabes.</div>';
    classFields(kind).forEach(function (f) {
      h += '<label>' + esc(f[1]) + '<input id="c-' + f[0] + '" inputmode="' + f[2] + '" autocomplete="off" value="' + esc(a[f[0]] != null ? a[f[0]] : '') + '"></label>';
    });
    h += '<label>Notas<textarea id="c-notes" class="ta" rows="2" placeholder="Opcional">' + esc(a.notes || '') + '</textarea></label><p class="err" id="c-err" hidden></p>';
    h += '<div class="r-btns"><button class="btn" data-a="close">Cancelar</button><button class="btn primary" data-a="class-save">' + (m.edit ? 'Guardar' : 'Apuntar') + '</button></div>';
    if (m.edit) h += '<button class="link danger" data-a="class-del" data-id="' + esc(m.id) + '">Borrar esta clase</button>';
    return h;
  }
  function saveClass() {
    var m = ui.modal, kind = $('#c-kind').value, num2 = function (id) { var e2 = $('#c-' + id); if (!e2) return undefined; var v = (e2.value || '').trim(); return v === '' ? undefined : num(v); };
    var min = num2('min');
    if (!(min > 0)) { var er = $('#c-err'); er.textContent = 'Pon la duración en minutos.'; er.hidden = false; return; }
    var a = m.edit ? classById(m.id) : { id: 'c' + uid(), type: 'clase' };
    if (!a) { closeModal(); return; }
    var p = m.day.split('-').map(Number);
    a.day = m.day; a.classKind = kind; a.min = min;
    a.t = m.day === dayKey(Date.now()) ? Date.now() : new Date(p[0], p[1] - 1, p[2], 19, 0).getTime();
    ['rpe', 'kcal', 'hrAvg', 'hrMax', 'dist', 'rounds'].forEach(function (k) { var v = num2(k); if (v != null && !isNaN(v)) a[k] = v; else delete a[k]; });
    var other = $('#c-other'); a.other = kind === 'Otra' && other ? (other.value || '').trim() : undefined;
    var notes = ($('#c-notes').value || '').trim(); if (notes) a.notes = notes; else delete a.notes;
    if (!m.edit) { state.activities = state.activities || []; state.activities.push(a); }
    save(); closeModal(); render(); toast(classIcon(kind) + ' Clase apuntada');
  }
  function classTitle(a) { return a.classKind === 'Otra' && a.other ? a.other : a.classKind; }
  function viewCal() {
    var c = calState(), info = dayInfo(), today = dayKey(Date.now());
    var first = new Date(c.y, c.m, 1), days = new Date(c.y, c.m + 1, 0).getDate();
    var lead = (first.getDay() + 6) % 7;
    var now = new Date(), isCur = c.y === now.getFullYear() && c.m === now.getMonth();
    var h = '<header class="top"><h1>Calendario</h1></header>';
    h += '<section class="card pad"><div class="ex-name">Hoy también he hecho…</div>' + actButtons(today) + '</section>';
    h += '<div class="cal-nav"><button class="btn sm" data-a="cal-prev" aria-label="Mes anterior">‹</button><h2 class="cap">' + esc(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })) + '</h2><button class="btn sm" data-a="cal-next" aria-label="Mes siguiente"' + (isCur ? ' disabled' : '') + '>›</button></div>';
    h += '<div class="cal-grid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (d) { return '<div class="cal-wd">' + d + '</div>'; }).join('');
    for (var b = 0; b < lead; b++) h += '<div class="cal-d blank"></div>';
    var nGym = 0, nF = 0, nC = 0, nCl = 0;
    for (var d = 1; d <= days; d++) {
      var k = c.y + '-' + two(c.m + 1) + '-' + two(d), di = info[k], fut = k > today;
      var ic = '';
      if (di) {
        if (di.gym.length) { ic += '<span class="ic-gym">' + MINI_DB + '</span>'; nGym++; }
        if (di.acts.indexOf('futbol') >= 0) { ic += '<span>⚽</span>'; nF++; }
        if (di.acts.indexOf('correr') >= 0) { ic += '<span>👟</span>'; nC++; }
        if (di.classes.length) { ic += '<span>' + classIcon(di.classes[0].classKind) + '</span>'; nCl += di.classes.length; }
      }
      h += '<button class="cal-d' + (di && di.gym.length ? ' gym' : '') + (k === today ? ' today' : '') + (fut ? ' fut' : '') + '"' + (fut ? ' disabled' : ' data-a="day" data-d="' + k + '"') + '><span class="dn">' + d + '</span><span class="ic">' + ic + '</span></button>';
    }
    h += '</div>';
    h += '<div class="cal-sum"><span><span class="ic-gym">' + MINI_DB + '</span> ' + nGym + (nGym === 1 ? ' día' : ' días') + ' de gimnasio</span><span>⚽ ' + nF + '</span><span>👟 ' + nC + '</span>' + (nCl ? '<span>🤸 ' + nCl + '</span>' : '') + '</div>';
    h += '<div class="muted small pad0">Toca un día para ver lo que hiciste o apuntar fútbol, correr o una clase.</div>';
    return h;
  }

  /* ---------- análisis ---------- */
  function sessById(id) { for (var i = 0; i < state.sessions.length; i++) if (state.sessions[i].id === id) return state.sessions[i]; return null; }
  var AN_ICON = { add: '+', remove: '−', keep: '=', warn: '!', info: 'i' };
  function analysisHtml(sess, live) {
    var an = sess && sess.analysis;
    if (!an || !an.items || !an.items.length) return '';
    var c = an.counts || {}, parts = [];
    if (c.up) parts.push(c.up + (c.up > 1 ? ' mejoran' : ' mejora'));
    if (c.same) parts.push(c.same + ' igual');
    if (c.down) parts.push(c.down + (c.down > 1 ? ' bajan' : ' baja'));
    var h = '<h3 class="sec">Análisis</h3>';
    if (parts.length) h += '<div class="muted small pad0">' + parts.join(' · ') + ' respecto a la última vez</div>';
    h += '<div class="card list">' + an.items.map(function (it, k) {
      var btn = '';
      if (live && (it.kind === 'add' || it.kind === 'remove')) btn = it.applied ? '<span class="chip ok">Aplicado</span>' : '<button class="btn sm primary" data-a="an-apply" data-k="' + k + '" data-sid="' + sess.id + '">' + (it.delta > 0 ? '+1 serie' : '−1 serie') + '</button>';
      return '<div class="li col an ' + it.kind + '"><div class="li-row"><div class="ex-name"><span class="an-ic">' + (it.kind === 'keep' && it.change > 0 ? '↑' : AN_ICON[it.kind]) + '</span>' + esc(it.name) + '</div>' +
        (it.change ? '<span class="muted small nw">' + (it.change > 0 ? '+' : '') + fmt(it.change) + ' %</span>' : '') + '</div>' +
        '<div class="small">' + esc(it.text) + '</div>' + (it.note ? '<div class="small muted">' + esc(it.note) + '</div>' : '') + (btn ? '<div>' + btn + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    if (an.muscles && an.muscles.length) {
      h += '<div class="chips">' + an.muscles.map(function (m) {
        return '<span class="chip ' + (m.status === 'ok' ? 'ok' : m.status === 'pendiente' ? '' : 'warn') + '">' + esc(m.muscle) + ' · ' + fmt(m.sets) + ' series/sem</span>';
      }).join('') + '</div>';
      h += '<div class="muted small pad0">' + (an.volOn ? 'Objetivo orientativo: 10–20 series semanales por músculo.' : 'El consejo de volumen semanal se activa cuando tengas una semana de datos.') + '</div>';
    }
    return h;
  }

  /* ---------- récords ---------- */
  function checkPR(e, j) {
    var s = e.sets[j];
    var pb = e.prevBest;
    if (pb === undefined) { var exr = exById(e.exId); pb = exr ? E.history(exr, state.sessions).reduce(function (a, h) { return Math.max(a, E.bestE1(h.sets)); }, 0) : 0; e.prevBest = pb; }
    if (!(pb > 0)) return;
    var best = pb;
    e.sets.forEach(function (x, k) { if (k !== j && x.done && num(x.r) > 0) best = Math.max(best, E.e1rm(num(x.w) || 0, num(x.r))); });
    if (!E.isPR(best, s.w, s.r)) { s.pr = false; return; }
    s.pr = true;
    if (!e.celebrated) { e.celebrated = true; celebrate(e.name, s.w, s.r); }
    else if (e.sets.some(function (x, k) { return k !== j && x.pr; })) toast('🏆 Mejoras tu récord otra vez');
  }
  var prT = null;
  function celebrate(name, w, r) {
    confetti(); fanfare();
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 180]); } catch (e) { /* nada */ }
    var b = $('#pr');
    b.innerHTML = '<div class="pr-t">🏆 ¡Nuevo récord!</div><div class="pr-n">' + esc(name) + '</div><div class="pr-v">' + fmt(w) + ' kg × ' + r + '</div>';
    b.hidden = false; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
    clearTimeout(prT); prT = setTimeout(function () { b.hidden = true; }, 2600);
  }
  function fanfare() {
    if (!soundOn() || !audio) return;
    try {
      [523, 659, 784, 1047].forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        var t = audio.currentTime + i * 0.11; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.5 : 0.15));
        o.start(t); o.stop(t + 0.55);
      });
    } catch (e) { /* nada */ }
  }
  function confetti() {
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { /* sigue */ }
    var c = document.createElement('canvas'); c.className = 'confetti'; document.body.appendChild(c);
    var dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    var x = c.getContext('2d'); x.scale(dpr, dpr);
    var cols = ['#b8f24a', '#ffd23f', '#ff6b6b', '#4dabf7', '#ffffff', '#ff9f1c'], P = [];
    for (var i = 0; i < 150; i++) P.push({ x: W / 2 + (Math.random() - 0.5) * 80, y: H * 0.38, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 14 - 4, s: 6 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] });
    var t0 = performance.now();
    (function frame(t) {
      var el = (t - t0) / 1000; x.clearRect(0, 0, W, H);
      P.forEach(function (p) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.globalAlpha = Math.max(0, 1 - el / 2.4); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
      });
      if (el < 2.4) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ---------- biblioteca, filtros y rutinas ---------- */
  var LIB = window.LIB || [];
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function libById(id) { for (var i = 0; i < LIB.length; i++) if (LIB[i].id === id) return LIB[i]; return null; }
  function libToExercise(l) {
    return { id: l.id, name: l.name, equip: l.equip, muscle: l.muscle, sec: (l.sec || []).slice(), step: STEP_DEFAULT[l.equip] || 2.5, stepUnit: 'kg',
      repMin: l.repMin || 8, repMax: l.repMax || 12, fatigue: l.fatigue || 2, sets: 3, rest: 0 };
  }
  function adoptLib(id) {
    var ex = exById(id); if (ex) return ex;
    var l = libById(id); if (!l) return null;
    ex = libToExercise(l); state.exercises.push(ex); save(); return ex;
  }
  function matches(e, q, fm, fe) {
    if (fm && e.muscle !== fm) return false;
    if (fe && e.equip !== fe) return false;
    if (!q) return true;
    var t = norm(e.name + ' ' + e.muscle + ' ' + (EQUIP[e.equip] || ''));
    return norm(q).split(/\s+/).every(function (w) { return t.indexOf(w) >= 0; });
  }
  function libNotMine() { var mine = {}; state.exercises.forEach(function (e) { mine[e.id] = 1; }); return LIB.filter(function (l) { return !mine[l.id]; }); }
  function filtersHtml(scope, fm, fe) {
    var used = {};
    state.exercises.concat(LIB).forEach(function (e) { used[e.muscle] = 1; });
    var ms = MUSCLES.filter(function (m) { return used[m]; });
    return '<div class="chips scroll">' + ms.map(function (m) { return '<button class="chip tog' + (fm === m ? ' on' : '') + '" data-a="flt" data-scope="' + scope + '" data-k="m" data-v="' + m + '">' + m + '</button>'; }).join('') + '</div>' +
      '<div class="chips scroll">' + Object.keys(EQUIP).map(function (k) { return '<button class="chip tog' + (fe === k ? ' on' : '') + '" data-a="flt" data-scope="' + scope + '" data-k="e" data-v="' + k + '">' + EQUIP[k] + '</button>'; }).join('') + '</div>';
  }
  function routineKeys() {
    var o = (state.routineOrder || []).filter(function (k, i, arr) { return state.routines[k] && arr.indexOf(k) === i; });
    Object.keys(state.routines).forEach(function (k) { if (o.indexOf(k) < 0) o.push(k); });
    state.routineOrder = o;
    return o;
  }
  function newRoutine(name, ids, afterKey) {
    var key = 'r-' + uid();
    var o = routineKeys(), i = afterKey ? o.indexOf(afterKey) : -1;
    state.routines[key] = { name: name, ids: ids || [] };
    if (i >= 0) o.splice(i + 1, 0, key); else o.push(key);
    save(); return key;
  }

  function viewEj() {
    var h = '<header class="top"><h1>Ejercicios</h1><button class="btn sm primary" data-a="new-ex">+ Nuevo</button></header>';
    var keys = routineKeys();
    h += '<h3 class="sec">Rutinas · orden en Hoy</h3><div class="card list">' + keys.map(function (k, i) {
      var r = state.routines[k];
      return '<div class="li"><button class="li-main" data-a="edit-routine" data-k="' + esc(k) + '"><div class="ex-name">' + esc(r.name) + '</div><div class="muted small">' + r.ids.length + (r.ids.length === 1 ? ' ejercicio' : ' ejercicios') + '</div></button>' +
        '<div class="r-btns tight"><button class="btn sm" data-a="ro-up" data-k="' + esc(k) + '" aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn sm" data-a="ro-down" data-k="' + esc(k) + '" aria-label="Bajar"' + (i === keys.length - 1 ? ' disabled' : '') + '>↓</button></div></div>';
    }).join('') + '</div><button class="btn wide" data-a="new-routine">+ Nueva rutina</button>';
    h += '<input id="q" class="search" data-f="q" placeholder="Buscar ejercicio" value="' + esc(ui.query) + '" autocomplete="off">';
    h += '<div id="ej-filters">' + filtersHtml('ej', ui.fm, ui.fe) + '</div>';
    h += '<div id="ex-list">' + exListHtml() + '</div>';
    return h;
  }
  function exListHtml() {
    var q = ui.query.trim(), fm = ui.fm, fe = ui.fe;
    var mine = state.exercises.filter(function (e) { return matches(e, q, fm, fe); });
    var lib = libNotMine().filter(function (e) { return matches(e, q, fm, fe); });
    if (!mine.length && !lib.length) return '<div class="empty">No hay ejercicios que coincidan.</div>';
    function group(list, fn) {
      var g = {};
      list.forEach(function (e) { (g[e.muscle] = g[e.muscle] || []).push(e); });
      return MUSCLES.filter(function (m) { return g[m]; }).concat(Object.keys(g).filter(function (m) { return MUSCLES.indexOf(m) < 0; }))
        .map(function (m) { return '<div class="grp">' + esc(m) + '</div>' + g[m].map(fn).join(''); }).join('');
    }
    var h = '';
    if (mine.length) {
      h += '<h3 class="sec">Mis ejercicios · ' + mine.length + '</h3>' + group(mine, function (e) {
        var plan = E.planSets(e, E.reference(e, state.sessions));
        var nx = plan.length && plan[0].w ? plan.map(function (p) { return fmt(p.w) + '×' + p.r; }).join(' · ') : 'sin historial';
        return '<button class="card item mine" data-a="edit-ex" data-id="' + esc(e.id) + '"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">Próximo: ' + esc(nx) + '</div></button>';
      });
    }
    var libShown = ui.libOpen || !!q || !!fm || !!fe;
    if (lib.length && !libShown) h += '<button class="btn lib-tog" data-a="lib-tog" aria-expanded="false"><span>Biblioteca · ' + lib.length + ' ejercicios</span><span>Ver ▾</span></button>';
    else if (lib.length) {
      h += (q || fm || fe ? '<h3 class="sec">Biblioteca · ' + lib.length + '</h3>' : '<button class="btn lib-tog" data-a="lib-tog" aria-expanded="true"><span>Biblioteca · ' + lib.length + ' ejercicios</span><span>Ocultar ▴</span></button>') +
        '<div class="muted small pad0">Toca uno para añadirlo a tus ejercicios.</div>' + group(lib, function (e) {
        return '<button class="card item lib" data-a="edit-lib" data-id="' + esc(e.id) + '"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(EQUIP[e.equip]) + '</div></button>';
      });
    }
    return h;
  }

  /* ---------- gráficos (SVG propio, una serie, color de acento) ---------- */
  var CW = 340, CH = 150, CL = 36, CR = 8, CT = 10, CB = 22;
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function shortDate(t) { return new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', ''); }
  function axisNum(v) { return v >= 10000 ? fmt(v / 1000) + 'k' : fmt(v); }
  // eje Y: de lo (múltiplo redondo) a hi; 3 líneas de rejilla
  function yScale(lo, hi) {
    if (hi <= lo) hi = lo + 1;
    var step = niceMax((hi - lo) / 3), a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    if (b === a) b = a + step;
    var ticks = []; for (var v = a; v <= b + 1e-9; v += step) ticks.push(v);
    return { y: function (v) { return CT + (CH - CT - CB) * (1 - (v - a) / (b - a)); }, ticks: ticks };
  }
  function gridHtml(sc) {
    return sc.ticks.map(function (v) { var y = sc.y(v).toFixed(1); return '<line class="grid" x1="' + CL + '" x2="' + (CW - CR) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (CL - 6) + '" y="' + y + '" dy="3.5" text-anchor="end">' + axisNum(v) + '</text>'; }).join('');
  }
  // pts: [{t, y, tip}] -> línea con puntos; tips al tocar
  function lineChart(pts, unit) {
    if (!pts.length) return '<div class="empty">Sin datos todavía.</div>';
    var ys = pts.map(function (p) { return p.y; }), lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = Math.max((hi - lo) * 0.15, hi * 0.03, 1), sc = yScale(Math.max(0, lo - pad), hi + pad);
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t, W = CW - CL - CR - 12;
    var xs = pts.map(function (p) { return pts.length === 1 ? CL + 6 + W / 2 : CL + 6 + W * (p.t - t0) / (t1 - t0 || 1); });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + xs[i].toFixed(1) + ' ' + sc.y(p.y).toFixed(1); }).join(' ');
    var g = '<svg viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="Gráfico de ' + esc(unit) + '">' + gridHtml(sc) +
      '<line class="hl" x1="0" x2="0" y1="' + CT + '" y2="' + (CH - CB) + '" visibility="hidden"/>' +
      (pts.length > 1 ? '<path class="ln" d="' + d + '"/>' : '') +
      pts.map(function (p, i) { return '<circle class="dot" cx="' + xs[i].toFixed(1) + '" cy="' + sc.y(p.y).toFixed(1) + '" r="' + (pts.length > 24 ? 3 : 4) + '"/>'; }).join('') +
      '<text class="ax" x="' + (CL + 6) + '" y="' + (CH - 6) + '">' + shortDate(t0) + '</text>' +
      (pts.length > 1 ? '<text class="ax" x="' + (CW - CR) + '" y="' + (CH - 6) + '" text-anchor="end">' + shortDate(t1) + '</text>' : '') +
      '<rect class="hit" x="' + CL + '" y="0" width="' + (CW - CL) + '" height="' + CH + '"/></svg>';
    return chartWrap(g, xs, pts.map(function (p) { return p.tip; }));
  }
  // bars: [{label, y, tip, low}], band opcional [min, max]
  function barChart(bars, band) {
    var hi = Math.max.apply(null, bars.map(function (b) { return b.y; }).concat([band ? band[1] : 0, 1]));
    var sc = yScale(0, hi), n = bars.length, W = CW - CL - CR, bw = W / n, base = sc.y(0);
    var g = '<svg viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="Gráfico de barras">';
    if (band) g += '<rect class="band" x="' + CL + '" width="' + W + '" y="' + sc.y(band[1]).toFixed(1) + '" height="' + (sc.y(band[0]) - sc.y(band[1])).toFixed(1) + '"/>';
    g += gridHtml(sc);
    if (band) g += '<text class="band-l" x="' + (CW - CR - 2) + '" y="' + (sc.y(band[1]) + 11).toFixed(1) + '" text-anchor="end">objetivo ' + band[0] + '–' + band[1] + '</text>';
    g += '<line class="hl" x1="0" x2="0" y1="' + CT + '" y2="' + (CH - CB) + '" visibility="hidden"/>';
    var xs = [];
    bars.forEach(function (b, i) {
      var x = CL + i * bw + 2, w = Math.max(2, bw - 4), top = sc.y(b.y), hgt = base - top;
      xs.push(x + w / 2);
      if (b.y > 0) {
        var r = Math.min(4, w / 2, hgt); // extremo redondeado, base recta
        g += '<path class="bar' + (b.low ? ' low' : '') + '" d="M' + x.toFixed(1) + ' ' + base.toFixed(1) + 'V' + (top + r).toFixed(1) + 'Q' + x.toFixed(1) + ' ' + top.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + top.toFixed(1) + 'H' + (x + w - r).toFixed(1) + 'Q' + (x + w).toFixed(1) + ' ' + top.toFixed(1) + ' ' + (x + w).toFixed(1) + ' ' + (top + r).toFixed(1) + 'V' + base.toFixed(1) + 'Z"/>';
      }
      if (i === 0 || i === n - 1 || (n > 6 && i === Math.floor(n / 2))) g += '<text class="ax" x="' + (x + w / 2).toFixed(1) + '" y="' + (CH - 6) + '" text-anchor="middle">' + b.label + '</text>';
    });
    g += '<rect class="hit" x="' + CL + '" y="0" width="' + W + '" height="' + CH + '"/></svg>';
    var k = n - 1; while (k > 0 && !(bars[k].y > 0)) k--; // texto inicial: la última semana con datos
    return chartWrap(g, xs, bars.map(function (b) { return b.tip; }), k);
  }
  function chartWrap(svgHtml, xs, tips, k) {
    if (k === undefined) k = tips.length - 1;
    return '<div class="chart" data-xs="' + esc(JSON.stringify(xs.map(function (x) { return Math.round(x * 10) / 10; }))) + '" data-tips="' + esc(JSON.stringify(tips)) + '">' + svgHtml +
      '<div class="chart-tip">' + tips[k] + '</div></div>';
  }
  // Al tocar o arrastrar sobre un gráfico: marca el punto más cercano y muestra su valor
  function chartTouch(ev) {
    var c = ev.target.closest && ev.target.closest('.chart'); if (!c) return;
    var svgEl = $('svg', c), r = svgEl.getBoundingClientRect(), xs = JSON.parse(c.getAttribute('data-xs')), tips = JSON.parse(c.getAttribute('data-tips'));
    var vx = (ev.clientX - r.left) / r.width * CW, k = 0;
    xs.forEach(function (x, i) { if (Math.abs(x - vx) < Math.abs(xs[k] - vx)) k = i; });
    var hl = $('.hl', c); hl.setAttribute('x1', xs[k]); hl.setAttribute('x2', xs[k]); hl.setAttribute('visibility', 'visible');
    $('.chart-tip', c).innerHTML = tips[k];
  }
  document.addEventListener('pointerdown', chartTouch);
  document.addEventListener('pointermove', function (ev) { if (ev.buttons || ev.pointerType === 'mouse') chartTouch(ev); });

  // Gráfico de un ejercicio: mejor 1RM estimado por sesión (sin peso: mejores repeticiones)
  function exChartHtml(ex) {
    var pts = [];
    E.history(ex, state.sessions).forEach(function (hh) {
      var best = null, e1 = 0;
      hh.sets.forEach(function (st) { if (st.w > 0 && st.r > 0) { var v = E.e1rm(st.w, st.r); if (v > e1) { e1 = v; best = st; } } });
      if (best) pts.push({ t: hh.t, y: Math.round(e1 * 10) / 10, tip: shortDate(hh.t) + ' · <b>' + fmt(best.w) + ' kg × ' + best.r + '</b> · 1RM ' + fmt(e1) + ' kg' });
      else {
        var reps = hh.sets.reduce(function (a, st) { return Math.max(a, st.r || 0); }, 0);
        if (reps) pts.push({ t: hh.t, y: reps, tip: shortDate(hh.t) + ' · <b>' + reps + ' reps</b>', reps: true });
      }
    });
    if (pts.some(function (p) { return !p.reps; })) pts = pts.filter(function (p) { return !p.reps; });
    if (!pts.length) return '<div class="chart-box muted small">Sin datos todavía.</div>';
    var unit = pts[0].reps ? 'reps' : 'kg', first = pts[0].y, last = pts[pts.length - 1].y, ch = first ? (last - first) / first * 100 : 0;
    return '<div class="chart-box"><div class="chart-sum"><span>' + (unit === 'kg' ? '1RM estimado' : 'Mejores reps') + ': <b>' + fmt(first) + ' → ' + fmt(last) + ' ' + unit + '</b></span><span><b>' + (ch >= 0 ? '+' : '') + fmt(ch) + ' %</b> en ' + pts.length + ' sesiones</span></div>' +
      lineChart(pts, unit === 'kg' ? '1RM estimado' : 'repeticiones') + '</div>';
  }

  // Semanas (lunes a domingo) de las últimas n, la última es la actual
  function weekStarts(n, now) {
    var d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var out = []; for (var i = n - 1; i >= 0; i--) { var w = new Date(d); w.setDate(d.getDate() - 7 * i); out.push(w.getTime()); }
    return out;
  }
  function muscleProgHtml() {
    var now = Date.now(), weeks = weekStarts(12, now), WK = 7 * 86400000;
    var used = {};
    state.sessions.forEach(function (s) { if (!s.activity) s.exercises.forEach(function (e) { if (e.muscle) used[e.muscle] = 1; }); });
    var list = MUSCLES.concat(Object.keys(used).filter(function (m) { return MUSCLES.indexOf(m) < 0; }));
    var m = ui.progM || list.filter(function (x) { return used[x]; })[0] || list[0];
    var openM = !!ui.progMOpen;
    var h = '<div class="musc-row"><select class="musc" data-f="progM" aria-label="Grupo muscular">' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === m ? ' selected' : '') + '>' + esc(x) + (used[x] ? '' : ' (sin datos)') + '</option>'; }).join('') + '</select>' +
      '<button class="btn sm' + (openM ? '' : ' primary') + '" data-a="musc-tog" aria-expanded="' + openM + '">' + (openM ? 'Ocultar' : 'Ver gráficos') + '</button></div>';
    if (!openM) return h;
    var sets = weeks.map(function () { return 0; }), vol = weeks.map(function () { return 0; }), exs = {};
    state.sessions.forEach(function (s) {
      if (s.activity || s.t < weeks[0] || s.t > now) return;
      var k = Math.min(weeks.length - 1, Math.floor((s.t - weeks[0]) / WK));
      s.exercises.forEach(function (e) {
        var n = e.sets.length;
        if (e.muscle === m) { sets[k] += n; e.sets.forEach(function (st) { vol[k] += (st.w || 0) * (st.r || 0); }); }
        else if ((e.sec || []).indexOf(m) >= 0) sets[k] += n * 0.5;
      });
    });
    state.exercises.forEach(function (ex) { if (ex.muscle === m) exs[ex.id] = ex; });
    var any = sets.some(function (v) { return v > 0; });
    h += '<section class="card pad">';
    if (!any) h += '<div class="muted small">Sin series de ' + esc(m) + ' en las últimas 12 semanas.</div>';
    else {
      var wl = function (t) { return 'sem. ' + shortDate(t); };
      h += '<h2>Series por semana</h2><div class="muted small">Directas + la mitad de las que lo trabajan como secundario.</div>' +
        barChart(weeks.map(function (t, i) { return { label: shortDate(t), y: sets[i], low: sets[i] > 0 && sets[i] < 10, tip: wl(t) + ' · <b>' + fmt(sets[i]) + ' series</b>' }; }), [10, 20]);
      if (vol.some(function (v) { return v > 0; })) h += '<h2 style="margin-top:14px">Volumen por semana</h2><div class="muted small">Kilos × repeticiones de los ejercicios de ' + esc(m) + '.</div>' +
        barChart(weeks.map(function (t, i) { return { label: shortDate(t), y: Math.round(vol[i]), tip: wl(t) + ' · <b>' + axisNum(Math.round(vol[i])) + ' kg</b>' }; }));
    }
    // fuerza: cambio del 1RM de cada ejercicio de ese músculo
    var rows = Object.keys(exs).map(function (id) {
      var ex = exs[id], hist = E.history(ex, state.sessions).map(function (hh) { return E.bestE1(hh.sets); }).filter(function (v) { return v > 0; });
      return hist.length ? { ex: ex, a: hist[0], b: hist[hist.length - 1] } : null;
    }).filter(Boolean);
    if (rows.length) h += '<h2 style="margin-top:14px">Fuerza (1RM estimado)</h2>' + rows.map(function (r) {
      var ch = (r.b - r.a) / r.a * 100;
      return '<div class="li-row" style="padding:6px 0"><span>' + esc(r.ex.name) + '</span><span class="muted small"><b style="color:var(--text)">' + fmt(r.a) + ' → ' + fmt(r.b) + '</b> (' + (ch >= 0 ? '+' : '') + fmt(ch) + ' %)</span></div>';
    }).join('');
    return h + '</section>';
  }

  function viewProg() {
    var now = Date.now();
    var h = '<header class="top"><h1>Progreso</h1></header>';
    // Fatiga
    h += '<h3 class="sec">Fatiga y descanso</h3>';
    var fs = E.fatigueSummary(fatigueSessions(), now);
    if (!fs.length) h += '<div class="empty">Se calcula con tus entrenos. Completa una sesión para verlo.</div>';
    else {
      var maxL = 1; fs.forEach(function (f) { maxL = Math.max(maxL, f.l7, f.avg); });
      h += '<div class="card list">' + fs.map(function (f) {
        var lab = f.status === 'descanso' ? '<span class="chip warn">Descansando · faltan ~' + Math.max(1, Math.round(f.left)) + ' h</span>' : f.status === 'alta' ? '<span class="chip warn">Carga alta esta semana</span>' : '<span class="chip ok">Listo</span>';
        return '<div class="li col"><div class="li-row"><div class="ex-name">' + esc(f.muscle) + '</div><div class="muted small">' + ago(now - f.hours * 3600000) + '</div></div>' + lab +
          '<div class="meter" title="Carga 7 días frente a tu media"><i style="width:' + Math.round(f.l7 / maxL * 100) + '%"></i><b style="left:' + Math.round(f.avg / maxL * 100) + '%"></b></div></div>';
      }).join('') + '</div><div class="muted small pad">La barra es la carga de los últimos 7 días (series × fatiga del ejercicio). La marca es tu media semanal de las 4 semanas anteriores.</div>';
    }
    // Por grupo muscular
    h += '<h3 class="sec">Por grupo muscular</h3>' + muscleProgHtml();
    // Récords
    h += '<h3 class="sec">Récords personales</h3>';
    var rows = [];
    var recent = {};
    state.sessions.forEach(function (s) { (s.prs || []).forEach(function (p) { if (now - s.t < 14 * 86400000) recent[p.exId] = s.t; }); });
    state.exercises.forEach(function (ex) {
      var best = null;
      E.history(ex, state.sessions).forEach(function (hh) { hh.sets.forEach(function (s) { if (s.w > 0 && s.r > 0 && s.r <= 15) { var v = E.e1rm(s.w, s.r); if (!best || v > best.v) best = { v: v, w: s.w, r: s.r, t: hh.t }; } }); });
      var reps = 0;
      if (!best) E.history(ex, state.sessions).forEach(function (hh) { hh.sets.forEach(function (s) { reps = Math.max(reps, s.r || 0); }); });
      rows.push({ ex: ex, best: best, reps: reps, recent: recent[ex.id] });
    });
    rows.sort(function (a, b) { return (b.recent || 0) - (a.recent || 0) || (b.best || b.reps ? 1 : 0) - (a.best || a.reps ? 1 : 0) || a.ex.name.localeCompare(b.ex.name); });
    h += '<div class="muted small pad">Toca un ejercicio para ver su gráfico.</div>';
    h += rows.length ? '<div class="card list">' + rows.map(function (r) {
      var open = ui.progEx === r.ex.id;
      return '<div class="li col' + (open ? ' open' : '') + '"><button class="prog-ex li-row" data-a="prog-ex" data-id="' + esc(r.ex.id) + '" aria-expanded="' + open + '"><div><div class="ex-name">' + esc(r.ex.name) + '</div><div class="muted small">' + (r.best ? '1RM estimado ' + fmt(r.best.v) + ' kg' : r.reps ? 'Sin peso' : 'Sin datos todavía') + '</div></div><div class="right">' + (r.recent ? '<span class="chip ok">Nuevo</span> ' : '') + (r.best ? '<b>' + fmt(r.best.w) + ' × ' + r.best.r + '</b>' : r.reps ? '<b>' + r.reps + ' reps</b>' : '<span class="muted">—</span>') + '</div></button>' +
        (open ? exChartHtml(r.ex) : '') + '</div>';
    }).join('') + '</div>' : '<div class="empty">Aún no hay datos.</div>';
    h += '<button class="link" data-a="tab" data-t="perfil">Ver todos tus entrenos en Perfil ›</button>';
    return h;
  }

  /* ---------- fotos de los entrenos ----------
     Se guardan en IndexedDB (no caben en localStorage): la sesión solo lleva la lista de ids en `photos`. */
  var PDBP = null, purl = {}, PH_MAX = 6, PH_PX = 800;
  function pdb() {
    if (!PDBP) PDBP = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open('gym-photos', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('p'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
    return PDBP;
  }
  function ptx(mode, fn) {
    return pdb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('p', mode), rq = fn(tx.objectStore('p'));
        tx.oncomplete = function () { res(rq && rq.result); }; tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function photoPut(id, blob, t) { return blob.arrayBuffer().then(function (buf) { return ptx('readwrite', function (st) { return st.put({ buf: buf, type: blob.type, t: t || Date.now(), v: 2 }, id); }); }); }
  function photoGet(id) { return ptx('readonly', function (st) { return st.get(id); }); }
  function photoDel(id) { if (purl[id]) { URL.revokeObjectURL(purl[id]); delete purl[id]; } return ptx('readwrite', function (st) { return st.delete(id); }).catch(noop); }
  // Reduce la foto a 800 px de lado mayor y JPEG de calidad media: unos 50–80 KB en vez de varios MB
  function shrinkPhoto(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        try {
          var k = Math.min(1, PH_PX / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          c.toBlob(function (b) { if (b) res(b); else rej(new Error('blob')); }, 'image/jpeg', 0.6);
        } catch (e) { rej(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('img')); };
      im.src = url;
    });
  }
  function addPhotos(sid, files) {
    var x = sessById(sid); if (!x) return;
    var room = PH_MAX - (x.photos || []).length, list = Array.prototype.slice.call(files, 0, Math.max(0, room));
    if (!list.length) { toast('Máximo ' + PH_MAX + ' fotos por entreno'); return; }
    var added = 0;
    list.reduce(function (pr, f) {
      return pr.then(function () { return shrinkPhoto(f); }).then(function (b) {
        var id = 'p' + uid(); return photoPut(id, b).then(function () { purl[id] = URL.createObjectURL(b); (x.photos = x.photos || []).push(id); added++; });
      }).catch(noop);
    }, Promise.resolve()).then(function () {
      if (!added) { toast('No se pudo guardar la foto'); return; }
      save(); closeModal(); ui.tab = 'perfil'; ui.sessOpen = sid; render(); setY(0);
      toast(added === 1 ? 'Foto añadida' : added + ' fotos añadidas');
    });
  }
  // Rellena las fotos que aún no están en memoria; si una falta en este iPhone, quita su hueco
  function hydratePhotos() {
    document.querySelectorAll('img[data-ph]:not([src])').forEach(function (im) {
      var id = im.getAttribute('data-ph');
      if (purl[id]) { im.src = purl[id]; return; }
      photoGet(id).then(function (rec) {
        if (!rec) throw new Error('no');
        if (!purl[id]) purl[id] = URL.createObjectURL(new Blob([rec.buf], { type: rec.type || 'image/jpeg' }));
        document.querySelectorAll('img[data-ph="' + id + '"]').forEach(function (i2) { i2.src = purl[id]; });
      }).catch(function () {
        document.querySelectorAll('img[data-ph="' + id + '"]').forEach(function (i2) { var sl = i2.closest('.slide'), md = sl && sl.parentNode; if (sl) sl.remove(); if (md) syncDots(md); });
      });
    });
  }
  // Limpieza al abrir: fotos de entrenos borrados hace más de 7 días
  function gcPhotos() {
    var used = {}; state.sessions.forEach(function (x) { (x.photos || []).forEach(function (id) { used[id] = 1; }); });
    pdb().then(function (db) {
      var tx = db.transaction('p', 'readwrite'), st = tx.objectStore('p'), cur = st.openCursor();
      cur.onsuccess = function () { var c = cur.result; if (!c) return; if (!used[c.key] && Date.now() - ((c.value && c.value.t) || 0) > 7 * 86400000) c.delete(); c.continue(); };
    }).catch(noop);
  }
  // Fotos guardadas con una versión anterior (más grandes): se recomprimen una vez al abrir
  function slimPhotos() {
    pdb().then(function (db) {
      return new Promise(function (res) {
        var old = [], cur = db.transaction('p', 'readonly').objectStore('p').openCursor();
        cur.onsuccess = function () { var c = cur.result; if (!c) { res(old); return; } if (c.value && c.value.buf && c.value.v !== 2) old.push({ id: c.key, rec: c.value }); c.continue(); };
        cur.onerror = function () { res(old); };
      });
    }).then(function (old) {
      return old.reduce(function (pr, o) {
        return pr.then(function () { return shrinkPhoto(new Blob([o.rec.buf], { type: o.rec.type || 'image/jpeg' })); })
          .then(function (b) { if (purl[o.id]) { URL.revokeObjectURL(purl[o.id]); delete purl[o.id]; } return photoPut(o.id, b, o.rec.t); }).catch(noop);
      }, Promise.resolve());
    }).catch(noop);
  }
  var CAM = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
  function photoBtn(sid, cls) { return '<label class="btn ' + cls + ' ph-add">' + CAM + '<span>Añadir foto</span><input type="file" accept="image/*" multiple data-f="photo" data-sid="' + esc(sid) + '"></label>'; }

  /* ---------- figura con los músculos trabajados ----------
     Media figura (lado derecho, eje en x = 0) que se dibuja también en espejo. Dibujo propio. */
  var BM_HEAD = 'M0 5 C11.5 5 18.5 13 18.5 26 C18.5 34 16.5 40.5 12.5 45.5 C9.5 49.5 5 52 0 52 Z';
  var BM_BODY = 'M0 48 L9 48 C9 53 9.5 56 10 58 C17 64 30 67 42 70.5 C52 72.5 60 78.5 62.5 88.5 C64.5 97 65 106 66.5 114 C68 126 70.5 138 73 148 C76.5 160 80 174 82.5 188 L85 203 C87.5 212 88.5 224 86 232 C84 238 79 238 78 232 L77.5 222 C75.5 226 72.5 224 73 218 L73.5 205 C71 192 67 174 62 158 C60.5 153 59 148 58 144 C54.5 132 50.5 119 47 107 C46.5 122 42 142 30.5 160 C32 170 34 180 37.5 192 C39.5 204 40 220 38.5 240 C37.5 258 35 276 32.5 288 C32.5 293 33 297 34 302 C36.5 314 36.5 330 32.5 346 C30 358 26.5 368 24 378 C24 384 28.5 390 30.5 394 C31 397.5 27 398.5 22 398.5 L11 398.5 C9.5 392 12 384 12.5 378 C11.5 362 9.5 346 9 332 C8.8 320 9.5 308 11 298 C10.5 293 10 289 10 285 C8.5 262 6 240 3 218 L0 213 Z';
  var BM_DELT = 'M42 71 C52 73 59.5 79 62 89 C63.5 97 63.5 104 61.5 111 C57.5 105 52.5 99.5 48 96.5 C44 89 41.5 81 41.5 74 Z';
  var BM_UARM = 'M48.5 99 C53 101.5 58 106.5 61 112.5 C63.5 123 66 135 68.5 146 C65.5 150.5 61 151 58.5 148 C56 136 52.5 121 48.5 108.5 Z';
  var BM_FARM = 'M60 153.5 C63.5 156 68.5 155.5 71.5 151.5 C75 163 78.5 177 81 190 L83 201.5 L75.5 204 C73 190.5 69 172 64 158.5 Z';
  var BM_FRONT = [
    ['Trapecio', 'M10 58.5 C17 64 29 67 40 70.2 L25 74.5 L11 72.5 Z'],
    ['Hombros', BM_DELT],
    ['Pecho', 'M2.5 75.5 L25 76.5 L40 72.8 C41 82 44 90 46.5 96 C45 106 38 113 28 115 C18 116.5 8 115 2.5 110 Z'],
    ['Bíceps', BM_UARM],
    ['Antebrazos', BM_FARM],
    ['Abdominales', 'M2 118 L16 117.5 C18 121 18.5 126 18 130 L2 131 Z'],
    ['Abdominales', 'M2 134 L18 133 C18.5 138 18.5 142 18 146 L2 147 Z'],
    ['Abdominales', 'M2 150 L18 149 C18 154 17.8 158 17.5 162 L2 163 Z'],
    ['Abdominales', 'M2 166 L17.5 165 C17.5 178 13 194 2 208 Z'],
    ['Abdominales', 'M21 118 C28 118.5 37 115 44 109 C44 122 40 141 28.5 160 C30 168 31.5 177 34 187 C29 193 24 197 20 199 C21 172 21.5 145 21 118 Z'],
    ['Aductores', 'M3.5 220 L13 214.5 C12.5 232 11.5 250 10.8 266 C8 252 5.5 236 3.5 220 Z'],
    ['Cuádriceps', 'M15.5 213 C23 209.5 31 205 37 200.5 C38 214 37 240 35 262 C34 274 32.5 281 31 286 C26.5 290.5 17.5 290.5 13 286.5 C12 270 13 240 15.5 213 Z'],
    ['Gemelos', 'M12.5 304 C17.5 300.5 27.5 300.5 32 304 C34.5 316 34.5 330 30.5 345 C28.5 356 26 366 24 373 L14.5 373 C13 360 11.5 346 11 332 C10.8 322 11.2 312 12.5 304 Z']
  ];
  var BM_BACK = [
    ['Trapecio', 'M0 52 L9.5 57 C16.5 63.5 29 66.5 40.5 70.5 C32 76 22.5 83 15 96.5 C9.5 107 4.5 123 2 139 L0 141 Z'],
    ['Hombros', BM_DELT],
    ['Espalda', 'M40 75.5 C32 80.5 24.5 87.5 17.5 99 C14.5 105 12.5 111 10.5 118 C22.5 118 36 113 45 104.5 C43 96 41 86 40 75.5 Z'],
    ['Tríceps', BM_UARM],
    ['Antebrazos', BM_FARM],
    ['Dorsales', 'M45 108.5 C35.5 116.5 22 121.5 9 122 C7.5 128 6 135 5 142 L12.5 168.5 C18 166.5 23.5 163.5 28.5 160 C39.5 142 44.5 124 45 108.5 Z'],
    ['Lumbares', 'M2.5 145 L10.5 171 C17 169.5 23.5 166.5 28.8 163 C30 170 31.5 178 33.5 186.5 C23 184.5 11.5 186.5 2.5 192 Z'],
    ['Glúteos', 'M2.5 196.5 C12 190 25.5 188.5 35 190.5 C38.5 200 39.5 214 38 226 C30 236.5 14 238 5.5 230 L3 218 Z'],
    ['Isquios', 'M6.5 236 C15 242 29 240.5 37.5 231 C38 246 36.5 264 34.5 276 C33.5 281 32.5 285 31.5 287.5 C26 291 17.5 291 13 287.5 C11.5 272 8.5 252 6.5 236 Z'],
    ['Gemelos', 'M11.5 300 C17 296.5 29 296.5 33.5 300.5 C36 314 35.5 330 31.5 344 C29.5 350 27 354 23.5 356.5 L17.5 356.5 C14 353 11.8 345 11 333 C10.6 321 10.8 310 11.5 300 Z']
  ];
  function bodyFig(parts, w) {
    function both(d, attr) { return '<path' + attr + ' d="' + d + '"/><path' + attr + ' d="' + d + '" transform="scale(-1 1)"/>'; }
    var g = both(BM_HEAD, ' class="bm-base"') + both(BM_BODY, ' class="bm-base"');
    parts.forEach(function (p) {
      var v = w[p[0]] || 0;
      g += both(p[1], ' class="bm-m' + (v ? ' on' : '') + '" data-m="' + p[0] + '"' + (v ? ' style="fill-opacity:' + (0.34 + 0.66 * v).toFixed(2) + '"' : ''));
    });
    return g;
  }
  // w: {músculo: 0..1}. Los principales cuentan cada serie; los secundarios, la mitad.
  function muscleWeights(x) {
    var w = {}, max = 0;
    x.exercises.forEach(function (e) {
      var n = e.sets.length;
      if (e.muscle) w[e.muscle] = (w[e.muscle] || 0) + n;
      (e.sec || []).forEach(function (m) { w[m] = (w[m] || 0) + n * 0.5; });
    });
    Object.keys(w).forEach(function (k) { max = Math.max(max, w[k]); });
    Object.keys(w).forEach(function (k) { w[k] = max ? w[k] / max : 0; });
    return w;
  }
  function bodyMap(x) {
    var w = muscleWeights(x), names = Object.keys(w).sort(function (a, b) { return w[b] - w[a]; });
    return '<svg class="bm" viewBox="0 0 376 402" role="img" aria-label="Músculos trabajados: ' + esc(names.join(', ')) + '"><g transform="translate(92 1)">' + bodyFig(BM_FRONT, w) + '</g><g transform="translate(284 1)">' + bodyFig(BM_BACK, w) + '</g></svg>';
  }
  // Carrusel: las fotos y, al deslizar, la figura de músculos
  function mediaHtml(x, inDetail) {
    var ph = x.photos || [], n = ph.length + 1;
    var h = '<div class="media" data-n="' + n + '">' + ph.map(function (id) {
      if (x.remote) { var rk = x.remote + '/' + id; return '<div class="slide ph"><img data-rph="' + esc(rk) + '"' + (rurl[rk] ? ' src="' + rurl[rk] + '"' : '') + ' alt="Foto del entreno" loading="lazy"></div>'; }
      return '<div class="slide ph"><img data-ph="' + esc(id) + '"' + (purl[id] ? ' src="' + purl[id] + '"' : '') + (inDetail ? ' data-a="photo" data-id="' + esc(id) + '" data-sid="' + esc(x.id) + '"' : '') + ' alt="Foto del entreno" loading="lazy"></div>';
    }).join('') +
      '<div class="slide fig"><div class="fig-t">Músculos trabajados</div>' + bodyMap(x) + '<div class="fig-l"><span>Frontal</span><span class="fig-sc">menos<i></i><i></i><i></i>más</span><span>Posterior</span></div></div></div>';
    if (n > 1) { h += '<div class="dots">'; for (var k = 0; k < n; k++) h += '<i' + (k ? '' : ' class="on"') + '></i>'; h += '</div>'; }
    return h;
  }
  function syncDots(md) {
    var dots = md.nextElementSibling; if (!dots || !dots.classList.contains('dots')) return;
    var n = md.children.length, k = Math.max(0, Math.min(n - 1, Math.round(md.scrollLeft / Math.max(1, md.scrollWidth / Math.max(1, n)))));
    while (dots.children.length > n) dots.removeChild(dots.lastChild);
    dots.hidden = n < 2;
    Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === k); });
  }
  document.addEventListener('scroll', function (ev) { var t = ev.target; if (t && t.classList && t.classList.contains('media')) syncDots(t); }, true);

  /* ---------- social: grupo privado con cifrado de extremo a extremo ----------
     Los entrenos y fotos se cifran en el móvil (AES-GCM) con una clave que solo tiene el grupo (el «código»).
     El servidor solo guarda texto ilegible, los nombres de usuario y a quién sigue cada uno. */
  function soc() { return state.settings.social && state.settings.social.token ? state.settings.social : null; }
  function b64u(u8) { var s = '', CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(str) { var b = atob(str.replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  var CODE_RE = /GYM1-[A-Za-z0-9_-]{43}/;
  function newCode() { var a = new Uint8Array(32); crypto.getRandomValues(a); return 'GYM1-' + b64u(a); }
  var socKeyMemo = {};
  function socKeys(code) {
    if (socKeyMemo[code]) return socKeyMemo[code];
    var te = new TextEncoder(), raw = unb64u(code.slice(5));
    socKeyMemo[code] = crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']).then(function (base) {
      var hk = function (info) { return { name: 'HKDF', hash: 'SHA-256', salt: te.encode('gym-v1'), info: te.encode(info) }; };
      return Promise.all([
        crypto.subtle.deriveKey(hk('gym-data'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
        crypto.subtle.deriveBits(hk('gym-join'), base, 256)
      ]).then(function (r) { return { enc: r[0], proof: b64u(new Uint8Array(r[1])) }; });
    });
    return socKeyMemo[code];
  }
  function encBytes(u8) {
    return socKeys(soc().code).then(function (k) {
      var iv = new Uint8Array(12); crypto.getRandomValues(iv);
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k.enc, u8).then(function (ct) { var o = new Uint8Array(12 + ct.byteLength); o.set(iv); o.set(new Uint8Array(ct), 12); return b64u(o); });
    });
  }
  function decBytes(str) {
    return socKeys(soc().code).then(function (k) { var a = unb64u(str); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12) }, k.enc, a.subarray(12)); }).then(function (b) { return new Uint8Array(b); });
  }
  function encJSON(o) { return encBytes(new TextEncoder().encode(JSON.stringify(o))); }
  function decJSON(str) { return decBytes(str).then(function (u8) { return JSON.parse(new TextDecoder().decode(u8)); }); }
  function socCall(path, body, noAuth) {
    body = body || {}; if (!noAuth) body.token = soc().token;
    return fetch(PUSH.url + '/s/' + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'http'); e.status = r.status; throw e; } return j; }); });
  }
  function hashStr(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
  function socPayload(x) {
    if (x.type === 'clase') {
      var o = { ckind: 'c', classKind: x.classKind, other: x.other, min: x.min, t: x.t };
      ['rpe', 'kcal', 'hrAvg', 'hrMax', 'dist', 'rounds', 'notes'].forEach(function (k) { if (x[k] != null) o[k] = x[k]; });
      return o;
    }
    return { name: x.name, t: x.t, t0: x.t0, photos: x.photos || [],
      exercises: x.exercises.map(function (e) { return { exId: e.exId, name: e.name, muscle: e.muscle, sec: e.sec || [], sets: e.sets.map(function (st) { return { w: st.w, r: st.r }; }) }; }),
      prs: (x.prs || []).map(function (p) { return { exId: p.exId, name: p.name, w: p.w, r: p.r }; }) };
  }
  // elementos compartibles: entrenos + clases dirigidas
  function shareItems() { return state.sessions.filter(function (x) { return !x.activity; }).concat(classActs()); }
  // Sube lo que falta, actualiza lo cambiado y borra lo que ya no está (entrenos y fotos)
  var socBusy = false, socAgain = false, socT = null, socLastSig = '';
  function socSig() { return shareItems().map(function (x) { return x.id + ':' + (x.type === 'clase' ? hashStr(JSON.stringify(socPayload(x))) : x.exercises.length + ':' + (x.photos || []).join(',')); }).join('|'); }
  function socSoon() { if (!soc()) return; clearTimeout(socT); socT = setTimeout(function () { socSync(false); }, 1200); }
  function socSync(force) {
    if (!soc() || !PUSH.url) return Promise.resolve();
    if (socBusy) { socAgain = true; return Promise.resolve(); }
    var sig = socSig(); if (!force && sig === socLastSig) return Promise.resolve();
    socBusy = true;
    return socCall('index').then(function (ix) {
      var have = {}, hp = {}, lp = {}, first = [], posts = [], dels = [];
      ix.posts.forEach(function (p) { have[p.id] = p.v; }); ix.photos.forEach(function (id) { hp[id] = 1; });
      shareItems().forEach(function (x) {
        var pl = socPayload(x), v = hashStr(JSON.stringify(pl)), phs = pl.photos || [];
        phs.forEach(function (id) { lp[id] = 1; });
        if (have[x.id] !== v) posts.push(function () { return encJSON(pl).then(function (d) { return socCall('post', { id: x.id, t: x.t, v: v, data: d, photos: phs }); }); });
        delete have[x.id];
      });
      Object.keys(lp).forEach(function (id) {
        if (!hp[id]) first.push(function () { return photoGet(id).then(function (rec) { if (rec) return encBytes(new Uint8Array(rec.buf)).then(function (d) { return socCall('photo-put', { id: id, data: d }); }); }); });
        delete hp[id];
      });
      Object.keys(have).forEach(function (id) { dels.push(function () { return socCall('del', { id: id }); }); });
      Object.keys(hp).forEach(function (id) { dels.push(function () { return socCall('photo-del', { id: id }); }); });
      // primero las fotos, luego los entrenos que las nombran, al final lo que sobra
      return first.concat(posts, dels).reduce(function (pr, job) { return pr.then(job); }, Promise.resolve());
    }).then(function () { socLastSig = sig; ui.socErr = ''; }, function (e) {
      ui.socErr = e && e.status === 401 ? 'auth' : 'net';
      if (e && e.status === 401) { state.settings.social = null; save(); render(); toast('Tu cuenta del grupo ya no existe'); }
    }).then(function () { socBusy = false; if (socAgain) { socAgain = false; socSoon(); } });
  }

  /* ---------- social: datos de los demás (siempre descifrados en el móvil) ---------- */
  var rc = { feed: null, feedT: 0, users: null, usersT: 0, me: null, lists: {}, rels: {}, loading: {} };
  function decPost(p) { return decJSON(p.data).then(function (o) { o.id = p.id; o.uid = p.uid; o.t = p.t; o.remote = p.uid; o.photos = p.photos || o.photos || []; return o; }, function () { return null; }); }
  // nota: una clase descifrada tiene o.classKind (ckind 'c'); isClass() la distingue
  function decPosts(ps) { return Promise.all(ps.map(decPost)).then(function (a) { return a.filter(Boolean); }); }
  function rcLoad(key, fn) {
    if (rc.loading[key]) return; rc.loading[key] = 1;
    fn().then(function () { ui.socErr = ''; }, function (e) { ui.socErr = e && e.status === 401 ? 'auth' : 'net'; }).then(function () { delete rc.loading[key]; if (ui.tab === 'amigos' || ui.tab === 'perfil') { if (sw) swLate = true; else render(); } });
  }
  function loadFeed(more) {
    rcLoad('feed', function () {
      var before = more && rc.feed && rc.feed.posts.length ? rc.feed.posts[rc.feed.posts.length - 1].t : 0;
      return socCall('feed', { before: before || undefined, limit: 20 }).then(function (j) {
        return decPosts(j.posts).then(function (ps) {
          var users = Object.assign({}, more && rc.feed ? rc.feed.users : {}, j.users);
          rc.feed = { posts: (more && rc.feed ? rc.feed.posts : []).concat(ps), users: users, more: j.posts.length === 20 }; rc.feedT = Date.now();
        });
      });
    });
  }
  function loadUsers() { rcLoad('users', function () { return Promise.all([socCall('users'), socCall('me')]).then(function (r) { rc.users = r[0].users; rc.me = r[1]; rc.usersT = Date.now(); }); }); }
  function loadWho(uid) {
    rcLoad('who' + uid, function () {
      return socCall('profile', { uid: uid }).then(function (pr) {
        if (!pr.canSee) { rc.lists[uid] = { prof: pr, posts: [], t: Date.now() }; return; }
        return socCall('list', { uid: uid }).then(function (j) { return decPosts(j.posts); }).then(function (ps) { rc.lists[uid] = { prof: pr, posts: ps, t: Date.now() }; });
      });
    });
  }
  function stale(t, ms) { return !t || Date.now() - t > (ms || 30000); }
  // Fotos de los demás: se descargan cifradas, se descifran aquí y se guardan unos días en el móvil
  var rurl = {};
  function hydrateRemote() {
    if (!soc()) return;
    document.querySelectorAll('img[data-rph]:not([src])').forEach(function (im) {
      var k = im.getAttribute('data-rph');
      if (rurl[k]) { im.src = rurl[k]; return; }
      if (rurl[k] === 0) return; rurl[k] = 0;
      var parts = k.split('/'), ck = 'r:' + parts[0] + ':' + parts[1];
      photoGet(ck).then(function (rec) {
        if (rec) return new Blob([rec.buf], { type: rec.type || 'image/jpeg' });
        return socCall('photo', { uid: parts[0], id: parts[1] }).then(function (j) { return decBytes(j.data); }).then(function (u8) {
          var bl = new Blob([u8], { type: 'image/jpeg' }); return photoPut(ck, bl).catch(noop).then(function () { return bl; });
        });
      }).then(function (bl) {
        rurl[k] = URL.createObjectURL(bl);
        document.querySelectorAll('img[data-rph="' + k + '"]').forEach(function (i2) { i2.src = rurl[k]; });
      }).catch(function () {
        delete rurl[k];
        document.querySelectorAll('img[data-rph="' + k + '"]').forEach(function (i2) { var sl = i2.closest('.slide'), md = sl && sl.parentNode; if (sl) sl.remove(); if (md) syncDots(md); });
      });
    });
  }
  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?'; }
  function avatar(u, big) { return '<span class="av' + (big ? ' big' : '') + '" aria-hidden="true">' + esc(initials(u && u.name)) + '</span>'; }
  function relTime(t) {
    var m = (Date.now() - t) / 60000;
    if (m < 60) return 'hace ' + Math.max(1, Math.round(m)) + ' min';
    if (m < 24 * 60) return 'hace ' + Math.round(m / 60) + ' h';
    if (m < 7 * 24 * 60) { var d = Math.round(m / 1440); return d === 1 ? 'ayer' : 'hace ' + d + ' días'; }
    return fmtDate(t);
  }

  /* ---------- perfil: resumen y registro de entrenos ---------- */
  function sessStats(x) {
    var sets = 0, vol = 0, reps = 0;
    x.exercises.forEach(function (e) { e.sets.forEach(function (st) { sets++; reps += st.r || 0; vol += (st.w || 0) * (st.r || 0); }); });
    var min = x.t0 && x.t > x.t0 ? Math.round((x.t - x.t0) / 60000) : 0;
    if (min > 360) min = 0; // entreno olvidado abierto: no cuenta como duración
    return { sets: sets, vol: vol, reps: reps, min: min, prs: (x.prs || []).length };
  }
  function durText(min) { return !min ? '—' : min >= 60 ? Math.floor(min / 60) + ' h ' + two(min % 60) + ' min' : min + ' min'; }
  function kgText(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' kg'; }
  function hhmm(t) { var d = new Date(t); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function topSet(sets) {
    var b = null;
    sets.forEach(function (st) { if (!b || E.e1rm(st.w || 0, st.r) > E.e1rm(b.w || 0, b.r) || (!st.w && !b.w && st.r > b.r)) b = st; });
    return b;
  }
  function setText(st) { return st.w > 0 ? fmt(st.w) + ' kg × ' + st.r : st.r + ' reps'; }
  // semanas seguidas con al menos un entreno (la actual puede estar aún vacía)
  function weekStreak(sessions) {
    var WK = 7 * 86400000, cur = weekStarts(1, Date.now())[0], has = {};
    sessions.forEach(function (x) { has[weekStarts(1, x.t)[0]] = 1; });
    var w = has[cur] ? cur : weekStarts(1, cur - 1)[0], n = 0;
    while (has[w]) { n++; w = weekStarts(1, w - 1)[0]; }
    return n;
  }
  function tile(v, l) { return '<div class="tile"><b>' + v + '</b><span>' + l + '</span></div>'; }
  function viewPerfil() {
    var ss = state.sessions.filter(function (x) { return !x.activity; }).sort(function (a, b) { return b.t - a.t; });
    if (ui.sessOpen) { var so = sessById(ui.sessOpen); if (so) return viewSess(so); ui.sessOpen = null; }
    var me = soc(), mc = me && rc.me && rc.me.counts;
    var h = '<header class="top"><div><h1>Perfil</h1><div class="sub">' + (ss.length ? ss.length + (ss.length === 1 ? ' entreno' : ' entrenos') + ' desde ' + new Date(ss[ss.length - 1].t).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) : 'Tu registro de entrenos') + '</div></div>' +
      '<button class="btn sm ic-btn" data-a="tab" data-t="aj" aria-label="Ajustes">' + svg(ICON.aj) + '</button></header>';
    if (me) {
      if (!rc.me || stale(rc.usersT, 60000)) loadUsers();
      var nR = (rc.me && rc.me.requests) ? rc.me.requests.length : 0;
      h += '<div class="card me-card"><button class="by me-by" data-a="who" data-u="' + esc(me.uid) + '">' + avatar(me, true) + '<span class="me-t"><b>' + esc(me.name) + '</b><span class="muted small">@' + esc(me.username) + '</span></span></button>' +
        '<span class="me-n"><button class="me-b" data-a="rel-list" data-u="' + esc(me.uid) + '" data-k="followers"><b>' + (mc ? mc.followers : '–') + '</b>seguidores</button><button class="me-b" data-a="rel-list" data-u="' + esc(me.uid) + '" data-k="following"><b>' + (mc ? mc.following : '–') + '</b>siguiendo</button></span></div>' +
        (nR ? '<button class="banner" data-a="people"><div><b>' + nR + (nR === 1 ? ' solicitud de seguimiento' : ' solicitudes de seguimiento') + '</b></div><span class="chip ok">Ver</span></button>' : '');
    }
    return h + perfilBody(ss.concat(classActs()), function (x) { return 'data-a="sess" data-id="' + esc(x.id) + '"'; }, 'Aquí aparecerán tus entrenos cuando guardes el primero.', true);
  }
  // Resumen, gráfico de 12 semanas y registro: el mío o el de una persona a la que sigo
  function isClass(x) { return !!x.classKind; }
  function perfilBody(items, cardAttr, emptyMsg, mine) {
    items = items.slice().sort(function (a, b) { return b.t - a.t; });
    var ss = items.filter(function (x) { return !isClass(x); }), cl = items.filter(isClass);
    var h = '', tot = { min: 0, vol: 0, sets: 0, prs: 0 };
    ss.forEach(function (x) { var st = sessStats(x); tot.min += st.min; tot.vol += st.vol; tot.sets += st.sets; tot.prs += st.prs; });
    cl.forEach(function (a) { tot.min += a.min || 0; });
    var streak = weekStreak(items);
    h += '<div class="tiles">' + tile(ss.length, 'Entrenos') + tile(streak + (streak === 1 ? ' semana' : ' semanas'), 'Racha actual') +
      tile(tot.min >= 60 ? Math.round(tot.min / 60) + ' h' : tot.min + ' min', 'Tiempo activo') + tile(kgText(tot.vol), 'Volumen total') + '</div>';
    if (!items.length) return h + '<div class="empty">' + emptyMsg + '</div>';
    // actividad de las últimas 12 semanas
    var m = ui.pfM || 'dur', weeks = weekStarts(12, Date.now()), WK = 7 * 86400000, vals = weeks.map(function () { return 0; });
    items.forEach(function (x) {
      if (x.t < weeks[0]) return;
      var k = Math.min(weeks.length - 1, Math.floor((x.t - weeks[0]) / WK));
      if (isClass(x)) { if (m === 'dur') vals[k] += x.min || 0; return; }
      var st = sessStats(x);
      vals[k] += m === 'dur' ? st.min : m === 'vol' ? st.vol : st.sets;
    });
    var tipV = function (v) { return m === 'dur' ? durText(Math.round(v)) : m === 'vol' ? kgText(v) : v + ' series'; };
    h += '<section class="card pad"><div class="li-row"><h2>Últimas 12 semanas</h2></div><div class="seg" role="tablist">' +
      [['dur', 'Duración'], ['vol', 'Volumen'], ['ser', 'Series']].map(function (o) { return '<button data-a="pf-m" data-v="' + o[0] + '" class="' + (m === o[0] ? 'on' : '') + '" role="tab" aria-selected="' + (m === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
      barChart(weeks.map(function (t, i) { return { label: shortDate(t), y: m === 'dur' ? Math.round(vals[i] / 6) / 10 : Math.round(vals[i]), tip: 'sem. ' + shortDate(t) + ' · <b>' + tipV(vals[i]) + '</b>' }; })) +
      '<div class="muted small">' + (m === 'dur' ? 'Horas por semana' : m === 'vol' ? 'Kilos × repeticiones por semana' : 'Series por semana') + '</div></section>';
    // registro
    var shown = items.slice(0, ui.feedN || 20), lastM = '';
    h += '<h3 class="sec">' + (cl.length ? 'Actividad' : 'Entrenos') + '</h3>';
    shown.forEach(function (x) {
      var d = new Date(x.t), mk = d.getFullYear() + '-' + d.getMonth();
      if (mk !== lastM) {
        lastM = mk;
        var nM = ss.filter(function (y) { var e = new Date(y.t); return e.getFullYear() === d.getFullYear() && e.getMonth() === d.getMonth(); }).length;
        h += '<div class="grp cap">' + esc(d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })) + ' · ' + nM + (nM === 1 ? ' entreno' : ' entrenos') + '</div>';
      }
      if (isClass(x)) { h += classCard(x, mine); return; }
      var st = sessStats(x), exs = x.exercises;
      h += '<div class="card sess" role="button" tabindex="0" ' + cardAttr(x) + '><span class="ss-top"><span><span class="ss-name">' + esc(x.name) + '</span><span class="muted small cap">' + esc(fmtDate(x.t)) + ' · ' + hhmm(x.t0 || x.t) + '</span></span>' +
        (st.prs ? '<span class="chip ok">🏆 ' + st.prs + (st.prs === 1 ? ' récord' : ' récords') + '</span>' : '') + '</span>' +
        '<span class="ss-stats"><span><b>' + durText(st.min) + '</b>Tiempo</span><span><b>' + kgText(st.vol) + '</b>Volumen</span><span><b>' + st.sets + '</b>Series</span></span>' +
        ((x.photos || []).length ? mediaHtml(x, false) : '') +
        '<span class="ss-ex">' + exs.slice(0, 4).map(function (e) { return '<span class="ss-row"><span class="ss-e">' + e.sets.length + ' × ' + esc(e.name) + '</span><span class="ss-b">' + esc(setText(topSet(e.sets))) + '</span></span>'; }).join('') +
        (exs.length > 4 ? '<span class="muted small">+ ' + (exs.length - 4) + (exs.length - 4 === 1 ? ' ejercicio más' : ' ejercicios más') + '</span>' : '') + '</span></div>';
    });
    if (items.length > shown.length) h += '<button class="btn wide" data-a="pf-more">Ver más (' + (items.length - shown.length) + ')</button>';
    return h;
  }
  function classCard(a, mine) {
    var stats = classStats(a);
    var attr = mine && !a.remote ? ' role="button" tabindex="0" data-a="class-edit" data-id="' + esc(a.id) + '"' : '';
    return '<div class="card clz"' + attr + '><span class="clz-top"><span class="clz-ic">' + classIcon(a.classKind) + '</span><span class="clz-t"><b>' + esc(classTitle(a)) + '</b><span class="muted small cap">Clase dirigida · ' + esc(fmtDate(a.t)) + '</span></span><span class="clz-min">' + (a.min || 0) + ' min</span></span>' +
      (stats.length ? '<span class="clz-stats">' + stats.map(function (p) { return '<span><b>' + esc(String(p[1])) + '</b>' + esc(p[0]) + '</span>'; }).join('') + '</span>' : '') +
      (a.notes ? '<span class="clz-notes">' + esc(a.notes) + '</span>' : '') + '</div>';
  }
  // Detalle de un entreno guardado: todas las series, récords y comparación con la vez anterior
  function viewSess(x, pool, who) {
    var st = sessStats(x), d = new Date(x.t0 || x.t), mine = !x.remote;
    pool = pool || state.sessions;
    var h = '<header class="top"><div><button class="back" data-a="' + (mine ? 'sess-back' : 'rsess-back') + '">‹ ' + (mine ? 'Entrenos' : esc(ui.rsessFrom === 'who' && who ? who.name : 'Amigos')) + '</button>' +
      (who ? '<button class="by" data-a="who" data-u="' + esc(x.uid) + '">' + avatar(who) + '<span>' + esc(who.name) + '</span></button>' : '') + '<h1>' + esc(x.name) + '</h1><div class="sub cap">' + esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) +
      ' · ' + (x.t0 && st.min ? hhmm(x.t0) + '–' + hhmm(x.t) : hhmm(x.t)) + '</div></div></header>';
    h += '<div class="tiles">' + tile(durText(st.min), 'Duración') + tile(kgText(st.vol), 'Volumen') + tile(st.sets, 'Series') + tile(st.prs ? '🏆 ' + st.prs : '0', st.prs === 1 ? 'Récord' : 'Récords') + '</div>';
    h += mediaHtml(x, mine) + (mine && (x.photos || []).length < PH_MAX ? photoBtn(x.id, 'wide') : '');
    var mus = {}, order = [];
    x.exercises.forEach(function (e) { if (!e.muscle) return; if (!mus[e.muscle]) { mus[e.muscle] = 0; order.push(e.muscle); } mus[e.muscle] += e.sets.length; });
    if (order.length) h += '<div class="chips ss-mus">' + order.map(function (k) { return '<span class="chip">' + esc(k) + ' · ' + mus[k] + '</span>'; }).join('') + '</div>';
    h += '<h3 class="sec">Ejercicios</h3>';
    x.exercises.forEach(function (e) {
      var pr = null; (x.prs || []).forEach(function (p) { if (p.exId === e.exId) pr = p; });
      // mejor marca de la vez anterior (otra sesión o los datos iniciales)
      var ex = mine ? exById(e.exId) : null, prev = 0, prevT = 0;
      pool.forEach(function (y) { if (y.t < x.t) y.exercises.forEach(function (ye) { if (ye.exId === e.exId && y.t > prevT) { prevT = y.t; prev = E.bestE1(ye.sets); } }); });
      if (!prevT && ex && ex.baseline && ex.baseline.sets && ex.baseline.t < x.t) { prevT = ex.baseline.t; prev = E.bestE1(ex.baseline.sets); }
      var cur = E.bestE1(e.sets), chip = '';
      if (!prevT) chip = '<span class="chip">Primera vez</span>';
      else if (prev > 0 && cur > 0) { var ch = (cur - prev) / prev * 100; chip = Math.abs(ch) < 0.05 ? '<span class="chip">= igual</span>' : '<span class="chip ' + (ch > 0 ? 'ok' : 'warn') + '">' + (ch > 0 ? '▲ +' : '▼ ') + fmt(ch) + ' %</span>'; }
      var prUsed = false, vol = 0;
      var rows = e.sets.map(function (s2, j) {
        vol += (s2.w || 0) * (s2.r || 0);
        var isPr = !prUsed && pr && pr.w === s2.w && pr.r === s2.r; if (isPr) prUsed = true;
        return '<div class="sd-row' + (isPr ? ' pr' : '') + '"><span class="sd-n">' + (isPr ? '🏆' : j + 1) + '</span><span class="sd-s">' + esc(setText(s2)) + '</span><span class="sd-1">' + (s2.w > 0 ? fmt(E.e1rm(s2.w, s2.r)) + ' kg' : '—') + '</span></div>';
      }).join('');
      h += '<section class="card pad sd"><div class="li-row"><div><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(e.muscle || '') + (vol ? ' · ' + kgText(vol) : '') + '</div></div>' + chip + '</div>' +
        '<div class="sd-head"><span>Serie</span><span>Peso × reps</span><span>1RM est.</span></div>' + rows + '</section>';
    });
    if (!mine) return h;
    h += analysisHtml(x, false);
    h += '<button class="link danger" data-a="del-sess" data-id="' + esc(x.id) + '">Borrar este entreno</button>';
    return h;
  }

  var PEOPLE_IC = '<path d="M16 19.5c-.6-2.9-2.9-4.4-5.5-4.4S5.6 16.6 5 19.5"/><circle cx="10.5" cy="8.5" r="3.4"/><path d="M19 8v6M16 11h6"/>';
  function feedCard(x, u) {
    var st = sessStats(x), exs = x.exercises;
    return '<div class="card sess fd" role="button" tabindex="0" data-a="rsess" data-u="' + esc(x.uid) + '" data-id="' + esc(x.id) + '" data-from="feed">' +
      '<span class="fd-by"><button class="by" data-a="who" data-u="' + esc(x.uid) + '">' + avatar(u) + '<span class="by-t"><b>' + esc(u ? u.name : '¿?') + '</b><span class="muted small">' + esc(relTime(x.t)) + '</span></span></button></span>' +
      '<span class="ss-top"><span><span class="ss-name">' + esc(x.name) + '</span><span class="muted small cap">' + esc(fmtDate(x.t)) + ' · ' + hhmm(x.t0 || x.t) + '</span></span>' +
      (st.prs ? '<span class="chip ok">🏆 ' + st.prs + (st.prs === 1 ? ' récord' : ' récords') + '</span>' : '') + '</span>' +
      '<span class="ss-stats"><span><b>' + durText(st.min) + '</b>Tiempo</span><span><b>' + kgText(st.vol) + '</b>Volumen</span><span><b>' + st.sets + '</b>Series</span></span>' +
      mediaHtml(x, false) +
      '<span class="ss-ex">' + exs.slice(0, 4).map(function (e) { return '<span class="ss-row"><span class="ss-e">' + e.sets.length + ' × ' + esc(e.name) + '</span><span class="ss-b">' + esc(setText(topSet(e.sets))) + '</span></span>'; }).join('') +
      (exs.length > 4 ? '<span class="muted small">+ ' + (exs.length - 4) + (exs.length - 4 === 1 ? ' ejercicio más' : ' ejercicios más') + '</span>' : '') + '</span></div>';
  }
  function feedClassCard(x, u) {
    return '<div class="card clz"><span class="fd-by"><button class="by" data-a="who" data-u="' + esc(x.uid) + '">' + avatar(u) + '<span class="by-t"><b>' + esc(u ? u.name : '¿?') + '</b><span class="muted small">' + esc(relTime(x.t)) + '</span></span></button></span>' +
      '<span class="clz-top"><span class="clz-ic">' + classIcon(x.classKind) + '</span><span class="clz-t"><b>' + esc(classTitle(x)) + '</b><span class="muted small">Clase dirigida · ' + esc(fmtDate(x.t)) + '</span></span><span class="clz-min">' + (x.min || 0) + ' min</span></span>' +
      (classStats(x).length ? '<span class="clz-stats">' + classStats(x).map(function (p) { return '<span><b>' + esc(String(p[1])) + '</b>' + esc(p[0]) + '</span>'; }).join('') + '</span>' : '') +
      (x.notes ? '<span class="clz-notes">' + esc(x.notes) + '</span>' : '') + '</div>';
  }
  function netNote() { return ui.socErr === 'net' ? '<div class="banner warn">Sin conexión con el grupo. Se reintentará al volver a internet.</div>' : ''; }
  function viewAmigos() {
    var me = soc();
    if (!me) {
      return '<header class="top"><div><h1>Amigos</h1><div class="sub">Entrena con tu gente</div></div></header>' +
        '<section class="card pad soc-hero"><div class="soc-ic">' + svg(PEOPLE_IC) + '</div><h2>Sigue los entrenos de tus amigos</h2>' +
        '<p class="muted small">Crea un grupo privado y pásales el código. Veréis los entrenos, fotos y récords de las personas que sigáis. Todo va cifrado: solo vosotros podéis verlo.</p>' +
        '<div class="r-btns"><button class="btn primary" data-a="soc-start" data-m="create">Crear grupo</button><button class="btn" data-a="soc-start" data-m="join">Tengo un código</button></div></section>';
    }
    if (ui.rel) return viewRel(ui.relU, ui.rel);
    if (ui.people) return viewPeople();
    if (ui.rsess) {
      var src = ui.rsessFrom === 'who' ? (rc.lists[ui.rsessU] || {}).posts : rc.feed && rc.feed.posts;
      var x = (src || []).filter(function (p) { return p.uid === ui.rsessU && p.id === ui.rsess; })[0];
      if (x) {
        var who = ui.rsessFrom === 'who' ? (rc.lists[ui.rsessU] || {}).prof.user : rc.feed.users[x.uid];
        return viewSess(x, src.filter(function (p) { return p.uid === x.uid; }), who);
      }
      ui.rsess = null;
    }
    if (ui.who) return viewWho(ui.who);
    if (!rc.feed || stale(rc.feedT)) loadFeed(false);
    if (!rc.me || stale(rc.usersT, 60000)) loadUsers();
    var nReq = (rc.me && rc.me.requests) ? rc.me.requests.length : 0;
    var h = '<header class="top"><div><h1>Amigos</h1><div class="sub">Entrenos de la gente que sigues</div></div><button class="btn sm ic-btn rel" data-a="people" aria-label="Personas">' + svg(PEOPLE_IC) + (nReq ? '<span class="badge">' + nReq + '</span>' : '') + '</button></header>' + netNote();
    if (nReq) h += '<button class="banner" data-a="people"><div><b>' + nReq + (nReq === 1 ? ' solicitud' : ' solicitudes') + ' de seguimiento</b></div><span class="chip ok">Ver</span></button>';
    if (!rc.feed) return h + '<div class="empty">Cargando…</div>';
    if (!rc.feed.posts.length) {
      return h + '<section class="card pad soc-hero"><h2>Aún no hay entrenos que ver</h2><p class="muted small">Sigue a alguien del grupo para ver aquí sus entrenos. Si aún no han entrado, pásales tu código.</p><button class="btn primary wide" data-a="people">Buscar personas</button></section>';
    }
    rc.feed.posts.forEach(function (x) { h += isClass(x) ? feedClassCard(x, rc.feed.users[x.uid]) : feedCard(x, rc.feed.users[x.uid]); });
    if (rc.feed.more) h += '<button class="btn wide" data-a="feed-more">' + (rc.loading.feed ? 'Cargando…' : 'Ver más') + '</button>';
    return h;
  }
  function followBtn(uid, rel, sm) {
    var label = rel === 'following' ? 'Siguiendo' : rel === 'pending' ? 'Solicitado' : 'Seguir';
    return '<button class="btn ' + (sm ? 'sm ' : '') + (rel === 'none' ? 'primary' : '') + ' fol" data-a="followtog" data-u="' + esc(uid) + '" data-rel="' + rel + '">' + label + '</button>';
  }
  function viewWho(uid) {
    var L = rc.lists[uid];
    if (!L || stale(L.t)) loadWho(uid);
    var h = '<header class="top"><div><button class="back" data-a="who-back">‹ Amigos</button></div></header>' + netNote();
    if (!L) return h + '<div class="empty">Cargando…</div>';
    var u = L.prof.user, c = L.prof.counts, isMe = uid === soc().uid;
    h += '<section class="who">' + avatar(u, true) + '<div class="who-t"><h1>' + esc(u.name) + '</h1><div class="sub">@' + esc(u.username) + (L.prof.followsMe ? ' · te sigue' : '') + '</div></div></section>';
    if (!L.prof.canSee) {
      return h + '<div class="who-n">' + followBtn(uid, L.prof.rel) + '</div>' +
        '<section class="card pad priv"><div class="priv-ic">🔒</div><h2>Cuenta privada</h2><p class="muted small">' + (L.prof.rel === 'pending' ? 'Solicitud enviada. Cuando ' + esc(u.name) + ' la acepte, verás aquí sus entrenos.' : 'Envía una solicitud para ver sus entrenos y fotos.') + '</p></section>';
    }
    var cnt = function (n, lab, k) { return isMe ? '<button class="who-b" data-a="rel-list" data-u="' + esc(uid) + '" data-k="' + k + '"><b>' + n + '</b>' + lab + '</button>' : '<span><b>' + n + '</b>' + lab + '</span>'; };
    h += '<div class="who-n"><span><b>' + c.posts + '</b>entrenos</span>' + cnt(c.followers, 'seguidores', 'followers') + cnt(c.following, 'siguiendo', 'following') + (isMe ? '' : followBtn(uid, L.prof.rel)) + '</div>';
    return h + perfilBody(L.posts, function (x) { return 'data-a="rsess" data-u="' + esc(x.uid) + '" data-id="' + esc(x.id) + '" data-from="who"'; }, isMe ? 'Aún no has guardado ningún entreno.' : 'Todavía no ha guardado ningún entreno.', isMe);
  }
  function viewPeople() {
    var me = soc();
    if (!rc.users || stale(rc.usersT, 15000)) loadUsers();
    var h = '<header class="top"><div><button class="back" data-a="people-back">‹ ' + (ui.peopleFrom === 'perfil' ? 'Perfil' : 'Amigos') + '</button><h1>Personas</h1></div></header>' + netNote();
    h += '<section class="card pad"><h2>Invita a tu grupo</h2><p class="muted small">Pásales este código. Al abrir la app: Amigos › «Tengo un código».</p>' +
      '<div class="code" id="soc-code">' + esc(me.code) + '</div><div class="r-btns"><button class="btn primary" data-a="soc-share">Enviar invitación</button><button class="btn" data-a="soc-copy">Copiar código</button></div></section>';
    var reqs = (rc.me && rc.me.requests) || [];
    if (reqs.length) {
      h += '<h3 class="sec">Solicitudes de seguimiento</h3><div class="card list">' + reqs.map(function (r) {
        return '<div class="li ppl"><button class="by" data-a="who" data-u="' + esc(r.uid) + '">' + avatar(r) + '<span class="by-t"><b>' + esc(r.name) + '</b><span class="muted small">@' + esc(r.username) + '</span></span></button>' +
          '<span class="req-b"><button class="btn sm primary" data-a="req-accept" data-u="' + esc(r.uid) + '">Aceptar</button><button class="btn sm" data-a="req-reject" data-u="' + esc(r.uid) + '" aria-label="Rechazar">✕</button></span></div>';
      }).join('') + '</div>';
    }
    h += '<h3 class="sec">En el grupo</h3>';
    if (!rc.users) return h + '<div class="empty">Cargando…</div>';
    h += '<div class="card list">' + rc.users.map(function (u) {
      var isMe = u.uid === me.uid, sub = isMe ? '@' + u.username : u.rel === 'following' && u.posts != null ? '@' + u.username + ' · ' + u.posts + (u.posts === 1 ? ' entreno' : ' entrenos') : '@' + u.username;
      return '<div class="li ppl"><button class="by" data-a="who" data-u="' + esc(u.uid) + '">' + avatar(u) + '<span class="by-t"><b>' + esc(u.name) + (isMe ? ' (tú)' : '') + '</b><span class="muted small">' + esc(sub) + '</span></span></button>' +
        (isMe ? '' : followBtn(u.uid, u.rel, true)) + '</div>';
    }).join('') + '</div>';
    h += '<button class="link danger" data-a="soc-leave">Salir del grupo y borrar mis datos del servidor</button>';
    return h;
  }

  // Lista de seguidores (con «Quitar» en la mía) o de seguidos
  function viewRel(uid, kind) {
    var isMe = uid === soc().uid, L = rc.lists[uid];
    if (!L || stale(L.t)) loadWho(uid);
    var who = L && L.prof.user;
    var h = '<header class="top"><div><button class="back" data-a="rel-back" data-u="' + esc(uid) + '">‹ ' + esc(who ? who.name : 'Atrás') + '</button><h1>' + (kind === 'followers' ? 'Seguidores' : 'Siguiendo') + '</h1></div></header>' + netNote();
    var key = uid + '/' + kind, R = rc.rels[key];
    if (!R || stale(R.t)) {
      rcLoad('rel' + key, function () {
        return socCall(isMe ? 'me' : 'profile', isMe ? {} : { uid: uid }).then(function () {
          // la lista de otra persona no es visible salvo la mía; mostramos la del propio usuario (me)
          return socCall('me').then(function (m) {
            var ids = kind === 'followers' ? m.followers : m.following;
            return socCall('users').then(function (us) {
              var by = {}; us.users.forEach(function (u) { by[u.uid] = u; });
              rc.rels[key] = { list: ids.map(function (id) { return by[id]; }).filter(Boolean), t: Date.now() };
            });
          });
        });
      });
    }
    if (!R) return h + '<div class="empty">Cargando…</div>';
    if (!R.list.length) return h + '<div class="empty">' + (kind === 'followers' ? 'Nadie te sigue todavía.' : 'Aún no sigues a nadie.') + '</div>';
    h += '<div class="card list">' + R.list.map(function (u) {
      return '<div class="li ppl"><button class="by" data-a="who" data-u="' + esc(u.uid) + '">' + avatar(u) + '<span class="by-t"><b>' + esc(u.name) + '</b><span class="muted small">@' + esc(u.username) + '</span></span></button>' +
        (isMe && kind === 'followers' ? '<button class="btn sm" data-a="rm-follower" data-u="' + esc(u.uid) + '">Quitar</button>' : isMe ? followBtn(u.uid, u.rel, true) : '') + '</div>';
    }).join('') + '</div>';
    return h;
  }
  function viewSet() {
    var lb = state.settings.lastBackup;
    return '<header class="top"><div><button class="back" data-a="tab" data-t="perfil">‹ Perfil</button><h1>Ajustes</h1></div></header>' +
      '<section class="card pad"><h2>Copia de seguridad</h2><p class="muted small">Tus datos están solo en este iPhone. ' + (lb ? 'Última copia: ' + fmtDate(lb) + '.' : 'Aún no has hecho ninguna copia.') + '</p>' +
      '<div class="r-btns"><button class="btn primary" data-a="backup">Guardar copia</button><button class="btn" data-a="copy">Copiar texto</button></div>' +
      '<div class="r-btns"><button class="btn" data-a="import-file">Importar archivo</button><button class="btn" data-a="import-paste">Pegar texto</button></div>' +
      '<input id="file" type="file" accept="application/json,.json" hidden><p class="muted small" style="margin-top:10px">Las fotos de los entrenos se guardan muy reducidas (unos 60 KB cada una) y solo en este iPhone: no van dentro de la copia.</p></section>' +
      '<section class="card pad"><h2>Descanso</h2><label class="switch"><span>Sonidos (serie hecha y fin del descanso)</span><input type="checkbox" data-f="sound"' + (state.settings.sound !== false ? ' checked' : '') + '></label></section>' +
      pushSection() +
      '<section class="card pad"><h2>Fútbol y correr</h2><label class="switch"><span>Cuentan (poco) en la fatiga de piernas</span><input type="checkbox" data-f="actFatigue"' + (state.settings.actFatigue !== false ? ' checked' : '') + '></label></section>' +
      '<section class="card pad"><h2>Instalar en el iPhone</h2><p class="muted small">En Safari: botón Compartir → «Añadir a pantalla de inicio». Así se abre a pantalla completa y los datos se conservan.</p></section>' +
      '<section class="card pad"><h2>Datos iniciales</h2><p class="muted small">Vuelve a cargar tus 17 ejercicios con la última sesión de las capturas. Borra tu historial.</p><button class="btn danger" data-a="reset">Restaurar datos iniciales</button></section>' +
      '<div class="muted small center" id="ver">Versión 3.3 ({{VER}}) · progresión al fallo con doble progresión</div>';
  }

  /* ---------- modales ---------- */
  function modalHtml() {
    var m = ui.modal; if (!m) return '';
    var h = '';
    if (m.type === 'confirm') {
      h = '<h2>' + esc(m.title || 'Confirmar') + '</h2><p>' + esc(m.text) + '</p><div class="r-btns"><button class="btn' + (m.danger ? ' danger' : ' primary') + '" data-a="confirm-yes">' + esc(m.yes || 'Aceptar') + '</button><button class="btn" data-a="close">Cancelar</button></div>';
    } else if (m.type === 'pick') {
      h = '<h2>' + (m.ctx === 'swap' ? 'Cambiar ejercicio' : 'Añadir ejercicio') + '</h2><input id="pq" class="search" data-f="pq" placeholder="Buscar" autocomplete="off" value="' + esc(m.q || '') + '"><div id="pick-filters">' + filtersHtml('pick', m.fm, m.fe) + '</div><button class="btn wide" data-a="new-ex-ctx">+ Crear ejercicio nuevo</button><div id="pick-list">' + pickList() + '</div>';
    } else if (m.type === 'exedit') {
      var ex = m.ex;
      var stepShown = ex.stepUnit === 'lb' ? Math.round(ex.step / LB * 10) / 10 : ex.step;
      h = '<h2>' + (m.isNew ? 'Nuevo ejercicio' : 'Ajustes del ejercicio') + '</h2>' +
        '<label>Nombre<input id="f-name" value="' + esc(ex.name) + '" autocomplete="off"></label>' +
        '<label>Músculo principal<select id="f-muscle">' + MUSCLES.map(function (x) { return '<option' + (x === ex.muscle ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<div class="lbl">Músculos secundarios</div><div class="chips" id="f-sec">' + MUSCLES.map(function (x) { return '<button type="button" class="chip tog' + (m.sec.indexOf(x) >= 0 ? ' on' : '') + '" data-a="sec" data-m="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
        '<label>Equipo<select id="f-equip">' + Object.keys(EQUIP).map(function (k) { return '<option value="' + k + '"' + (k === ex.equip ? ' selected' : '') + '>' + EQUIP[k] + '</option>'; }).join('') + '</select></label>' +
        '<div class="two"><label>Reps mínimas<input id="f-min" inputmode="numeric" value="' + ex.repMin + '"></label><label>Reps máximas<input id="f-max" inputmode="numeric" value="' + ex.repMax + '"></label></div>' +
        '<div class="two"><label>Salto mínimo de peso<input id="f-step" inputmode="decimal" value="' + fmt(stepShown) + '"></label><label>Unidad del salto<select id="f-unit"><option value="kg"' + (ex.stepUnit !== 'lb' ? ' selected' : '') + '>kg</option><option value="lb"' + (ex.stepUnit === 'lb' ? ' selected' : '') + '>libras</option></select></label></div>' +
        '<label>Fatiga que genera<select id="f-fat">' + [1, 2, 3].map(function (k) { return '<option value="' + k + '"' + (k === ex.fatigue ? ' selected' : '') + '>' + FAT[k] + '</option>'; }).join('') + '</select></label>' +
        '<div class="muted small">Alta: multiarticulares pesados. Baja: aislamiento. Cuenta para el descanso y para detectar estancamiento.</div>' +
        '<div class="two"><label>Series<input id="f-sets" inputmode="numeric" value="' + ex.sets + '"></label><label>Descanso (s, 0 = auto)<input id="f-rest" inputmode="numeric" value="' + (ex.rest || 0) + '"></label></div>' +
        '<div class="r-btns"><button class="btn primary" data-a="exedit-save">Guardar</button><button class="btn" data-a="close">Cancelar</button></div>' +
        (m.isNew ? '' : '<button class="link danger" data-a="ex-del">Eliminar ejercicio</button>');
    } else if (m.type === 'routine') {
      var r = state.routines[m.key];
      if (!r) return '';
      h = '<h2>Editar rutina</h2><label>Nombre<input id="f-rname" data-f="rname" value="' + esc(r.name) + '" autocomplete="off"></label><div class="lbl">Ejercicios</div>' + (r.ids.length ? '<div class="card list">' + r.ids.map(function (id, i) {
        var e = exById(id); if (!e) return '';
        return '<div class="li"><div class="ex-name">' + esc(e.name) + '</div><div class="r-btns tight"><button class="btn sm" data-a="r-up" data-i="' + i + '" aria-label="Subir">↑</button><button class="btn sm" data-a="r-down" data-i="' + i + '" aria-label="Bajar">↓</button><button class="btn sm danger" data-a="r-rm" data-i="' + i + '" aria-label="Quitar">✕</button></div></div>';
      }).join('') + '</div>' : '<div class="empty">Rutina vacía.</div>') + '<button class="btn wide" data-a="r-add">+ Añadir ejercicio</button>' +
        '<div class="r-btns"><button class="btn" data-a="r-dup">Duplicar</button><button class="btn danger" data-a="r-del">Borrar rutina</button></div><button class="btn primary wide" data-a="close">Listo</button>';
    } else if (m.type === 'finish') {
      h = '<h2>Terminar entreno</h2><p>' + m.done + (m.done === 1 ? ' serie marcada' : ' series marcadas') + (m.pending ? ' (' + m.pending + ' sin marcar no se guardarán)' : '') + '.</p>' +
        (m.diff ? '<label class="switch"><span>Guardar los cambios de ejercicios en la rutina</span><input type="checkbox" id="f-saver"></label>' : '') +
        '<div class="r-btns"><button class="btn primary" data-a="finish-yes">Guardar entreno</button><button class="btn" data-a="close">Seguir entrenando</button></div>';
    } else if (m.type === 'summary') {
      h = '<h2>Entreno guardado</h2><p>' + m.sets + ' series · ' + m.min + ' min</p>' + (m.prs.length ? '<div class="card list">' + m.prs.map(function (p) { return '<div class="li"><div>🏆 ' + esc(p.name) + '</div><b>' + fmt(p.w) + ' × ' + p.r + '</b></div>'; }).join('') + '</div>' : '<div class="muted">Sin récords esta vez. La próxima sesión ya tiene objetivos nuevos.</div>') + analysisHtml(sessById(m.sid), true) + '<div class="r-btns"><button class="btn primary" data-a="close">Cerrar</button><button class="btn" data-a="sess" data-id="' + esc(m.sid) + '">Ver entreno</button></div>' + photoBtn(m.sid, 'wide');
    } else if (m.type === 'day') {
      var p = m.day.split('-').map(Number), dt = new Date(p[0], p[1] - 1, p[2]);
      var gs = state.sessions.filter(function (s) { return dayKey(s.t) === m.day; });
      var cls = classActs().filter(function (a) { return a.day === m.day; });
      h = '<h2 class="cap">' + esc(dt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' +
        (cls.length ? '<div class="card list">' + cls.map(function (a) { return '<button class="li li-btn" data-a="class-edit" data-id="' + esc(a.id) + '"><div class="ex-name">' + classIcon(a.classKind) + ' ' + esc(classTitle(a)) + '</div><div class="muted small">' + a.min + ' min' + (a.rpe ? ' · ' + a.rpe + '/10' : '') + ' ›</div></button>'; }).join('') + '</div>' : '') +
        (gs.length ? '<div class="card list">' + gs.map(function (s) { var n = s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0); return '<button class="li li-btn" data-a="sess" data-id="' + esc(s.id) + '"><div class="ex-name"><span class="ic-gym">' + MINI_DB + '</span> ' + esc(s.name) + '</div><div class="muted small">' + n + ' series' + (s.prs && s.prs.length ? ' · 🏆 ' + s.prs.length : '') + ' ›</div></button>'; }).join('') + '</div>' : '<p class="muted">Sin gimnasio este día.</p>') +
        '<div class="lbl">Otras actividades</div>' + actButtons(m.day) + '<button class="btn primary wide" data-a="close">Listo</button>';
    } else if (m.type === 'clase') {
      h = classModalHtml(m);
    } else if (m.type === 'soc') {
      var join = m.mode === 'join';
      h = '<h2>' + (join ? 'Unirme a un grupo' : 'Crear grupo') + '</h2><p class="muted small">' + (join ? 'Pega el código que te han enviado y elige cómo te verán los demás.' : 'Elige cómo te verán los demás. Después podrás enviar el código del grupo a tus amigos.') + '</p>' +
        (join ? '<label>Código del grupo<input id="s-code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="GYM1-…"></label>' : '') +
        '<label>Tu nombre<input id="s-name" maxlength="30" autocomplete="given-name" placeholder="Ej.: Pau"></label>' +
        '<label>Nombre de usuario<input id="s-user" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ej.: pau"></label>' +
        '<p class="muted small">Minúsculas, números, punto o guion bajo (3–20).</p><p class="err" id="s-err" hidden></p>' +
        '<div class="r-btns"><button class="btn" data-a="close">Cancelar</button><button class="btn primary" data-a="soc-go">' + (join ? 'Unirme' : 'Crear grupo') + '</button></div>';
    } else if (m.type === 'photo') {
      h = '<img class="ph-full" data-ph="' + esc(m.id) + '"' + (purl[m.id] ? ' src="' + purl[m.id] + '"' : '') + ' alt="Foto del entreno"><div class="r-btns"><button class="btn" data-a="close">Cerrar</button><button class="btn danger" data-a="photo-del">Borrar foto</button></div>';
    } else if (m.type === 'paste') {
      h = '<h2>Pegar copia</h2><p class="muted small">Pega aquí el texto de tu copia de seguridad.</p><textarea id="paste" rows="7" class="ta"></textarea><div class="r-btns"><button class="btn primary" data-a="paste-yes">Importar</button><button class="btn" data-a="close">Cancelar</button></div>';
    } else if (m.type === 'text') {
      h = '<h2>' + esc(m.title) + '</h2><textarea class="ta" rows="7" readonly id="export-ta">' + esc(m.text) + '</textarea><p class="muted small">Selecciona todo, copia y guárdalo en Notas o envíatelo.</p><button class="btn primary wide" data-a="close">Cerrar</button>';
    }
    return '<div class="sheet">' + h + '</div>';
  }
  function pickList() {
    var m = ui.modal, a = state.active, q = (m.q || '').trim();
    var skip = {};
    if (m.ctx === 'add' && a) a.entries.forEach(function (e) { skip[e.exId] = 1; });
    if (m.ctx === 'routine') state.routines[m.key].ids.forEach(function (id) { skip[id] = 1; });
    var mine = state.exercises.filter(function (e) { return !skip[e.id] && matches(e, q, m.fm, m.fe); });
    var lib = libNotMine().filter(function (e) { return !skip[e.id] && matches(e, q, m.fm, m.fe); });
    if (!mine.length && !lib.length) return '<div class="empty">Sin resultados. Prueba a quitar filtros o crea un ejercicio nuevo.</div>';
    var h = '';
    if (mine.length) h += '<div class="grp">Mis ejercicios</div>' + mine.map(function (e) { return '<button class="card item mine" data-a="pick" data-id="' + esc(e.id) + '"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(e.muscle) + ' · ' + esc(EQUIP[e.equip] || '') + '</div></button>'; }).join('');
    if (lib.length) h += '<div class="grp">Biblioteca</div>' + lib.map(function (e) { return '<button class="card item lib" data-a="pick" data-id="' + esc(e.id) + '"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(e.muscle) + ' · ' + esc(EQUIP[e.equip] || '') + '</div></button>'; }).join('');
    return h;
  }
  function renderModal() {
    var el = $('#modal');
    if (!ui.modal) { el.hidden = true; el.innerHTML = ''; el.classList.remove('opening'); document.body.classList.remove('modal-open'); return; }
    el.hidden = false; document.body.classList.add('modal-open');
    el.innerHTML = modalHtml();
  }
  function openModal(m) { var was = !!ui.modal; ui.modal = m; renderModal(); var s = $('#modal .sheet'); if (s) { s.scrollTop = 0; if (!was) { s.classList.add('opening'); $('#modal').classList.add('opening'); } } }
  function closeModal() { ui.modal = null; renderModal(); }
  function ask(title, text, yes, fn, danger) { openModal({ type: 'confirm', title: title, text: text, yes: yes, fn: fn, danger: danger }); }

  /* ---------- render ---------- */
  function pushSection() {
    var on = pushReady(), standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    var h = '<section class="card pad" id="push-sec"><h2>Aviso con la app cerrada</h2><label class="switch"><span>Notificación al acabar el descanso</span><input type="checkbox" data-f="push"' + (on ? ' checked' : '') + (PUSH.url ? '' : ' disabled') + '></label>' +
      '<p class="muted small">Te avisa aunque el iPhone esté bloqueado o estés en otra app. Suena el tono de notificaciones de iOS (en modo silencio solo vibra) y necesita internet. Con la app delante suena el pitido de la app. El botón de silencio también lo apaga.</p>';
    if (!pushSupported() && !standalone) h += '<p class="muted small">Para activarlo, abre la app desde el icono de la pantalla de inicio.</p>';
    if (on) {
      h += '<button class="btn" data-a="push-test">Probar: bloquea el iPhone tras pulsar</button><p class="muted small" id="push-last"></p>';
      // estado del último envío, para diagnosticar si no llega
      pushCall('/status', {}).then(function (j) {
        var el = $('#push-last'); if (!el || !j.last) return;
        var ok = j.last.status >= 200 && j.last.status < 300, d = new Date(j.last.t);
        el.textContent = 'Último envío ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + ': ' + (ok ? 'entregado a Apple ✓' : 'error ' + j.last.status + ' ' + (j.last.reason || ''));
      }).catch(noop);
    }
    return h + '</section>';
  }
  var SPK = '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/>';
  function muteIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SPK + (soundOn() ? '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>' : '<path d="M16 9.5l5 5M21 9.5l-5 5"/>') + '</svg>'; }
  function syncMute() {
    document.querySelectorAll('.mute-b').forEach(function (b) { b.innerHTML = muteIcon(); b.classList.toggle('off', !soundOn()); b.setAttribute('aria-pressed', soundOn() ? 'false' : 'true'); });
    var c = document.querySelector('[data-f=sound]'); if (c) c.checked = soundOn();
  }
  // Línea de progreso del entreno: series hechas / series totales (añadir series la hace retroceder)
  function updateWprog() {
    var el = $('#wprog'); if (!el) return;
    var a = state.active, show = !!a && ui.tab === 'hoy';
    el.hidden = !show; document.body.classList.toggle('has-wprog', show);
    if (!show) return;
    var done = 0, total = 0;
    a.entries.forEach(function (e) { e.sets.forEach(function (s) { total++; if (s.done) done++; }); });
    var pct = total ? Math.round(done / total * 100) : 0;
    $('.wp-bar i', el).style.width = pct + '%';
    $('.wp-t', el).textContent = done + '/' + total + ' series · ' + pct + ' %';
    el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuenow', pct); el.setAttribute('aria-label', 'Progreso del entreno');
  }
  function render() {
    var y = getY();
    var html = ui.tab === 'hoy' ? (state.active ? viewWorkout() : viewHoy()) : ui.tab === 'cal' ? viewCal() : ui.tab === 'ej' ? viewEj() : ui.tab === 'prog' ? viewProg() : ui.tab === 'perfil' ? viewPerfil() : ui.tab === 'amigos' ? viewAmigos() : viewSet();
    $('#app').innerHTML = html;
    renderTabs(); updateTimer(); syncMute(); updateWprog(); clockSync(); hydratePhotos(); hydrateRemote();
    setY(y);
  }
  var toastT = null;
  var toastUndo = null;
  function toast(msg, undo) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false; toastUndo = undo || null;
    if (undo) { var b = document.createElement('button'); b.setAttribute('data-a', 'undo'); b.textContent = 'Deshacer'; t.appendChild(b); }
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; toastUndo = null; }, undo ? 7000 : 2200);
  }

  /* ---------- acciones ---------- */
  function newExercise() {
    return { id: 'x-' + uid(), name: '', equip: 'maquina', muscle: 'Pecho', sec: [], step: 5, stepUnit: 'kg', repMin: 8, repMax: 12, fatigue: 2, sets: 3, rest: 0 };
  }
  function openExEdit(ex, isNew, after) {
    openModal({ type: 'exedit', ex: JSON.parse(JSON.stringify(ex)), isNew: isNew, sec: (ex.sec || []).slice(), after: after, stepTouched: false });
  }
  function saveExEdit() {
    var m = ui.modal, ex = m.ex;
    var name = $('#f-name').value.trim();
    if (!name) { toast('Pon un nombre'); return; }
    var min = parseInt($('#f-min').value, 10), max = parseInt($('#f-max').value, 10);
    if (!(min > 0 && max >= min)) { toast('Rango de repeticiones no válido'); return; }
    var stepIn = num($('#f-step').value), unit = $('#f-unit').value;
    if (!(stepIn > 0)) { toast('El salto debe ser mayor que 0'); return; }
    var sets = parseInt($('#f-sets').value, 10);
    if (!(sets >= 1 && sets <= 10)) { toast('Series entre 1 y 10'); return; }
    ex.name = name; ex.muscle = $('#f-muscle').value; ex.equip = $('#f-equip').value;
    ex.sec = m.sec.filter(function (x) { return x !== ex.muscle; });
    ex.repMin = min; ex.repMax = max; ex.stepUnit = unit;
    ex.step = unit === 'lb' ? Math.round(stepIn * LB * 100) / 100 : stepIn;
    ex.fatigue = parseInt($('#f-fat').value, 10); ex.sets = sets; ex.rest = Math.max(0, parseInt($('#f-rest').value, 10) || 0);
    if (m.isNew) { state.exercises.push(ex); }
    else { var cur = exById(ex.id); Object.keys(ex).forEach(function (k) { cur[k] = ex[k]; }); }
    save(); var after = m.after; closeModal();
    if (after) after(exById(ex.id)); else render();
  }

  function addEntryFor(ex) {
    var a = state.active;
    a.entries.push(buildEntry(ex, takenMuscles(a)));
    a.open = a.entries.length - 1; save(); render();
  }

  function doFinish(saveRoutine) {
    var a = state.active, now = Date.now(), prs = [], total = 0;
    var exs = [];
    a.entries.forEach(function (e) {
      var sets = e.sets.filter(function (s) { return s.done && num(s.r) > 0; }).map(function (s) { return { w: num(s.w) || 0, r: num(s.r) }; });
      if (!sets.length) return;
      total += sets.length;
      var ex = exById(e.exId);
      if (ex) {
        var prev = 0;
        E.history(ex, state.sessions).forEach(function (h) { prev = Math.max(prev, E.bestE1(h.sets)); });
        var bestSet = null;
        sets.forEach(function (s) { if (!bestSet || E.e1rm(s.w, s.r) > E.e1rm(bestSet.w, bestSet.r)) bestSet = s; });
        if (bestSet && E.isPR(prev, bestSet.w, bestSet.r)) prs.push({ exId: e.exId, name: e.name, w: bestSet.w, r: bestSet.r });
      }
      exs.push({ exId: e.exId, name: e.name, muscle: e.muscle, sec: e.sec, fatigue: e.fatigue, sets: sets });
    });
    var sess = { id: a.id, t: now, t0: a.t0, key: a.key, name: a.name, exercises: exs, prs: prs };
    state.sessions.push(sess);
    try { sess.analysis = E.analyzeSession(sess, exMap(), state.sessions); } catch (e) { sess.analysis = null; }
    if (saveRoutine && state.routines[a.key]) state.routines[a.key].ids = a.entries.map(function (e) { return e.exId; }).filter(exById);
    var min = Math.max(1, Math.round((now - a.t0) / 60000));
    state.active = null; clearTimer(); unwake(); save();
    openModal({ type: 'summary', sets: total, min: min, prs: prs, sid: sess.id });
    render();
    if (prs.length) setTimeout(function () { confetti(); fanfare(); }, 250);
  }

  function exportData() { return JSON.stringify(state); }
  function backup() {
    var txt = exportData(), name = 'gym-copia-' + new Date().toISOString().slice(0, 10) + '.json';
    function ok() { state.settings.lastBackup = Date.now(); save(); toast('Copia guardada'); render(); }
    try {
      var file = new File([txt], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Copia Gym' }).then(ok).catch(function () { }); return; }
    } catch (e) { /* sigue */ }
    try {
      var url = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000); ok();
    } catch (e) { openModal({ type: 'text', title: 'Copia de seguridad', text: txt }); }
  }
  function importText(txt) {
    var d; try { d = JSON.parse(txt); } catch (e) { toast('El texto no es una copia válida'); return; }
    if (!d || d.v !== 1 || !Array.isArray(d.exercises) || !d.routines || !Array.isArray(d.sessions)) { toast('El archivo no es una copia de Gym'); return; }
    ask('Importar copia', 'Esto reemplaza todos los datos actuales (' + d.sessions.length + ' sesiones en la copia).', 'Importar', function () {
      d.active = null; d.timer = null; d.activities = d.activities || []; d.settings = d.settings || { sound: true, lastBackup: 0, actFatigue: true }; var ps = state.settings; clearTimer(); state = d; state.settings.push = ps.push; state.settings.pushId = ps.pushId; state.settings.social = ps.social || null; unwake(); save(); closeModal(); ui.tab = 'hoy'; render(); toast('Copia importada');
    }, true);
  }

  document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { unlockAudio(); updateTimer(); closeRestNotes(); } else pushSync(true); });
  window.addEventListener('pagehide', function () { pushSync(true); });

  /* ---------- gestos de iPhone ----------
     · deslizar desde el borde izquierdo: volver atrás (en pantallas con «‹ …»)
     · bajar una hoja inferior: cerrarla
     · tirar hacia abajo arriba del todo en Amigos/Perfil: actualizar */
  var sw = null, SW_EDGE = 24, swLate = false;
  function backBtn() { return ui.modal ? null : document.querySelector('#app .back'); }
  function canPull() { return !ui.modal && soc() && (ui.tab === 'amigos' || ui.tab === 'perfil') && getY() <= 0 && !state.active; }
  function animBackIn() {
    var ap = $('#app'); if (!ap) return;
    ap.classList.remove('enter', 'back-in'); void ap.offsetWidth; ap.classList.add('back-in');
  }
  // tocar «‹ …» también entra con la animación de volver
  document.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('#app .back')) setTimeout(animBackIn, 0); }, true);
  function swReset(el, prop) { if (el) { el.style.transition = ''; el.style[prop] = ''; } }
  document.addEventListener('touchstart', function (ev) {
    if (ev.touches.length !== 1 || sw) return;
    var t = ev.touches[0], tg = ev.target;
    var base = { x0: t.clientX, y0: t.clientY, t0: Date.now(), dx: 0, dy: 0, lock: null };
    var sh = ui.modal && $('#modal .sheet');
    if (t.clientX <= SW_EDGE && backBtn()) sw = Object.assign(base, { kind: 'back' });
    else if (sh && sh.contains(tg) && !/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) && sh.scrollTop <= 0) sw = Object.assign(base, { kind: 'sheet', el: sh });
    else if (canPull() && !(tg.closest && tg.closest('.media'))) sw = Object.assign(base, { kind: 'ptr' });
    if (!sw) return;
    sw.tg = tg;
    tg.addEventListener('touchmove', swMove, { passive: false });
    tg.addEventListener('touchend', swEnd); tg.addEventListener('touchcancel', swEnd);
  }, { passive: true });
  function swMove(ev) {
    if (!sw) return;
    var t = ev.touches[0]; sw.dx = t.clientX - sw.x0; sw.dy = t.clientY - sw.y0;
    if (!sw.lock) {
      if (Math.abs(sw.dx) < 8 && Math.abs(sw.dy) < 8) return;
      if (sw.kind === 'back') sw.lock = sw.dx > Math.abs(sw.dy) ? 'x' : 'no';
      else sw.lock = sw.dy > Math.abs(sw.dx) ? 'y' : 'no';
      if (sw.lock === 'no') { sw = null; return; }
      if (sw.kind !== 'sheet') $('#app').classList.remove('enter', 'back-in'); // que ninguna animación pise al dedo
      else sw.el.classList.remove('opening');
    }
    ev.preventDefault();
    if (sw.kind === 'back') {
      var ap = $('#app'), d = Math.max(0, sw.dx);
      ap.style.transition = 'none'; ap.style.transform = 'translateX(' + d + 'px)'; ap.classList.add('swiping');
    } else if (sw.kind === 'sheet') {
      var dy = Math.max(0, sw.dy);
      sw.el.style.transition = 'none'; sw.el.style.transform = 'translateY(' + dy + 'px)';
      $('#modal').style.backgroundColor = 'rgba(0,0,0,' + (0.55 * Math.max(0, 1 - dy / sw.el.offsetHeight)).toFixed(3) + ')';
    } else {
      var pull = Math.min(110, Math.max(0, sw.dy) * 0.5), ap2 = $('#app'), pr = $('#ptr');
      ap2.style.transition = 'none'; ap2.style.transform = 'translateY(' + pull + 'px)';
      pr.style.opacity = Math.min(1, pull / 60); pr.classList.toggle('ready', pull >= 60);
      pr.firstChild.style.transform = 'rotate(' + (pull * 5) + 'deg)';
    }
  }
  function swEnd() {
    if (!sw) return;
    var s2 = sw, el, W = window.innerWidth, ms = Math.max(1, Date.now() - s2.t0); sw = null;
    s2.tg.removeEventListener('touchmove', swMove); s2.tg.removeEventListener('touchend', swEnd); s2.tg.removeEventListener('touchcancel', swEnd);
    if (swLate) { swLate = false; setTimeout(function () { if (!sw) render(); }, 280); }
    if (!s2.lock || s2.lock === 'no') return;
    if (s2.kind === 'back') {
      el = $('#app'); var go = s2.dx > W * 0.33 || (s2.dx > 40 && s2.dx / ms > 0.45);
      el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)';
      el.style.transform = 'translateX(' + (go ? W : 0) + 'px)';
      setTimeout(function () {
        el.classList.remove('swiping'); swReset(el, 'transform');
        if (go) { var b = backBtn(); if (b) b.click(); }
      }, 220);
    } else if (s2.kind === 'sheet') {
      el = s2.el; var close = s2.dy > 110 || (s2.dy > 30 && s2.dy / ms > 0.5);
      el.style.transition = 'transform 0.22s ease-out'; el.style.transform = 'translateY(' + (close ? el.offsetHeight : 0) + 'px)';
      $('#modal').style.transition = 'background-color 0.22s ease-out'; $('#modal').style.backgroundColor = close ? 'rgba(0,0,0,0)' : '';
      setTimeout(function () { var md = $('#modal'); md.style.transition = ''; md.style.backgroundColor = ''; if (close) closeModal(); else swReset(el, 'transform'); }, 220);
    } else {
      el = $('#app'); var pr = $('#ptr'), refresh = Math.min(110, s2.dy * 0.5) >= 60;
      el.style.transition = 'transform 0.25s ease-out'; el.style.transform = refresh ? 'translateY(48px)' : '';
      if (refresh) {
        pr.classList.add('spin');
        rc.feedT = 0; rc.usersT = 0; Object.keys(rc.lists).forEach(function (k) { rc.lists[k].t = 0; }); Object.keys(rc.rels).forEach(function (k) { rc.rels[k].t = 0; });
        socSync(true); render();
        setTimeout(function () { el.style.transform = ''; pr.style.opacity = ''; pr.classList.remove('spin', 'ready'); setTimeout(function () { swReset(el, 'transform'); }, 260); }, 700);
      } else {
        pr.style.opacity = ''; pr.classList.remove('ready'); setTimeout(function () { swReset(el, 'transform'); }, 260);
      }
    }
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.id === 'modal') { closeModal(); return; }
    var el = t.closest('[data-a]'); if (!el) return;
    var a = el.getAttribute('data-a'), i = parseInt(el.getAttribute('data-i'), 10), j = parseInt(el.getAttribute('data-j'), 10);
    var act = state.active;
    switch (a) {
      case 'tab': { ui.tab = el.getAttribute('data-t'); ui.sessOpen = null; ui.people = false; ui.who = null; ui.rsess = null; ui.rel = null; if (ui.tab === 'amigos') { rc.feedT = 0; rc.usersT = 0; } closeModal(); render(); setY(0); var ap = $('#app'); ap.classList.remove('enter'); void ap.offsetWidth; ap.classList.add('enter'); break; }
      case 'close': closeModal(); break;
      case 'cal-prev': case 'cal-next': { var c = calState(); var d = new Date(c.y, c.m + (a === 'cal-next' ? 1 : -1), 1); ui.cal = { y: d.getFullYear(), m: d.getMonth() }; render(); break; }
      case 'day': openModal({ type: 'day', day: el.getAttribute('data-d') }); break;
      case 'act': { toggleAct(el.getAttribute('data-d'), el.getAttribute('data-type')); if (ui.modal && ui.modal.type === 'day') renderModal(); render(); break; }
      case 'class-add': openModal({ type: 'clase', day: el.getAttribute('data-d') }); break;
      case 'class-edit': { var ce = classById(el.getAttribute('data-id')); if (ce) openModal({ type: 'clase', edit: true, id: ce.id, day: ce.day }); break; }
      case 'class-save': saveClass(); break;
      case 'class-del': { var cid = el.getAttribute('data-id'), ca = classById(cid); if (!ca) { closeModal(); break; } ca._gone = 1; var di = state.activities.indexOf(ca); state.activities.splice(di, 1); save(); closeModal(); render(); toast('Clase borrada', function () { state.activities.splice(Math.min(di, state.activities.length), 0, ca); delete ca._gone; save(); render(); }); break; }
      case 'an-apply': {
        var sx = sessById(el.getAttribute('data-sid')), it = sx && sx.analysis && sx.analysis.items[parseInt(el.getAttribute('data-k'), 10)];
        var exa = it && exById(it.exId);
        if (exa && !it.applied) { exa.sets = Math.max(1, Math.min(6, (exa.sets || 1) + it.delta)); it.applied = true; save(); renderModal(); toast(exa.name + ': ' + exa.sets + ' series'); }
        break;
      }
      case 't-m': if (timer) { timer.end -= 15000; timer.total = Math.max(1, timer.total - 15); save(); updateTimer(); pushSync(); } break;
      case 't-p': if (timer) { timer.end += 15000; timer.total += 15; timer.fired = false; save(); updateTimer(); pushSync(); } break;
      case 't-x': clearTimer(); save(); updateTimer(); break;
      case 'mute': state.settings.sound = !soundOn(); save(); syncMute(); pushSync(); if (soundOn()) play('tick'); toast(soundOn() ? 'Sonido activado' : 'Sonido silenciado'); break;
      case 'push-test':
        if (!pushReady()) break;
        saveNextNote(Date.now() + 8000, 'Prueba ✓ Aquí verás la siguiente serie: peso × reps');
        pushCall('/arm', { at: Date.now() + 8000 }).then(function () { toast('Bloquea el iPhone: el aviso llega en 8 s'); }).catch(function (e) { toast('Error: ' + e.message); });
        break;
      case 'confirm-yes': var fn = ui.modal.fn; if (fn) fn(); break;
      case 'start': startWorkout(el.getAttribute('data-k')); break;
      case 'toggle': act.open = act.open === i ? -1 : i; save(); render(); animOpen(); break;
      case 'done': {
        var e = act.entries[i], s = e.sets[j];
        if (s.done) { s.done = false; s.pr = false; save(); render(); break; }
        // Sin reps escritas: vale el objetivo que se muestra (y su peso si el campo está vacío)
        var pj = e.plan && e.plan[j];
        if (pj && pj.r > 0) {
          if (String(s.r).trim() === '') s.r = pj.r;
          if (String(s.w).trim() === '' && pj.w > 0) s.w = pj.w;
        }
        var w = num(s.w), r = num(s.r), exr = exById(e.exId);
        var wOk = !isNaN(w) || (exr && exr.equip === 'corporal');
        if (!(r > 0) || !wOk) { var row = $('[data-row="' + i + '-' + j + '"]'); if (row) { row.classList.remove('err'); void row.offsetWidth; row.classList.add('err'); } toast('Anota peso y repeticiones'); break; }
        s.done = true; s.w = isNaN(w) ? 0 : w; s.r = r; lastDoneI = i;
        play('tick');
        checkPR(e, j);
        startTimer(exr || { fatigue: e.fatigue });
        var moved = false;
        if (e.sets.every(function (x) { return x.done; })) {
          var nx = nextPending(i);
          if (nx >= 0) { act.open = nx; moved = true; } else if (i + 1 < act.entries.length) act.open = i + 1;
        }
        save(); render();
        var pc = $('[data-row="' + i + '-' + j + '"] .chk'); if (pc) pc.classList.add('pop');
        if (moved) { animOpen(); scrollToOpen('start'); }
        break;
      }
      case 'add-set': { var e1 = act.entries[i]; var lastS = e1.sets[e1.sets.length - 1]; e1.sets.push({ w: lastS ? lastS.w : '', r: '', done: false }); save(); render(); break; }
      case 'del-set': { var e2 = act.entries[i]; if (e2.sets.length > 1 && !e2.sets[e2.sets.length - 1].done) { e2.sets.pop(); save(); render(); } else toast('No se puede quitar esa serie'); break; }
      case 'swap': openModal({ type: 'pick', ctx: 'swap', i: i, fm: act.entries[i].muscle, fe: '', q: '' }); break;
      case 'add-ex': openModal({ type: 'pick', ctx: 'add' }); break;
      case 'undo': if (toastUndo) { var uf = toastUndo; toastUndo = null; clearTimeout(toastT); $('#toast').hidden = true; uf(); } break;
      case 'rm-ex': {
        var rmE = act.entries[i], rmId = act.id, rmOpen = act.open;
        var rmDo = function () {
          act.entries.splice(i, 1); act.open = Math.min(act.open, act.entries.length - 1); lastDoneI = -1; save(); closeModal(); render();
          toast('Ejercicio quitado', function () {
            if (!state.active || state.active.id !== rmId) return;
            state.active.entries.splice(Math.min(i, state.active.entries.length), 0, rmE); state.active.open = rmOpen; save(); render();
          });
        };
        // con series ya marcadas se pregunta antes; si no, se quita y se puede deshacer
        if (rmE.sets.some(function (x) { return x.done; })) ask('Quitar ejercicio', 'Tiene series marcadas. Se quita de esta sesión (no se borra de tu lista).', 'Quitar', rmDo, true);
        else rmDo();
        break;
      }
      // ---- 10: mover un ejercicio dentro del entreno
      case 'ex-up': case 'ex-down': {
        var mj = a === 'ex-up' ? i - 1 : i + 1;
        if (mj < 0 || mj >= act.entries.length) break;
        var mt = act.entries[i]; act.entries[i] = act.entries[mj]; act.entries[mj] = mt;
        if (act.open === i) act.open = mj; else if (act.open === mj) act.open = i;
        if (lastDoneI === i) lastDoneI = mj; else if (lastDoneI === mj) lastDoneI = i;
        save(); render(); scrollToOpen('nearest'); break;
      }
      case 'ex-set': { var ex0 = exById(act.entries[i].exId); if (ex0) openExEdit(ex0, false); break; }
      case 'stall-apply': {
        var en = act.entries[i], ex1 = exById(en.exId); if (!ex1) break;
        var ref = E.reference(ex1, state.sessions); if (!ref) break;
        ex1.baseline = E.deloadBaseline(ex1, ref, Date.now()); ex1.stallResetT = ex1.baseline.t;
        var np = E.planSets(ex1, ex1.baseline.sets ? { t: ex1.baseline.t, sets: ex1.baseline.sets, source: 'baseline' } : ref);
        en.plan = np; en.last = ex1.baseline.sets; en.stall = null;
        np.forEach(function (p, k) { if (en.sets[k] && !en.sets[k].done) en.sets[k].w = p.w; });
        save(); render(); toast('Ajuste aplicado'); break;
      }
      case 'stall-ignore': { var ex2 = exById(act.entries[i].exId); if (ex2) { var hh = E.history(ex2, state.sessions); ex2.stallResetT = hh.length ? hh[hh.length - 1].t : Date.now(); } act.entries[i].stall = null; save(); render(); break; }
      case 'finish': {
        var done = 0, pending = 0;
        act.entries.forEach(function (en2) { en2.sets.forEach(function (s2) { if (s2.done) done++; else if (num(s2.r) > 0) pending++; }); });
        if (!done) { toast('Marca al menos una serie'); break; }
        var rt = state.routines[act.key];
        var diff = !!rt && JSON.stringify(rt.ids) !== JSON.stringify(act.entries.map(function (x) { return x.exId; }));
        openModal({ type: 'finish', done: done, pending: pending, diff: diff }); break;
      }
      case 'finish-yes': { var chk = $('#f-saver'); var sv = chk && chk.checked; closeModal(); doFinish(sv); break; }
      case 'discard': ask('Descartar entreno', 'Se pierde lo anotado en esta sesión.', 'Descartar', function () { state.active = null; clearTimer(); unwake(); save(); closeModal(); render(); }, true); break;
      case 'pick': {
        var id = el.getAttribute('data-id'), exp = exById(id) || adoptLib(id), m = ui.modal;
        if (!exp) break;
        if (m.ctx === 'swap') { act.entries[m.i] = buildEntry(exp, (function () { var tk = takenMuscles(act); delete tk[act.entries[m.i].muscle]; return tk; })()); act.open = m.i; closeModal(); save(); render(); }
        else if (m.ctx === 'add') { closeModal(); addEntryFor(exp); }
        else if (m.ctx === 'routine') { state.routines[m.key].ids.push(id); save(); openModal({ type: 'routine', key: m.key }); render(); }
        break;
      }
      case 'new-ex': openExEdit(newExercise(), true); break;
      case 'new-ex-ctx': {
        var pm = ui.modal;
        openExEdit(newExercise(), true, function (nex) {
          if (pm.ctx === 'swap') { act.entries[pm.i] = buildEntry(nex, {}); act.open = pm.i; save(); render(); }
          else if (pm.ctx === 'add') addEntryFor(nex);
          else if (pm.ctx === 'routine') { state.routines[pm.key].ids.push(nex.id); save(); openModal({ type: 'routine', key: pm.key }); render(); }
        });
        break;
      }
      case 'edit-lib': { var lb = libById(el.getAttribute('data-id')); if (lb) openExEdit(libToExercise(lb), true); break; }
      case 'lib-tog': ui.libOpen = !ui.libOpen; $('#ex-list').innerHTML = exListHtml(); break;
      case 'flt': {
        var sc = el.getAttribute('data-scope'), fk = el.getAttribute('data-k') === 'm' ? 'fm' : 'fe', fv = el.getAttribute('data-v');
        if (sc === 'ej') { ui[fk] = ui[fk] === fv ? '' : fv; $('#ej-filters').innerHTML = filtersHtml('ej', ui.fm, ui.fe); $('#ex-list').innerHTML = exListHtml(); }
        else if (ui.modal) { ui.modal[fk] = ui.modal[fk] === fv ? '' : fv; $('#pick-filters').innerHTML = filtersHtml('pick', ui.modal.fm, ui.modal.fe); $('#pick-list').innerHTML = pickList(); }
        break;
      }
      case 'new-routine': { var nk = newRoutine('Nueva rutina', []); render(); openModal({ type: 'routine', key: nk }); setTimeout(function () { var f = $('#f-rname'); if (f) { f.focus(); f.select(); } }, 60); break; }
      case 'ro-up': case 'ro-down': {
        var o = routineKeys(), ri = o.indexOf(el.getAttribute('data-k')), rt = a === 'ro-up' ? ri - 1 : ri + 1;
        if (ri >= 0 && rt >= 0 && rt < o.length) { var tmpk = o[ri]; o[ri] = o[rt]; o[rt] = tmpk; save(); render(); }
        break;
      }
      case 'r-dup': { var src = state.routines[ui.modal.key]; var dk = newRoutine(src.name + ' (copia)', src.ids.slice(), ui.modal.key); render(); openModal({ type: 'routine', key: dk }); toast('Rutina duplicada'); break; }
      case 'r-del': {
        var delk = ui.modal.key, dn = state.routines[delk].name;
        ask('Borrar rutina', 'Se borra «' + dn + '». Tus ejercicios y el historial se conservan.', 'Borrar', function () {
          delete state.routines[delk]; state.routineOrder = (state.routineOrder || []).filter(function (k) { return k !== delk; });
          save(); closeModal(); render(); toast('Rutina borrada');
        }, true);
        break;
      }
      case 'edit-ex': { var ex3 = exById(el.getAttribute('data-id')); if (ex3) openExEdit(ex3, false); break; }
      case 'sec': { var mm = el.getAttribute('data-m'), arr = ui.modal.sec, k = arr.indexOf(mm); if (k >= 0) arr.splice(k, 1); else arr.push(mm); el.classList.toggle('on'); break; }
      case 'exedit-save': saveExEdit(); break;
      case 'ex-del': {
        var dx = ui.modal.ex;
        ask('Eliminar ejercicio', 'Se borra de tu lista y de las rutinas. El historial de sesiones se conserva.', 'Eliminar', function () {
          state.exercises = state.exercises.filter(function (x) { return x.id !== dx.id; });
          Object.keys(state.routines).forEach(function (kk) { state.routines[kk].ids = state.routines[kk].ids.filter(function (x) { return x !== dx.id; }); });
          save(); closeModal(); render();
        }, true); break;
      }
      case 'edit-routine': openModal({ type: 'routine', key: el.getAttribute('data-k') }); break;
      case 'r-up': case 'r-down': {
        var ids = state.routines[ui.modal.key].ids, to = a === 'r-up' ? i - 1 : i + 1;
        if (to >= 0 && to < ids.length) { var tmp = ids[i]; ids[i] = ids[to]; ids[to] = tmp; save(); renderModal(); render(); }
        break;
      }
      case 'r-rm': state.routines[ui.modal.key].ids.splice(i, 1); save(); renderModal(); render(); break;
      case 'r-add': openModal({ type: 'pick', ctx: 'routine', key: ui.modal.key }); break;
      case 'musc-tog': ui.progMOpen = !ui.progMOpen; render(); break;
      case 'sess': {
        if (ui.tab === 'perfil' && !ui.sessOpen) ui.pfScroll = getY();
        ui.tab = 'perfil'; ui.sessOpen = el.getAttribute('data-id'); closeModal(); render(); setY(0);
        var ap2 = $('#app'); ap2.classList.remove('enter'); void ap2.offsetWidth; ap2.classList.add('enter'); break;
      }
      case 'photo': openModal({ type: 'photo', id: el.getAttribute('data-id'), sid: el.getAttribute('data-sid') }); hydratePhotos(); break;
      case 'photo-del': {
        var px = sessById(ui.modal.sid), pid = ui.modal.id, pi = px ? (px.photos || []).indexOf(pid) : -1;
        if (pi < 0) { closeModal(); break; }
        px.photos.splice(pi, 1); save(); closeModal(); render();
        // se borra de verdad cuando ya no se puede deshacer
        var pdel = setTimeout(function () { photoDel(pid); }, 7500);
        toast('Foto borrada', function () { clearTimeout(pdel); var py = sessById(px.id); if (py) { (py.photos = py.photos || []).splice(Math.min(pi, py.photos.length), 0, pid); save(); render(); } });
        break;
      }
      case 'soc-start': openModal({ type: 'soc', mode: el.getAttribute('data-m') }); break;
      case 'soc-go': {
        var mode = ui.modal.mode, nm = ($('#s-name').value || '').trim(), un = ($('#s-user').value || '').trim().toLowerCase().replace(/^@/, '');
        var cm = mode === 'join' ? (($('#s-code').value || '').match(CODE_RE) || [''])[0] : newCode();
        var err = function (t) { var e2 = $('#s-err'); e2.textContent = t; e2.hidden = false; };
        if (mode === 'join' && !cm) { err('Ese código no es válido. Cópialo entero desde el mensaje.'); break; }
        if (!nm) { err('Escribe tu nombre.'); break; }
        if (!/^[a-z0-9_.]{3,20}$/.test(un)) { err('El nombre de usuario debe tener 3–20 letras minúsculas, números, punto o guion bajo.'); break; }
        if (!PUSH.url) { err('No hay servidor configurado.'); break; }
        el.disabled = true; el.textContent = 'Un momento…';
        socKeys(cm).then(function (k) { return socCall('register', { proof: k.proof, username: un, name: nm }, true); }).then(function (r) {
          state.settings.social = { uid: r.uid, token: r.token, username: un, name: nm, code: cm }; save(); closeModal();
          rc = { feed: null, feedT: 0, users: null, usersT: 0, me: null, lists: {}, rels: {}, loading: {} };
          ui.tab = 'amigos'; ui.people = mode === 'create'; ui.peopleFrom = 'amigos'; render(); setY(0);
          toast(mode === 'create' ? 'Grupo creado. Envía el código a tus amigos' : '¡Ya estás dentro! Sigue a tus amigos');
          socSync(true);
        }).catch(function (e) {
          el.disabled = false; el.textContent = mode === 'join' ? 'Unirme' : 'Crear grupo';
          var st2 = e && e.status, er = e && e.message;
          err(st2 === 409 ? 'Ese nombre de usuario ya está cogido.' : st2 === 403 && er === 'code' ? (mode === 'join' ? 'El código no es el de este grupo.' : 'Ya existe un grupo. Pide el código a quien lo creó y usa «Tengo un código».') : st2 === 403 ? 'El grupo está completo.' : 'No se pudo conectar. Revisa la conexión e inténtalo otra vez.');
        });
        break;
      }
      case 'soc-copy': {
        var code = soc().code;
        var done = function () { toast('Código copiado'); };
        try { navigator.clipboard.writeText(code).then(done, function () { openModal({ type: 'text', title: 'Código del grupo', text: code }); }); } catch (e) { openModal({ type: 'text', title: 'Código del grupo', text: code }); }
        break;
      }
      case 'soc-share': {
        var msg = 'Únete a mi grupo de entreno 💪\n1) Abre ' + location.href.split('#')[0] + ' en Safari y añádela a la pantalla de inicio (Compartir › Añadir a pantalla de inicio).\n2) En la app, ve a Amigos › «Tengo un código» y pega este código:\n' + soc().code;
        if (navigator.share) navigator.share({ text: msg }).catch(noop);
        else { try { navigator.clipboard.writeText(msg).then(function () { toast('Invitación copiada'); }); } catch (e) { openModal({ type: 'text', title: 'Invitación', text: msg }); } }
        break;
      }
      case 'followtog': {
        var fu = el.getAttribute('data-u'), rel = el.getAttribute('data-rel');
        var send = rel === 'none' ? 'request' : 'unfollow';
        el.disabled = true;
        socCall(send, { uid: fu }).then(function (r) {
          var nrel = send === 'request' ? (r.rel || 'pending') : 'none';
          (rc.users || []).forEach(function (u) { if (u.uid === fu) u.rel = nrel; });
          if (rc.lists[fu]) { rc.lists[fu].prof.rel = nrel; rc.lists[fu].t = 0; }
          Object.keys(rc.rels).forEach(function (k) { rc.rels[k].t = 0; });
          rc.feed = null; rc.feedT = 0;
          render(); toast(nrel === 'pending' ? 'Solicitud enviada' : nrel === 'following' ? 'Siguiendo' : rel === 'pending' ? 'Solicitud cancelada' : 'Has dejado de seguir');
        }).catch(function () { el.disabled = false; toast('No se pudo conectar'); });
        break;
      }
      case 'req-accept': case 'req-reject': {
        var ru = el.getAttribute('data-u'), ok = a === 'req-accept';
        el.disabled = true;
        socCall(ok ? 'accept' : 'reject', { uid: ru }).then(function () {
          if (rc.me) rc.me.requests = rc.me.requests.filter(function (r) { return r.uid !== ru; });
          rc.usersT = 0; rc.feed = null; rc.feedT = 0; Object.keys(rc.rels).forEach(function (k) { rc.rels[k].t = 0; });
          render(); toast(ok ? 'Solicitud aceptada' : 'Solicitud rechazada');
        }).catch(function () { el.disabled = false; toast('No se pudo conectar'); });
        break;
      }
      case 'rm-follower': {
        var mu = el.getAttribute('data-u');
        ask('Quitar seguidor', 'Dejará de ver tus entrenos. Puede volver a solicitártelo.', 'Quitar', function () {
          socCall('remove', { uid: mu }).then(function () {
            Object.keys(rc.rels).forEach(function (k) { rc.rels[k].t = 0; }); rc.usersT = 0;
            closeModal(); render(); toast('Seguidor quitado');
          }).catch(function () { closeModal(); toast('No se pudo conectar'); });
        }, true);
        break;
      }
      case 'rel-list': ui.relKind = el.getAttribute('data-k'); ui.relFrom = ui.who ? 'who' : ui.tab === 'perfil' ? 'perfil' : 'amigos'; ui.relWho = ui.who; if (ui.relFrom === 'perfil') { ui.peopleFrom = 'perfil'; } ui.tab = 'amigos'; ui.rel = el.getAttribute('data-k'); ui.relU = el.getAttribute('data-u'); ui.who = null; render(); setY(0); break;
      case 'rel-back': ui.rel = null; if (ui.relFrom === 'who') { ui.who = ui.relWho; } else if (ui.relFrom === 'perfil') { ui.tab = 'perfil'; } render(); setY(0); break;
      case 'people': rc.users = null; rc.usersT = 0; ui.peopleFrom = ui.tab === 'perfil' ? 'perfil' : 'amigos'; ui.tab = 'amigos'; ui.people = true; ui.who = null; ui.rsess = null; ui.rel = null; render(); setY(0); break;
      case 'people-back': ui.people = false; if (ui.peopleFrom === 'perfil') ui.tab = 'perfil'; render(); setY(0); break;
      case 'who': { var wu = el.getAttribute('data-u'); if (rc.lists[wu]) rc.lists[wu].t = 0; ui.tab = 'amigos'; ui.whoFrom = ui.people ? 'people' : ui.rsess ? 'rsess' : ui.rel ? 'rel' : 'feed'; ui.people = false; ui.rsess = null; ui.rel = null; ui.who = wu; render(); setY(0); break; }
      case 'who-back': ui.who = null; if (ui.whoFrom === 'people') ui.people = true; else if (ui.whoFrom === 'rel') { ui.rel = ui.relKind || 'followers'; ui.relU = soc().uid; } render(); setY(0); break;
      case 'rsess': {
        if (!ui.rsess && !ui.who) ui.feedScroll = getY();
        if (ui.who) ui.whoScroll = getY();
        ui.rsessU = el.getAttribute('data-u'); ui.rsess = el.getAttribute('data-id'); ui.rsessFrom = el.getAttribute('data-from') || 'feed';
        if (ui.rsessFrom === 'feed') ui.who = null;
        render(); setY(0); var ap3 = $('#app'); ap3.classList.remove('enter'); void ap3.offsetWidth; ap3.classList.add('enter'); break;
      }
      case 'rsess-back': ui.rsess = null; render(); setY(ui.rsessFrom === 'who' ? ui.whoScroll || 0 : ui.feedScroll || 0); break;
      case 'feed-more': loadFeed(true); render(); break;
      case 'soc-leave': ask('Salir del grupo', 'Se borran del servidor tu cuenta, tus entrenos y tus fotos compartidas. En tu iPhone no se borra nada.', 'Salir', function () {
        socCall('leave').then(function () {
          state.settings.social = null; save(); closeModal(); ui.people = false; ui.who = null; ui.rsess = null; rc.feed = null; render(); toast('Has salido del grupo');
        }).catch(function () { closeModal(); toast('No se pudo conectar'); });
      }, true); break;
      case 'sess-back': ui.sessOpen = null; render(); setY(ui.pfScroll || 0); break;
      case 'pf-m': ui.pfM = el.getAttribute('data-v'); render(); break;
      case 'pf-more': ui.feedN = (ui.feedN || 20) + 20; render(); break;
      case 'prog-ex': ui.progEx = ui.progEx === el.getAttribute('data-id') ? null : el.getAttribute('data-id'); render(); break;
      case 'hist': ui.histOpen = ui.histOpen === el.getAttribute('data-id') ? null : el.getAttribute('data-id'); render(); break;
      case 'del-sess': { var sid = el.getAttribute('data-id'); ask('Borrar sesión', 'Se elimina del historial y de los cálculos.', 'Borrar', function () {
        var di = -1; state.sessions.forEach(function (x, k) { if (x.id === sid) di = k; });
        if (di < 0) { closeModal(); return; }
        var ds = state.sessions.splice(di, 1)[0]; ui.histOpen = null; ui.sessOpen = null; save(); closeModal(); render();
        toast('Sesión borrada', function () { state.sessions.splice(Math.min(di, state.sessions.length), 0, ds); save(); render(); });
      }, true); break; }
      case 'backup': backup(); break;
      case 'copy': {
        var txt = exportData();
        var fall = function () { openModal({ type: 'text', title: 'Copia de seguridad', text: txt }); setTimeout(function () { var ta = $('#export-ta'); if (ta) { ta.focus(); ta.select(); } }, 50); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { state.settings.lastBackup = Date.now(); save(); toast('Copiado al portapapeles'); render(); }).catch(fall); else fall();
        break;
      }
      case 'import-file': $('#file').click(); break;
      case 'import-paste': openModal({ type: 'paste' }); break;
      case 'paste-yes': importText($('#paste').value); break;
      case 'reset': ask('Restaurar datos iniciales', 'Se borran tu historial y los cambios hechos a ejercicios y rutinas.', 'Restaurar', function () { var ps = state.settings; clearTimer(); state = fresh(); state.settings.push = ps.push; state.settings.pushId = ps.pushId; state.settings.social = ps.social || null; unwake(); save(); closeModal(); ui.tab = 'hoy'; render(); toast('Datos iniciales restaurados'); }, true); break;
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target, f = t.getAttribute && t.getAttribute('data-f'); if (!f) return;
    if (f === 'w' || f === 'r') {
      var s = state.active.entries[+t.getAttribute('data-i')].sets[+t.getAttribute('data-j')];
      s[f] = t.value; if (s.done) { s.done = false; var row = t.closest('.set'); if (row) row.classList.remove('done'); save(); updateWprog(); }
      else saveSoon();
    } else if (f === 'q') { ui.query = t.value; $('#ex-list').innerHTML = exListHtml(); }
    else if (f === 'pq') { ui.modal.q = t.value; $('#pick-list').innerHTML = pickList(); }
    else if (f === 'rname' && ui.modal && state.routines[ui.modal.key]) { state.routines[ui.modal.key].name = t.value.trim() || 'Rutina'; save(); render(); }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-f') === 'sound') { state.settings.sound = t.checked; save(); syncMute(); pushSync(); }
    else if (t.getAttribute && t.getAttribute('data-f') === 'push') { if (t.checked) enablePush(); else { if (timer && timer.armed) { pushStop(); timer.armed = 0; } state.settings.push = false; save(); render(); } }
    else if (t.getAttribute && t.getAttribute('data-f') === 'progM') { ui.progM = t.value; render(); }
    else if (t.getAttribute && t.getAttribute('data-f') === 'actFatigue') { state.settings.actFatigue = t.checked; save(); }
    else if (t.getAttribute && t.getAttribute('data-f') === 'photo') { if (t.files && t.files.length) addPhotos(t.getAttribute('data-sid'), t.files); t.value = ''; }
    else if (t.id === 'file' && t.files && t.files[0]) { var rd = new FileReader(); rd.onload = function () { importText(String(rd.result)); }; rd.readAsText(t.files[0]); t.value = ''; }
    else if (t.getAttribute && t.getAttribute('data-f') === 'c-kind' && ui.modal && ui.modal.type === 'clase') { ui.modal.kind = t.value; renderModal(); }
    else if (t.id === 'f-equip' && ui.modal && ui.modal.type === 'exedit' && ui.modal.isNew && !ui.modal.stepTouched) { $('#f-step').value = fmt(STEP_DEFAULT[t.value] || 2.5); $('#f-unit').value = 'kg'; }
  });
  document.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('in')) setTimeout(function () { try { t.select(); } catch (e) { /* nada */ } }, 0);
    if (t.id === 'f-step' && ui.modal) ui.modal.stepTouched = true;
  });

  /* ---------- arranque ---------- */
  render();
  if (state.active) wake();
  pushRefresh(); closeRestNotes(); gcPhotos(); slimPhotos();
  if (soc()) setTimeout(function () { socSync(true); }, 600);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && soc()) { socSoon(); if (ui.tab === 'amigos') { rc.feedT = 0; render(); } } });
  window.addEventListener('online', function () { if (soc()) { socSync(true); if (ui.tab === 'amigos') render(); } });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    // Versión nueva: se recarga sola (si estás en mitad de un entreno, al volver a la app; los datos ya están guardados)
    var hadSW = !!navigator.serviceWorker.controller, reloadPending = false, swReg = null;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadSW) { hadSW = true; return; }
      if (state.active && !document.hidden) { reloadPending = true; return; }
      location.reload();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (reloadPending) { location.reload(); return; }
      if (swReg) swReg.update().catch(function () { });
    });
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { swReg = r; }).catch(function () { }); });
  }
  window.__gym = { get state() { return state; }, E: E, sounds: sounds, socSync: socSync, get sw() { return sw; }, canPull: function () { return canPull(); }, get socBusy() { return socBusy; }, get clockOn() { return !!clock; } }; // útil para pruebas
})();
