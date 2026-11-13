/* Datos iniciales: tus rutinas y la última sesión de cada ejercicio (capturas de Symmetry, 11/11/2026). */
(function (root) {
  'use strict';
  var LB = 0.45359237;
  var T = Date.now();

  function ex(id, name, equip, muscle, sec, o) {
    var stepByEquip = { maquina: 5, polea: 2.5, mancuerna: 2, barra: 2.5, corporal: 1 };
    o = o || {};
    var step = o.step || stepByEquip[equip] || 2.5;
    return {
      id: id, name: name, equip: equip, muscle: muscle, sec: sec || [],
      step: step, stepUnit: o.stepUnit || 'kg', repMin: 8, repMax: 12,
      fatigue: o.fatigue || 2, sets: o.sets || 3, rest: o.rest || 0,
      baseline: { t: T, sets: o.base.map(function (b) { return { w: b[0], r: b[1] }; }) }
    };
  }
  var lb10 = Math.round(10 * LB * 100) / 100; // 10 lb en kg (supuesto para pilas en libras)

  var exercises = [
    // PULL
    ex('jalon', 'Jalón al pecho (máquina)', 'maquina', 'Dorsales', ['Bíceps'], { fatigue: 2, base: [[105, 11], [85, 11], [85, 8]] }),
    ex('remo', 'Remo con agarre neutro (máquina)', 'maquina', 'Espalda', ['Bíceps'], { fatigue: 2, step: lb10, stepUnit: 'lb', base: [[104.3, 6], [86.2, 10], [86.2, 9]] }),
    ex('curl-pred', 'Curl predicador (máquina)', 'maquina', 'Bíceps', [], { fatigue: 1, step: lb10, stepUnit: 'lb', base: [[83.5, 5], [69.5, 7], [62.5, 8]] }),
    ex('martillo', 'Martillo unilateral en polea', 'polea', 'Bíceps', ['Antebrazos'], { fatigue: 1, sets: 2, base: [[13.8, 11], [13.8, 10]] }),
    ex('pullover', 'Pullover con barra recta en polea alta', 'polea', 'Dorsales', [], { fatigue: 1, sets: 2, base: [[60, 12], [60, 11]] }),
    ex('aper-inv', 'Aperturas inversas en polea alta', 'polea', 'Hombros', [], { fatigue: 1, sets: 2, base: [[20, 12]] }),
    ex('crunch', 'Crunch abdominal sentado (máquina)', 'maquina', 'Abdominales', [], { fatigue: 1, sets: 2, base: [[55, 12]] }),
    // PUSH
    ex('press-inc', 'Press de pecho inclinado (máquina)', 'maquina', 'Pecho', ['Hombros', 'Tríceps'], { fatigue: 3, base: [[105, 7], [85, 10], [85, 10]] }),
    ex('press-cable', 'Press de pecho sentado (cable)', 'polea', 'Pecho', ['Tríceps'], { fatigue: 2, base: [[41, 12], [41, 10], [41, 9]] }),
    ex('elev-lat', 'Elevaciones laterales sentado con respaldo', 'mancuerna', 'Hombros', [], { fatigue: 1, sets: 4, base: [[24, 11], [24, 9], [20, 13], [20, 12]] }),
    ex('delt-ant', 'Aperturas deltoide anterior en polea baja', 'polea', 'Hombros', [], { fatigue: 1, sets: 2, base: [[25, 11], [25, 8]] }),
    ex('tri-v', 'Extensión de tríceps con agarre V (cable)', 'polea', 'Tríceps', [], { fatigue: 1, sets: 2, step: lb10, stepUnit: 'lb', base: [[43.8, 9], [36.3, 12]] }),
    ex('fondos', 'Fondos sentado (máquina)', 'maquina', 'Tríceps', ['Pecho', 'Hombros'], { fatigue: 2, sets: 2, base: [[115, 12], [115, 8]] }),
    // PIERNAS
    ex('hip-thrust', 'Hip thrust (máquina)', 'maquina', 'Glúteos', ['Isquios'], { fatigue: 3, sets: 2, base: [[60, 10], [60, 10]] }),
    ex('curl-fem', 'Curl femoral tumbado (máquina)', 'maquina', 'Isquios', [], { fatigue: 2, sets: 2, base: [[67, 8], [67, 8]] }),
    ex('ext-rod', 'Extensión de rodilla (máquina)', 'maquina', 'Cuádriceps', [], { fatigue: 2, sets: 3, base: [[105, 7], [95, 8], [95, 8]] }),
    ex('talones', 'Elevación de talones de pie (máquina)', 'maquina', 'Gemelos', [], { fatigue: 1, sets: 2, base: [[135, 12], [135, 11]] })
  ];

  root.SEED = {
    exercises: exercises,
    routines: {
      push: { name: 'Push', ids: ['press-inc', 'press-cable', 'elev-lat', 'delt-ant', 'tri-v', 'fondos'] },
      pull: { name: 'Pull', ids: ['jalon', 'remo', 'curl-pred', 'martillo', 'pullover', 'aper-inv', 'crunch'] },
      legs: { name: 'Piernas', ids: ['hip-thrust', 'curl-fem', 'ext-rod', 'talones'] }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
