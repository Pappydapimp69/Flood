import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, standings, isRacing, spawnPoint, TUNE, TICK_HZ } from '../../src/shared/river.js';
import { createBot, botSteer } from '../../src/shared/bot.js';

const islands = new Map([1, 2, 42].map((s) => [s, generateIsland(s)]));
const ids = Array.from({ length: 12 }, (_, i) => `r${String(i).padStart(2, '0')}`);
const PASSIVE = new Set(['r00', 'r03', 'r06', 'r09']); // never steer

function race(seed, order = ids, spawns) {
  const w = createWorld(islands.get(seed));
  const bots = new Map();
  for (const id of order) {
    const r = addRiver(w, id, spawns?.get(id));
    if (!PASSIVE.has(id)) bots.set(id, createBot(w, r));
  }
  for (let k = 0; k < TICK_HZ * 600 && w.rivers.some(isRacing); k++) {
    const inp = new Map();
    for (const [id, b] of bots) inp.set(id, botSteer(w, b));
    step(w, inp);
  }
  return w;
}

const summary = (w) => Object.fromEntries(w.rivers.map((r) => [r.id, {
  x: Math.round(r.x * 100), z: Math.round(r.z * 100), v: Math.round(r.volume), fin: r.finishTick, out: r.out?.tick ?? -1, by: r.out?.by ?? '',
}]));

test('a race is deterministic', () => {
  assert.deepEqual(summary(race(42)), summary(race(42)));
});

// Same spawns, rivers added in reverse: every river must end the same way.
test('outcome does not depend on the order rivers were added', () => {
  const first = race(2);
  const spawns = new Map(first.rivers.map((r) => [r.id, { x: r.path[0].x, z: r.path[0].z }]));
  assert.deepEqual(summary(race(2, [...ids].reverse(), spawns)), summary(race(2, ids, spawns)));
});

test('contact: the smaller river is absorbed and the bigger gains its water', () => {
  const w = createWorld(islands.get(1));
  const a = addRiver(w, 'big'), b = addRiver(w, 'small', { x: a.x + 30, z: a.z + 30 });
  a.volume = TUNE.startVolume * 3;
  for (let k = 0; k < TUNE.graceTicks - 1; k++) step(w, new Map());
  assert.ok(!a.out && !b.out, 'merged during the spawn grace');
  step(w, new Map()); // last grace tick
  // Put them head to head now that grace is over.
  b.x = a.x + 10; b.z = a.z;
  const before = a.volume + b.volume * TUNE.absorb;
  step(w, new Map());
  assert.equal(b.out?.by, 'big');
  assert.ok(!a.out);
  assert.ok(a.volume >= before - 1e-6);
  assert.equal(w.events.filter((e) => e.type === 'merge').length, 1);
});

test('spawns keep their distance', () => {
  const w = createWorld(islands.get(42));
  for (const id of ids) addRiver(w, id);
  const ps = w.rivers.map((r) => r.path[0]);
  let close = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < TUNE.spawnGap) close++;
  }
  assert.ok(close <= 2, `${close} spawn pairs closer than ${TUNE.spawnGap} m`);
});

test('races end, standings are complete and ordered', () => {
  for (const seed of islands.keys()) {
    const w = race(seed);
    const st = standings(w);
    assert.equal(st.length, 12);
    assert.ok(st[0].finished, `seed ${seed}: nobody reached the sea`);
    assert.ok(!w.rivers.some(isRacing), `seed ${seed}: race never ended`);
    const firstOut = st.findIndex((r) => r.out);
    if (firstOut >= 0) assert.ok(st.slice(firstOut).every((r) => r.out), 'finisher ranked below an absorbed river');
  }
});

// Comparative check, built against the baseline's best case: a river that never steers
// still reaches the sea on these maps. Bots should still place better on average.
test('bots place better than rivers that never steer', () => {
  let bot = 0, botN = 0, passive = 0, passiveN = 0;
  for (const seed of islands.keys()) {
    standings(race(seed)).forEach((r, i) => {
      if (PASSIVE.has(r.id)) { passive += i; passiveN++; } else { bot += i; botN++; }
    });
  }
  assert.ok(bot / botN < passive / passiveN, `bots avg place ${(bot / botN).toFixed(2)} vs passive ${(passive / passiveN).toFixed(2)}`);
});
