/* Motor de progresión — doble progresión por serie, entrenando al fallo.
   Sin dependencias del DOM: se puede probar con node. */
(function (root) {
  'use strict';

  var round1 = function (x) { return Math.round(x * 10) / 10; };
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };

  // Estimación de 1RM (Epley) y repeticiones esperadas con otro peso.
  function e1rm(w, r) { return w * (1 + r / 30); }
  function repsAt(oneRm, w) { return 30 * (oneRm / w - 1); }

  // ¿El peso está en la "rejilla" del salto? (los pesos de pila en libras no lo están)
  function onGrid(w, step) {
    var q = w / step;
    return Math.abs(q - Math.round(q)) < 0.05;
  }
  // Redondea w a la rejilla del salto si el peso de referencia está en ella; si no, a 0,5.
  function snap(w, step, refW) {
    if (onGrid(refW === undefined ? w : refW, step)) return round1(Math.round(w / step) * step);
    return round1(Math.round(w * 2) / 2);
  }

  /* Objetivo para una serie a partir de lo que hiciste en esa misma posición. */
  function nextTarget(ex, w, r) {
    var step = ex.step || 2.5;
    var min = ex.repMin || 8;
    var max = ex.repMax || 12;
    if (ex.equip === 'corporal' && !(w > 0)) return { w: 0, r: Math.min(r + 1, max + 8), kind: 'repite' }; // sin lastre: suma repeticiones
    if (r >= max) {
      var jumps = r >= max + 3 ? 2 : 1; // si te sobran muchas, salto doble
      var nw = round1(w + step * jumps);
      var est = Math.round(repsAt(e1rm(w, r), nw));
      return { w: nw, r: clamp(est, min, max), kind: 'sube' };
    }
    return { w: w, r: Math.min(r + 1, max), kind: r < min ? 'bajo' : 'repite' };
  }

  /* Referencia: lo último que hiciste con el ejercicio (sesión real o base inicial/ajuste). */
  function reference(ex, sessions) {
    var best = null;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      for (var j = 0; j < s.exercises.length; j++) {
        var e = s.exercises[j];
        if (e.exId === ex.id && e.sets.length) {
          if (!best || s.t > best.t) best = { t: s.t, sets: e.sets, source: 'session' };
        }
      }
    }
    if (ex.baseline && ex.baseline.sets && ex.baseline.sets.length) {
      if (!best || ex.baseline.t >= best.t) best = { t: ex.baseline.t, sets: ex.baseline.sets, source: 'baseline' };
    }
    return best;
  }

  /* Plan de series de trabajo para la próxima sesión. */
  function planSets(ex, ref) {
    if (!ref) {
      var n0 = ex.sets || 3;
      var arr = [];
      for (var k = 0; k < n0; k++) arr.push({ w: 0, r: ex.repMax || 12, kind: 'nuevo' });
      return arr;
    }
    var n = ex.sets || ref.sets.length; // el nº de series lo marca el ejercicio
    var out = [];
    for (var i = 0; i < n; i++) {
      var src = ref.sets[Math.min(i, ref.sets.length - 1)];
      out.push(nextTarget(ex, src.w, src.r));
    }
    // una serie de bajada nunca pasa del peso de la primera
    for (var m = 1; m < out.length; m++) {
      if (out[m].w > out[0].w) { out[m].w = out[0].w; }
    }
    return out;
  }

  /* Historial de un ejercicio: [{t, sets}] ascendente, incluyendo la base inicial. */
  function history(ex, sessions) {
    var h = [];
    if (ex.baseline && ex.baseline.sets && ex.baseline.sets.length) h.push({ t: ex.baseline.t, sets: ex.baseline.sets });
    sessions.forEach(function (s) {
      s.exercises.forEach(function (e) {
        if (e.exId === ex.id && e.sets.length) h.push({ t: s.t, sets: e.sets });
      });
    });
    h.sort(function (a, b) { return a.t - b.t; });
    return h;
  }

  function bestE1(sets) {
    var b = 0;
    sets.forEach(function (s) { if (s.w > 0 && s.r > 0) b = Math.max(b, e1rm(s.w, s.r)); });
    return b;
  }

  /* Estancamiento: las últimas N sesiones no mejoran un 1 % la mejor marca anterior. */
  function stallInfo(ex, hist) {
    var N = (ex.fatigue || 2) >= 3 ? 2 : 3;
    // tras ignorar el aviso o aplicar un ajuste, se empieza a contar de nuevo
    var reset = ex.stallResetT || 0;
    hist = hist.filter(function (h) { return h.t > reset; });
    if (hist.length < N + 1) return { stalled: false, n: N };
    var prev = hist.slice(0, hist.length - N);
    var last = hist.slice(hist.length - N);
    var prevBest = 0;
    prev.forEach(function (h) { prevBest = Math.max(prevBest, bestE1(h.sets)); });
    var improved = last.some(function (h) { return bestE1(h.sets) > prevBest * 1.01; });
    return { stalled: !improved && prevBest > 0, n: N, prevBest: round1(prevBest) };
  }

  /* Propuesta de ajuste: bajar ~10 % y volver a subir desde ahí. */
  function deloadBaseline(ex, ref, now) {
    var sets = ref.sets.map(function (s) {
      var w = snap(s.w * 0.9, ex.step || 2.5, s.w);
      if (w < (ex.step || 2.5)) w = s.w;
      return { w: w, r: clamp(s.r + 3, ex.repMin || 8, (ex.repMax || 12) - 1) };
    });
    return { t: now, sets: sets };
  }

  /* Calentamiento sugerido (no se marca ni cuenta). Solo para el primer ejercicio de cada músculo. */
  function warmups(ex, topW, firstOfMuscle) {
    var step = ex.step || 2.5;
    if (!firstOfMuscle || !(topW > step * 3)) return [];
    var plan = (ex.equip === 'barra' || (ex.fatigue || 2) >= 3) ? [[0.4, 8], [0.65, 4]] : [[0.5, 8]];
    var out = [];
    plan.forEach(function (p) {
      var w = snap(topW * p[0], step, topW);
      if (w > 0 && w < topW && (!out.length || w > out[out.length - 1].w)) out.push({ w: w, r: p[1] });
    });
    return out;
  }

  function restFor(ex) {
    if (ex.rest) return ex.rest;
    var f = ex.fatigue || 2;
    return f >= 3 ? 180 : f === 2 ? 120 : 90;
  }

  /* Récord: mejor 1RM estimado de una serie frente a todo lo anterior. */
  function isPR(prevBest, w, r) {
    if (!(w > 0 && r > 0 && r <= 15)) return false;
    return prevBest > 0 && e1rm(w, r) > prevBest * 1.005;
  }

  /* Fatiga y descanso por músculo. Cada evento marca descanso hasta t + horas necesarias. */
  var DAY = 86400000;
  function fatigueSummary(sessions, now) {
    var by = {};
    sessions.forEach(function (s) {
      s.exercises.forEach(function (e) {
        var f = e.fatigue || 2;
        var muscles = [[e.muscle, 1]].concat((e.sec || []).map(function (m) { return [m, 0.5]; }));
        muscles.forEach(function (mw) {
          var m = mw[0]; if (!m) return;
          var o = by[m] || (by[m] = { muscle: m, last: 0, until: 0, l7: 0, l28: 0 });
          var load = e.sets.length * f * mw[1];
          var age = now - s.t;
          if (age <= 7 * DAY) o.l7 += load;
          if (age <= 35 * DAY && age > 7 * DAY) o.l28 += load;
          var need = e.restH || (f >= 3 && mw[1] === 1 ? 72 : 48);
          o.last = Math.max(o.last, s.t);
          o.until = Math.max(o.until, s.t + need * 3600000);
        });
      });
    });
    return Object.keys(by).map(function (k) {
      var o = by[k];
      var hours = (now - o.last) / 3600000, left = (o.until - now) / 3600000;
      var avg = o.l28 / 4;
      var status = 'ok';
      if (left > 0) status = 'descanso';
      else if (avg > 0 && o.l7 > avg * 1.3) status = 'alta';
      return { muscle: o.muscle, hours: hours, left: left, need: Math.round((o.until - o.last) / 3600000), l7: round1(o.l7), avg: round1(avg), status: status };
    }).sort(function (a, b) { return a.hours - b.hours; });
  }

  /* Fútbol y correr (pachangas): cuentan poco en la fatiga de piernas. */
  var ACT = {
    futbol: { label: 'Fútbol', icon: '⚽', restH: 36, parts: [['Cuádriceps', 3], ['Isquios', 3], ['Gemelos', 3], ['Glúteos', 2]] },
    correr: { label: 'Correr', icon: '👟', restH: 24, parts: [['Cuádriceps', 2], ['Gemelos', 2], ['Isquios', 1]] }
  };
  function activitiesAsSessions(acts) {
    return (acts || []).filter(function (a) { return ACT[a.type]; }).map(function (a) {
      var d = ACT[a.type];
      return { t: a.t, activity: a.type, exercises: d.parts.map(function (p) {
        var sets = []; for (var i = 0; i < p[1]; i++) sets.push({});
        return { muscle: p[0], sec: [], fatigue: 1, restH: d.restH, sets: sets };
      }) };
    });
  }

  /* Análisis post-entreno por reglas. */
  var VOL_MIN = 10, VOL_MAX = 20;
  function fmtN(x) { return String(round1(x)).replace('.', ','); }
  function weeklyVolume(sessions, now) {
    var v = {};
    sessions.forEach(function (s) {
      if (s.activity || now - s.t > 7 * DAY || s.t > now) return;
      s.exercises.forEach(function (e) {
        var n = e.sets.length;
        if (e.muscle) v[e.muscle] = (v[e.muscle] || 0) + n;
        (e.sec || []).forEach(function (m) { v[m] = (v[m] || 0) + n * 0.5; });
      });
    });
    return v;
  }
  // con peso: 1RM estimado; sin peso (corporal): mejores repeticiones
  function score(sets) { var b = bestE1(sets); return b > 0 ? b : sets.reduce(function (a, s) { return Math.max(a, s.r || 0); }, 0); }
  function analyzeSession(sess, exMap, sessions) {
    var now = sess.t;
    var others = sessions.filter(function (s) { return s.id !== sess.id && !s.activity; });
    var all = others.concat([sess]);
    var first = all.reduce(function (a, s) { return Math.min(a, s.t); }, now);
    var volOn = now - first >= 6 * DAY;
    var vol = weeklyVolume(all, now);
    var suggested = {}, items = [], counts = { up: 0, same: 0, down: 0 };
    sess.exercises.forEach(function (e) {
      var ex = exMap[e.exId] || { id: e.exId, sets: e.sets.length, fatigue: e.fatigue };
      var hist = history(ex, others);
      var prev = hist.length ? hist[hist.length - 1] : null;
      var prev2 = hist.length > 1 ? hist[hist.length - 2] : null;
      var nowB = score(e.sets), sets = ex.sets || e.sets.length;
      var it = { exId: e.exId, name: e.name, muscle: e.muscle, change: 0, kind: 'keep', delta: 0, text: '', note: '' };
      var trend = 'new', prevDrop = false;
      if (prev && score(prev.sets) > 0 && nowB > 0) {
        var r = nowB / score(prev.sets);
        it.change = Math.round((r - 1) * 1000) / 10;
        trend = r > 1.005 ? 'up' : r < 0.98 ? 'down' : 'same';
        counts[trend]++;
        if (prev2 && score(prev2.sets) > 0) prevDrop = score(prev.sets) < score(prev2.sets) * 0.98;
      }
      var m = e.muscle, vm = round1(vol[m] || 0);
      var st = stallInfo(ex, history(ex, all));
      function set(kind, delta, text) { it.kind = kind; it.delta = delta; it.text = text; }
      if (trend === 'down' && prevDrop && sets > 1) set('remove', -1, 'Dos sesiones seguidas rindiendo menos: quita 1 serie para recuperar.');
      else if (trend === 'down') set('warn', 0, 'Hoy has rendido algo menos (' + fmtN(it.change) + ' %). Si se repite, te propondré quitar una serie.');
      else if (volOn && vm > VOL_MAX && !suggested[m] && sets > 1) { suggested[m] = 1; set('remove', -1, 'Ya haces ' + fmtN(vm) + ' series semanales de ' + m + ': quita 1 serie, más volumen no suele sumar.'); }
      else if (st.stalled && (!volOn || vm < 16) && sets < 6) set('add', 1, 'Llevas ' + st.n + ' sesiones sin mejorar y tienes margen de volumen: añade 1 serie.');
      else if (volOn && vm < VOL_MIN && !suggested[m] && sets < 6) { suggested[m] = 1; set('add', 1, 'Solo ' + fmtN(vm) + ' series semanales de ' + m + ': añade 1 serie aquí.'); }
      else if (trend === 'new') set('info', 0, 'Primera sesión registrada: la próxima ya podré compararla.');
      else if (trend === 'up') set('keep', 0, 'Mejoras un ' + fmtN(it.change) + ' %: mantén las series.');
      else set('keep', 0, 'Igual que la última vez: mantén las series y busca una repetición más.');
      var f0 = e.sets[0];
      if (f0 && e.sets.some(function (x, i) { return i > 0 && x.w === f0.w && x.r <= f0.r * 0.6; })) it.note = 'Mucha caída de repeticiones con el mismo peso: alarga el descanso entre series.';
      items.push(it);
    });
    var muscles = [], seen = {};
    sess.exercises.forEach(function (e) {
      if (!e.muscle || seen[e.muscle]) return; seen[e.muscle] = 1;
      var v = round1(vol[e.muscle] || 0);
      muscles.push({ muscle: e.muscle, sets: v, status: !volOn ? 'pendiente' : v < VOL_MIN ? 'bajo' : v > VOL_MAX ? 'alto' : 'ok' });
    });
    return { items: items, counts: counts, muscles: muscles, volOn: volOn };
  }

  var api = {
    e1rm: e1rm, repsAt: repsAt, nextTarget: nextTarget, reference: reference, planSets: planSets,
    history: history, stallInfo: stallInfo, deloadBaseline: deloadBaseline, warmups: warmups,
    restFor: restFor, isPR: isPR, fatigueSummary: fatigueSummary, ACT: ACT, activitiesAsSessions: activitiesAsSessions, analyzeSession: analyzeSession, weeklyVolume: weeklyVolume, bestE1: bestE1, snap: snap, round1: round1
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
