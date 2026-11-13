const assert = require('assert');
const E = require('../src/engine.js');

const ex = { id: 'jalon', step: 5, repMin: 8, repMax: 12, fatigue: 2, sets: 3, equip: 'maquina', muscle: 'Dorsales' };
const T0 = 1000;

// 1) Repetir peso y subir 1 repetición si no llegas al tope
let t = E.nextTarget(ex, 105, 11);
assert.deepStrictEqual([t.w, t.r, t.kind], [105, 12, 'repite']);

// 2) Al llegar al tope sube un salto y estima repeticiones (no vuelve a 8 a ciegas)
t = E.nextTarget(ex, 105, 12);
assert.strictEqual(t.w, 110);
assert.ok(t.r >= 8 && t.r <= 12, 'reps dentro de rango: ' + t.r);
assert.strictEqual(t.r, 10); // Epley: 147 de 1RM -> ~10 a 110 kg

// 3) Si te sobran muchas repeticiones, salto doble
t = E.nextTarget(ex, 85, 15);
assert.strictEqual(t.w, 95);

// 4) Por debajo de rango: mismo peso, +1 rep, marcado
t = E.nextTarget(ex, 105, 7);
assert.deepStrictEqual([t.w, t.r, t.kind], [105, 8, 'bajo']);

// 5) Pesos de pila en libras (86,2 kg) suben sumando el salto
const remo = { id: 'remo', step: 4.5, repMin: 8, repMax: 12 };
t = E.nextTarget(remo, 86.2, 12);
assert.strictEqual(t.w, 90.7);

// 6) Plan por series con serie pesada + bajadas
const ref = { t: T0, sets: [{ w: 105, r: 11 }, { w: 85, r: 11 }, { w: 85, r: 8 }] };
let plan = E.planSets(ex, ref);
assert.deepStrictEqual(plan.map(p => [p.w, p.r]), [[105, 12], [85, 12], [85, 9]]);

// 7) Una bajada nunca supera el peso de la primera serie
plan = E.planSets(ex, { t: T0, sets: [{ w: 100, r: 10 }, { w: 100, r: 12 }] });
assert.ok(plan[1].w <= plan[0].w);

// 8) Series que faltan respecto a la plantilla se rellenan con la última
const ex2 = Object.assign({}, ex, { sets: 3 });
plan = E.planSets(ex2, { t: T0, sets: [{ w: 20, r: 12 }] });
assert.strictEqual(plan.length, 3);

// 9) Referencia: la sesión más reciente gana a la base inicial
const sess = [{ t: 2000, exercises: [{ exId: 'jalon', sets: [{ w: 110, r: 9 }] }] }];
let r = E.reference(Object.assign({}, ex, { baseline: { t: 1000, sets: [{ w: 105, r: 11 }] } }), sess);
assert.strictEqual(r.sets[0].w, 110);
// ...pero un ajuste aplicado después manda
r = E.reference(Object.assign({}, ex, { baseline: { t: 3000, sets: [{ w: 100, r: 11 }] } }), sess);
assert.strictEqual(r.sets[0].w, 100);

// 10) Estancamiento
const mk = (t, w, r) => ({ t, sets: [{ w, r }] });
let h = [mk(1, 100, 10), mk(2, 100, 10), mk(3, 100, 10), mk(4, 100, 10)];
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 1 }), h).stalled, true);   // N=3
h = [mk(1, 100, 10), mk(2, 100, 10), mk(3, 100, 10), mk(4, 100, 12)];
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 1 }), h).stalled, false);
h = [mk(1, 100, 10), mk(2, 100, 10), mk(3, 100, 10)];
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 3 }), h).stalled, true);    // N=2
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 1 }), h).stalled, false);   // faltan datos
// ignorado / tras ajuste: se cuenta de nuevo
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 3, stallResetT: 3 }), h).stalled, false);

// 11) Ajuste a la baja
const d = E.deloadBaseline(ex, { sets: [{ w: 105, r: 12 }, { w: 85, r: 11 }] }, 5000);
assert.strictEqual(d.sets[0].w, 95); // 94.5 -> rejilla de 5 -> 95
assert.strictEqual(d.sets[1].w, 75); // 76.5 -> 75
assert.ok(d.sets[0].r <= 11);

// 12) Calentamientos
assert.deepStrictEqual(E.warmups(ex, 105, false), []);
const w1 = E.warmups(ex, 105, true);
assert.ok(w1.length >= 1 && w1.every(x => x.w < 105));
assert.strictEqual(E.warmups(Object.assign({}, ex, { fatigue: 3 }), 100, true).length, 2);

// 13) Récords
assert.strictEqual(E.isPR(E.e1rm(100, 10), 100, 11), true);
assert.strictEqual(E.isPR(E.e1rm(100, 10), 100, 10), false);
assert.strictEqual(E.isPR(0, 100, 10), false); // sin referencia no hay PR

// 14) Fatiga y descanso
const now = 10 * 86400000;
const fs = E.fatigueSummary([
  { t: now - 20 * 3600000, exercises: [{ muscle: 'Pecho', sec: ['Tríceps'], fatigue: 3, sets: [{}, {}, {}] }] },
  { t: now - 5 * 86400000, exercises: [{ muscle: 'Dorsales', sec: [], fatigue: 2, sets: [{}, {}] }] }
], now);
const pecho = fs.find(x => x.muscle === 'Pecho');
assert.strictEqual(pecho.status, 'descanso');
assert.strictEqual(pecho.need, 72);
assert.strictEqual(fs.find(x => x.muscle === 'Dorsales').status, 'ok');

