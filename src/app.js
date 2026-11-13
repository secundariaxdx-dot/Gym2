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
  function save() { state.timer = timer; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; } }
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
    save(); updateTimer();
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
      if (kind === 'tick') { tone(1650, 0, 0.05, 0.07); }
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
    if (left <= 0) {
      if (!timer.fired) { timer.fired = true; beep(); }
      if (-left > 5) { timer = null; save(); el.hidden = true; document.body.classList.remove('has-timer'); return; }
      el.classList.add('fin'); $('.t', el).textContent = '¡Listo!'; $('.bar i', el).style.width = '100%';
    } else {
      el.classList.remove('fin'); $('.t', el).textContent = mmss(left); $('.bar i', el).style.width = Math.max(0, 100 - (left / timer.total) * 100) + '%';
    }
  }
  setInterval(function () {
    updateTimer();
    var el = $('#elapsed');
    if (el && state.active) el.textContent = mmss((Date.now() - state.active.t0) / 1000);
  }, 250);

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
    aj: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>'
  };
  function svg(p) { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderTabs() {
    var tabs = [['hoy', 'Hoy'], ['cal', 'Calendario'], ['ej', 'Ejercicios'], ['prog', 'Progreso'], ['aj', 'Ajustes']];
    $('#tabs').innerHTML = tabs.map(function (t) {
      return '<button class="tab' + (ui.tab === t[0] ? ' on' : '') + '" data-a="tab" data-t="' + t[0] + '">' + svg(ICON[t[0]]) + '<span>' + t[1] + '</span></button>';
    }).join('');
  }

  function targetText(p) {
    if (!p) return '';
    if (!p.w) return 'reps ' + p.r;
    return fmt(p.w) + ' × ' + p.r;
  }
  function setsText(sets) { return sets.map(function (s) { return fmt(s.w) + '×' + s.r; }).join(' · '); }

  function viewHoy() {
    var now = Date.now();
    var fs = E.fatigueSummary(fatigueSessions(), now), fm = {};
    fs.forEach(function (f) { fm[f.muscle] = f; });
    var d = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    var h = '<header class="top"><div><h1>Hoy</h1><div class="sub cap">' + esc(d) + '</div></div></header>';
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
    var h = '<section class="card ex' + (open ? ' open' : '') + '"><button class="ex-head" data-a="toggle" data-i="' + i + '"><div><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(e.muscle) + '</div></div><div class="ex-count' + (d && d === e.sets.length ? ' full' : '') + '">' + d + '/' + e.sets.length + '</div></button>';
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
    h += '<div class="ex-actions"><button class="btn sm" data-a="add-set" data-i="' + i + '">+ Serie</button><button class="btn sm" data-a="del-set" data-i="' + i + '">− Serie</button><button class="btn sm" data-a="swap" data-i="' + i + '">Cambiar</button><button class="btn sm" data-a="ex-set" data-i="' + i + '">Ajustes</button><button class="btn sm danger" data-a="rm-ex" data-i="' + i + '">Quitar</button></div></div></section>';
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
    function get(k) { return map[k] || (map[k] = { gym: [], acts: [] }); }
    state.sessions.forEach(function (s) { get(dayKey(s.t)).gym.push(s); });
    (state.activities || []).forEach(function (a) { if (get(a.day).acts.indexOf(a.type) < 0) get(a.day).acts.push(a.type); });
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
    }).join('') + '</div>';
  }
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
    var nGym = 0, nF = 0, nC = 0;
    for (var d = 1; d <= days; d++) {
      var k = c.y + '-' + two(c.m + 1) + '-' + two(d), di = info[k], fut = k > today;
      var ic = '';
      if (di) {
        if (di.gym.length) { ic += '<span class="ic-gym">' + MINI_DB + '</span>'; nGym++; }
        if (di.acts.indexOf('futbol') >= 0) { ic += '<span>⚽</span>'; nF++; }
        if (di.acts.indexOf('correr') >= 0) { ic += '<span>👟</span>'; nC++; }
      }
      h += '<button class="cal-d' + (di && di.gym.length ? ' gym' : '') + (k === today ? ' today' : '') + (fut ? ' fut' : '') + '"' + (fut ? ' disabled' : ' data-a="day" data-d="' + k + '"') + '><span class="dn">' + d + '</span><span class="ic">' + ic + '</span></button>';
    }
    h += '</div>';
    h += '<div class="cal-sum"><span><span class="ic-gym">' + MINI_DB + '</span> ' + nGym + ' días de gimnasio</span><span>⚽ ' + nF + '</span><span>👟 ' + nC + '</span></div>';
    h += '<div class="muted small pad0">Toca un día para ver el entreno o anotar fútbol o correr.</div>';
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
    if (lib.length) {
      h += '<h3 class="sec">Biblioteca · ' + lib.length + '</h3><div class="muted small pad0">Toca uno para añadirlo a tus ejercicios.</div>' + group(lib, function (e) {
        return '<button class="card item lib" data-a="edit-lib" data-id="' + esc(e.id) + '"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(EQUIP[e.equip]) + '</div></button>';
      });
    }
    return h;
  }

  function viewProg() {
    var now = Date.now();
    var h = '<header class="top"><h1>Progreso</h1></header>';
    // Récords
    h += '<h3 class="sec">Récords personales</h3>';
    var rows = [];
    var recent = {};
    state.sessions.forEach(function (s) { (s.prs || []).forEach(function (p) { if (now - s.t < 14 * 86400000) recent[p.exId] = s.t; }); });
    state.exercises.forEach(function (ex) {
      var best = null;
      E.history(ex, state.sessions).forEach(function (hh) { hh.sets.forEach(function (s) { if (s.w > 0 && s.r > 0 && s.r <= 15) { var v = E.e1rm(s.w, s.r); if (!best || v > best.v) best = { v: v, w: s.w, r: s.r, t: hh.t }; } }); });
      if (best) rows.push({ ex: ex, best: best, recent: recent[ex.id] });
    });
    rows.sort(function (a, b) { return (b.recent || 0) - (a.recent || 0) || a.ex.name.localeCompare(b.ex.name); });
    h += rows.length ? '<div class="card list">' + rows.map(function (r) {
      return '<div class="li"><div><div class="ex-name">' + esc(r.ex.name) + '</div><div class="muted small">1RM estimado ' + fmt(r.best.v) + ' kg</div></div><div class="right">' + (r.recent ? '<span class="chip ok">Nuevo</span> ' : '') + '<b>' + fmt(r.best.w) + ' × ' + r.best.r + '</b></div></div>';
    }).join('') + '</div>' : '<div class="empty">Aún no hay datos.</div>';
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
    // Historial
    h += '<h3 class="sec">Historial</h3>';
    var ss = state.sessions.slice().sort(function (a, b) { return b.t - a.t; });
    h += ss.length ? ss.map(function (s) {
      var n = s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0);
      var open = ui.histOpen === s.id;
      var b = '<section class="card"><button class="ex-head" data-a="hist" data-id="' + s.id + '"><div><div class="ex-name">' + esc(s.name) + '</div><div class="muted small">' + fmtDate(s.t) + ' · ' + n + ' series' + (s.prs && s.prs.length ? ' · 🏆 ' + s.prs.length : '') + '</div></div></button>';
      if (open) {
        b += '<div class="ex-body">' + s.exercises.map(function (e) { return '<div class="li col"><div class="ex-name">' + esc(e.name) + '</div><div class="muted small">' + esc(setsText(e.sets)) + '</div></div>'; }).join('') +
          analysisHtml(s, false) + '<button class="link danger" data-a="del-sess" data-id="' + s.id + '">Borrar esta sesión</button></div>';
      }
      return b + '</section>';
    }).join('') : '<div class="empty">Todavía no hay sesiones guardadas.</div>';
    return h;
  }

  function viewSet() {
    var lb = state.settings.lastBackup;
    return '<header class="top"><h1>Ajustes</h1></header>' +
      '<section class="card pad"><h2>Copia de seguridad</h2><p class="muted small">Tus datos están solo en este iPhone. ' + (lb ? 'Última copia: ' + fmtDate(lb) + '.' : 'Aún no has hecho ninguna copia.') + '</p>' +
      '<div class="r-btns"><button class="btn primary" data-a="backup">Guardar copia</button><button class="btn" data-a="copy">Copiar texto</button></div>' +
      '<div class="r-btns"><button class="btn" data-a="import-file">Importar archivo</button><button class="btn" data-a="import-paste">Pegar texto</button></div>' +
      '<input id="file" type="file" accept="application/json,.json" hidden></section>' +
      '<section class="card pad"><h2>Descanso</h2><label class="switch"><span>Sonidos (serie hecha y fin del descanso)</span><input type="checkbox" data-f="sound"' + (state.settings.sound !== false ? ' checked' : '') + '></label></section>' +
      '<section class="card pad"><h2>Fútbol y correr</h2><label class="switch"><span>Cuentan (poco) en la fatiga de piernas</span><input type="checkbox" data-f="actFatigue"' + (state.settings.actFatigue !== false ? ' checked' : '') + '></label></section>' +
      '<section class="card pad"><h2>Instalar en el iPhone</h2><p class="muted small">En Safari: botón Compartir → «Añadir a pantalla de inicio». Así se abre a pantalla completa y los datos se conservan.</p></section>' +
      '<section class="card pad"><h2>Datos iniciales</h2><p class="muted small">Vuelve a cargar tus 17 ejercicios con la última sesión de las capturas. Borra tu historial.</p><button class="btn danger" data-a="reset">Restaurar datos iniciales</button></section>' +
      '<div class="muted small center">Versión 1.3 · progresión al fallo con doble progresión</div>';
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
      h = '<h2>Terminar entreno</h2><p>' + m.done + ' series marcadas' + (m.pending ? ' (' + m.pending + ' sin marcar no se guardarán)' : '') + '.</p>' +
        (m.diff ? '<label class="switch"><span>Guardar los cambios de ejercicios en la rutina</span><input type="checkbox" id="f-saver"></label>' : '') +
        '<div class="r-btns"><button class="btn primary" data-a="finish-yes">Guardar entreno</button><button class="btn" data-a="close">Seguir entrenando</button></div>';
    } else if (m.type === 'summary') {
      h = '<h2>Entreno guardado</h2><p>' + m.sets + ' series · ' + m.min + ' min</p>' + (m.prs.length ? '<div class="card list">' + m.prs.map(function (p) { return '<div class="li"><div>🏆 ' + esc(p.name) + '</div><b>' + fmt(p.w) + ' × ' + p.r + '</b></div>'; }).join('') + '</div>' : '<div class="muted">Sin récords esta vez. La próxima sesión ya tiene objetivos nuevos.</div>') + analysisHtml(sessById(m.sid), true) + '<button class="btn primary wide" data-a="close">Cerrar</button>';
    } else if (m.type === 'day') {
      var p = m.day.split('-').map(Number), dt = new Date(p[0], p[1] - 1, p[2]);
      var gs = state.sessions.filter(function (s) { return dayKey(s.t) === m.day; });
      h = '<h2 class="cap">' + esc(dt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' +
        (gs.length ? '<div class="card list">' + gs.map(function (s) { var n = s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0); return '<div class="li"><div class="ex-name"><span class="ic-gym">' + MINI_DB + '</span> ' + esc(s.name) + '</div><div class="muted small">' + n + ' series' + (s.prs && s.prs.length ? ' · 🏆 ' + s.prs.length : '') + '</div></div>'; }).join('') + '</div>' : '<p class="muted">Sin gimnasio este día.</p>') +
        '<div class="lbl">Otras actividades</div>' + actButtons(m.day) + '<button class="btn primary wide" data-a="close">Listo</button>';
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
    if (!ui.modal) { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('modal-open'); return; }
    el.hidden = false; document.body.classList.add('modal-open');
    el.innerHTML = modalHtml();
  }
  function openModal(m) { ui.modal = m; renderModal(); var s = $('#modal .sheet'); if (s) s.scrollTop = 0; }
  function closeModal() { ui.modal = null; renderModal(); }
  function ask(title, text, yes, fn, danger) { openModal({ type: 'confirm', title: title, text: text, yes: yes, fn: fn, danger: danger }); }

  /* ---------- render ---------- */
  function muteIcon() { return soundOn() ? '🔊' : '🔇'; }
  function syncMute() {
    document.querySelectorAll('.mute-b').forEach(function (b) { b.textContent = muteIcon(); b.classList.toggle('off', !soundOn()); b.setAttribute('aria-pressed', soundOn() ? 'false' : 'true'); });
    var c = document.querySelector('[data-f=sound]'); if (c) c.checked = soundOn();
  }
  function render() {
    var y = window.scrollY;
    var html = ui.tab === 'hoy' ? (state.active ? viewWorkout() : viewHoy()) : ui.tab === 'cal' ? viewCal() : ui.tab === 'ej' ? viewEj() : ui.tab === 'prog' ? viewProg() : viewSet();
    $('#app').innerHTML = html;
    renderTabs(); updateTimer(); syncMute();
    window.scrollTo(0, y);
  }
  var toastT = null;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2200);
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
    state.active = null; timer = null; unwake(); save();
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
      d.active = null; d.timer = null; d.activities = d.activities || []; d.settings = d.settings || { sound: true, lastBackup: 0, actFatigue: true }; state = d; timer = null; unwake(); save(); closeModal(); ui.tab = 'hoy'; render(); toast('Copia importada');
    }, true);
  }

  document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { unlockAudio(); updateTimer(); } });

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.id === 'modal') { closeModal(); return; }
    var el = t.closest('[data-a]'); if (!el) return;
    var a = el.getAttribute('data-a'), i = parseInt(el.getAttribute('data-i'), 10), j = parseInt(el.getAttribute('data-j'), 10);
    var act = state.active;
    switch (a) {
      case 'tab': ui.tab = el.getAttribute('data-t'); closeModal(); render(); window.scrollTo(0, 0); break;
      case 'close': closeModal(); break;
      case 'cal-prev': case 'cal-next': { var c = calState(); var d = new Date(c.y, c.m + (a === 'cal-next' ? 1 : -1), 1); ui.cal = { y: d.getFullYear(), m: d.getMonth() }; render(); break; }
      case 'day': openModal({ type: 'day', day: el.getAttribute('data-d') }); break;
      case 'act': { toggleAct(el.getAttribute('data-d'), el.getAttribute('data-type')); if (ui.modal && ui.modal.type === 'day') renderModal(); render(); break; }
      case 'an-apply': {
        var sx = sessById(el.getAttribute('data-sid')), it = sx && sx.analysis && sx.analysis.items[parseInt(el.getAttribute('data-k'), 10)];
        var exa = it && exById(it.exId);
        if (exa && !it.applied) { exa.sets = Math.max(1, Math.min(6, (exa.sets || 1) + it.delta)); it.applied = true; save(); renderModal(); toast(exa.name + ': ' + exa.sets + ' series'); }
        break;
      }
      case 't-m': if (timer) { timer.end -= 15000; timer.total = Math.max(1, timer.total - 15); save(); updateTimer(); } break;
      case 't-p': if (timer) { timer.end += 15000; timer.total += 15; timer.fired = false; save(); updateTimer(); } break;
      case 't-x': timer = null; save(); updateTimer(); break;
      case 'mute': state.settings.sound = !soundOn(); save(); syncMute(); if (soundOn()) play('tick'); toast(soundOn() ? 'Sonido activado' : 'Sonido silenciado'); break;
      case 'confirm-yes': var fn = ui.modal.fn; if (fn) fn(); break;
      case 'start': startWorkout(el.getAttribute('data-k')); break;
      case 'toggle': act.open = act.open === i ? -1 : i; save(); render(); break;
      case 'done': {
        var e = act.entries[i], s = e.sets[j];
        if (s.done) { s.done = false; s.pr = false; save(); render(); break; }
        var w = num(s.w), r = num(s.r), exr = exById(e.exId);
        var wOk = !isNaN(w) || (exr && exr.equip === 'corporal');
        if (!(r > 0) || !wOk) { var row = $('[data-row="' + i + '-' + j + '"]'); if (row) { row.classList.remove('err'); void row.offsetWidth; row.classList.add('err'); } toast('Anota peso y repeticiones'); break; }
        s.done = true; s.w = isNaN(w) ? 0 : w; s.r = r;
        play('tick');
        checkPR(e, j);
        startTimer(exr || { fatigue: e.fatigue });
        if (e.sets.every(function (x) { return x.done; }) && i + 1 < act.entries.length) act.open = i + 1;
        save(); render(); break;
      }
      case 'add-set': { var e1 = act.entries[i]; var lastS = e1.sets[e1.sets.length - 1]; e1.sets.push({ w: lastS ? lastS.w : '', r: '', done: false }); save(); render(); break; }
      case 'del-set': { var e2 = act.entries[i]; if (e2.sets.length > 1 && !e2.sets[e2.sets.length - 1].done) { e2.sets.pop(); save(); render(); } else toast('No se puede quitar esa serie'); break; }
      case 'swap': openModal({ type: 'pick', ctx: 'swap', i: i, fm: act.entries[i].muscle, fe: '', q: '' }); break;
      case 'add-ex': openModal({ type: 'pick', ctx: 'add' }); break;
      case 'rm-ex': ask('Quitar ejercicio', 'Se quita de esta sesión (no se borra de tu lista).', 'Quitar', function () { act.entries.splice(i, 1); act.open = Math.min(act.open, act.entries.length - 1); save(); closeModal(); render(); }, true); break;
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
      case 'discard': ask('Descartar entreno', 'Se pierde lo anotado en esta sesión.', 'Descartar', function () { state.active = null; timer = null; unwake(); save(); closeModal(); render(); }, true); break;
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
      case 'hist': ui.histOpen = ui.histOpen === el.getAttribute('data-id') ? null : el.getAttribute('data-id'); render(); break;
      case 'del-sess': { var sid = el.getAttribute('data-id'); ask('Borrar sesión', 'Se elimina del historial y de los cálculos.', 'Borrar', function () { state.sessions = state.sessions.filter(function (x) { return x.id !== sid; }); ui.histOpen = null; save(); closeModal(); render(); }, true); break; }
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
      case 'reset': ask('Restaurar datos iniciales', 'Se borran tu historial y los cambios hechos a ejercicios y rutinas.', 'Restaurar', function () { state = fresh(); timer = null; unwake(); save(); closeModal(); ui.tab = 'hoy'; render(); toast('Datos iniciales restaurados'); }, true); break;
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target, f = t.getAttribute && t.getAttribute('data-f'); if (!f) return;
    if (f === 'w' || f === 'r') {
      var s = state.active.entries[+t.getAttribute('data-i')].sets[+t.getAttribute('data-j')];
      s[f] = t.value; if (s.done) { s.done = false; var row = t.closest('.set'); if (row) row.classList.remove('done'); }
      save();
    } else if (f === 'q') { ui.query = t.value; $('#ex-list').innerHTML = exListHtml(); }
    else if (f === 'pq') { ui.modal.q = t.value; $('#pick-list').innerHTML = pickList(); }
    else if (f === 'rname' && ui.modal && state.routines[ui.modal.key]) { state.routines[ui.modal.key].name = t.value.trim() || 'Rutina'; save(); render(); }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-f') === 'sound') { state.settings.sound = t.checked; save(); syncMute(); }
    else if (t.getAttribute && t.getAttribute('data-f') === 'actFatigue') { state.settings.actFatigue = t.checked; save(); }
    else if (t.id === 'file' && t.files && t.files[0]) { var rd = new FileReader(); rd.onload = function () { importText(String(rd.result)); }; rd.readAsText(t.files[0]); t.value = ''; }
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
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  }
  window.__gym = { get state() { return state; }, E: E, sounds: sounds }; // útil para pruebas
})();