// tras reset hacen falta N+1 sesiones nuevas
let h2 = [mk(1, 100, 10), mk(2, 100, 10), mk(3, 100, 10), mk(4, 90, 10), mk(5, 90, 10)];
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 3, stallResetT: 3 }), h2).stalled, false); // solo 2 entradas nuevas
h2.push(mk(6, 90, 10));
assert.strictEqual(E.stallInfo(Object.assign({}, ex, { fatigue: 3, stallResetT: 3 }), h2).stalled, true);  // 3 entradas: N+1

// 15) Fútbol: fatiga ligera en piernas, descanso 36 h; correr 24 h
const acts = E.activitiesAsSessions([{ type: 'futbol', t: now - 20 * 3600000 }, { type: 'correr', t: now - 30 * 3600000 }]);
const fs2 = E.fatigueSummary(acts, now);
assert.strictEqual(fs2.find(x => x.muscle === 'Isquios').status, 'descanso');
assert.ok(Math.abs(fs2.find(x => x.muscle === 'Isquios').left - 16) < 0.01);
// un evento antiguo pesado sigue mandando aunque haya uno ligero más reciente
const mix = E.fatigueSummary([
  { t: now - 30 * 3600000, exercises: [{ muscle: 'Glúteos', sec: [], fatigue: 3, sets: [{}, {}] }] },
  { t: now - 5 * 3600000, exercises: [{ muscle: 'Glúteos', sec: [], fatigue: 1, restH: 24, sets: [{}] }] }
], now);
assert.ok(Math.abs(mix[0].left - 42) < 0.01);

// 16) Nº de series: lo marca el ejercicio
assert.strictEqual(E.planSets(Object.assign({}, ex, { sets: 2 }), ref).length, 2);

// 17) Análisis post-entreno
const D = 86400000, base = 100 * D;
const exA = { id: 'a', name: 'A', muscle: 'Pecho', sec: [], sets: 3, fatigue: 2, repMin: 8, repMax: 12, step: 5 };
const mkS = (id, t, w, r, extra) => Object.assign({ id, t, exercises: [{ exId: 'a', name: 'A', muscle: 'Pecho', sec: [], fatigue: 2, sets: [{ w, r }, { w, r }, { w, r }] }] }, extra || {});
let ss = [mkS('s1', base, 100, 10)];
let an = E.analyzeSession(ss[0], { a: exA }, ss);
assert.strictEqual(an.items[0].kind, 'info'); assert.strictEqual(an.volOn, false);
ss.push(mkS('s2', base + 3 * D, 100, 11));
an = E.analyzeSession(ss[1], { a: exA }, ss);
assert.strictEqual(an.items[0].kind, 'keep'); assert.strictEqual(an.counts.up, 1);
ss.push(mkS('s3', base + 6 * D, 100, 9));
an = E.analyzeSession(ss[2], { a: exA }, ss);
assert.strictEqual(an.items[0].kind, 'warn');
ss.push(mkS('s4', base + 9 * D, 100, 8));
an = E.analyzeSession(ss[3], { a: exA }, ss);
assert.strictEqual(an.items[0].kind, 'remove'); assert.strictEqual(an.items[0].delta, -1);
// volumen bajo con una semana de datos: propone añadir
ss = [mkS('v1', base, 100, 10), mkS('v2', base + 7 * D, 100, 10)];
an = E.analyzeSession(ss[1], { a: exA }, ss);
assert.strictEqual(an.volOn, true);
assert.strictEqual(an.items[0].kind, 'add');
assert.strictEqual(an.muscles[0].status, 'bajo');
// caída fuerte entre series con el mismo peso
const sd = { id: 'd', t: base, exercises: [{ exId: 'a', name: 'A', muscle: 'Pecho', sets: [{ w: 100, r: 12 }, { w: 100, r: 6 }] }] };
assert.ok(E.analyzeSession(sd, { a: exA }, [sd]).items[0].note.length > 0);
// las actividades no cuentan como series
assert.strictEqual(E.weeklyVolume(acts.map(a => Object.assign({}, a, { t: now - 1000 })), now)['Isquios'], undefined);

// 18) Peso corporal sin lastre: suma repeticiones, no peso
const dom = { id: 'dom', equip: 'corporal', step: 1, repMin: 5, repMax: 12 };
t = E.nextTarget(dom, 0, 12); assert.deepStrictEqual([t.w, t.r], [0, 13]);
t = E.nextTarget(dom, 10, 12); assert.strictEqual(t.w, 11); // con lastre sí sube peso
const sb1 = { id: 'b1', t: base, exercises: [{ exId: 'dom', name: 'Dominadas', muscle: 'Dorsales', sets: [{ w: 0, r: 8 }] }] };
const sb2 = { id: 'b2', t: base + 3 * D, exercises: [{ exId: 'dom', name: 'Dominadas', muscle: 'Dorsales', sets: [{ w: 0, r: 10 }] }] };
an = E.analyzeSession(sb2, { dom: Object.assign({ sets: 1 }, dom) }, [sb1, sb2]);
assert.strictEqual(an.items[0].kind, 'keep'); assert.ok(an.items[0].change > 20);

console.log('Motor OK: todas las pruebas pasan');
