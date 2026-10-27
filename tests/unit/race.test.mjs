import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, addRiver, step, standings, isRacing, spawnPoint, surfaceAt, TUNE, TICK_HZ } from '../../src/shared/river.js';
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

// Two rivers after the spawn grace; depth comes from size and speed, so the
// tests set volume and copy state rather than poking depth directly.
function duel() {
  const w = createWorld(islands.get(1));
  const a = addRiver(w, 'a'), b = addRiver(w, 'b', { x: a.x + 3000, z: a.z });
  const grace = TUNE.graceTicks + TUNE.gracePerRiver * w.rivers.length;
  for (let k = 0; k < grace; k++) step(w, new Map());
  assert.ok(!w.events.some((e) => e.type === 'siphon'), 'water moved during the spawn grace');
  // Park b exactly on a: same place, heading and speed, so only volume differs.
  const park = () => Object.assign(b, { x: a.x, z: a.z, dx: a.dx, dz: a.dz, speed: a.speed, low: a.low, guided: a.guided, stall: a.stall, filling: a.filling });
  return { w, a, b, park };
}

test('contact: the deeper river siphons the shallower until it dries up', () => {
  const { w, a, b, park } = duel();
  a.volume = TUNE.startVolume * 16; // size 2: cuts twice as deep at the same speed
  a.size = 2;
  park();
  const b0 = b.volume;
  step(w, new Map());
  const s = w.events.filter((e) => e.type === 'siphon');
  assert.equal(s.length, 1);
  assert.equal(s[0].from, b.idx);
  const lead = (a.depth - b.depth) / b.depth;
  assert.ok(lead > 0.3, `lead ${lead}`);
  const want = b0 * TUNE.siphonRate * Math.min(1, lead);
  assert.ok(Math.abs(b0 - b.volume - want) < want * 0.2, `took ${b0 - b.volume}, expected about ${want}`);
  // Hold the contact: b drains to the floor and is out, credited to a.
  for (let k = 0; k < 400 && !b.out; k++) { park(); step(w, new Map()); }
  assert.equal(b.out?.by, 'a');
  assert.ok(b.volume < TUNE.floor * TUNE.startVolume);
  // Every litre b lost to siphoning arrived at a (lakes and travel add on top).
  const moved = w.events.filter((e) => e.type === 'siphon');
  assert.ok(moved.every((e) => e.from === b.idx && e.to === a.idx));
});

test('contact: equal depths move nothing', () => {
  const { w, a, b, park } = duel();
  // Fresh ground, away from both channels, so only the heads touch.
  const p = spawnPoint(w, 'fresh');
  Object.assign(a, { x: p.x, z: p.z, low: Infinity });
  park();
  b.volume = a.volume; b.size = a.size;
  step(w, new Map());
  assert.equal(a.depth, b.depth);
  assert.ok(!w.events.some((e) => e.type === 'siphon'));
  assert.ok(!a.out && !b.out);
});

test('cutting deeper across a tapper\'s channel steals its lake', () => {
  const w = createWorld(islands.get(42));
  const lake = w.lakes.reduce((a, b) => (b.cells > a.cells ? b : a));
  const n = w.terrain.size, k0 = w.lakeOf.indexOf(lake.id);
  const at = { x: ((k0 % n) / (n - 1) - 0.5) * w.terrain.worldSize, z: (Math.floor(k0 / n) / (n - 1) - 0.5) * w.terrain.worldSize };
  const tapper = addRiver(w, 'a', at);
  const cutter = addRiver(w, 'b', { x: at.x + 4000, z: at.z });
  const grace = TUNE.graceTicks + TUNE.gracePerRiver * w.rivers.length;
  for (let k = 0; k < grace + 60; k++) step(w, new Map());
  assert.equal(w.lakeTaken[lake.id], tapper.idx, 'tapper lost the lake early');
  // A channel cell the tapper dug after tapping, then a much deeper cutter on it.
  const t0 = w.lakeTapTick[lake.id];
  const k = w.owner.findIndex((o, i) => o === tapper.idx && w.dugAt[i] >= t0 && w.carve[i] > 2 && i !== k0);
  assert.ok(k >= 0, 'no channel dug after the tap');
  Object.assign(cutter, { x: ((k % n) / (n - 1) - 0.5) * w.terrain.worldSize, z: (Math.floor(k / n) / (n - 1) - 0.5) * w.terrain.worldSize, dx: 0, dz: 0, speed: 0 });
  cutter.volume = TUNE.startVolume * 81; cutter.size = 3;
  // At zero speed the cutter only creeps (under 1 m) in its first tick, so it stays on the cell.
  step(w, new Map());
  assert.equal(w.lakeTaken[lake.id], cutter.idx, 'deeper cutter did not take the lake');
  assert.ok(w.events.some((e) => e.type === 'tapcut' && e.how === 'cut' && e.to === cutter.idx));
});

test('a live rival channel costs water to cross but never traps', () => {
  const { w, a } = duel();
  // Live rival water is not felt as terrain; the same cells read as ground for its owner too.
  const k = w.owner.findIndex((o, i) => o === a.idx && w.carve[i] > 2);
  assert.ok(k >= 0);
  const n = w.terrain.size, t = w.terrain;
  const x = ((k % n) / (n - 1) - 0.5) * t.worldSize, z = (Math.floor(k / n) / (n - 1) - 0.5) * t.worldSize;
  const other = w.rivers.find((r) => r !== a).idx;
  assert.ok(Math.abs(surfaceAt(w, x, z, other) - t.filled[k]) < 1e-3, 'live rival channel dented the surface');
  assert.ok(surfaceAt(w, x, z) < t.filled[k] - 2, 'rendered surface should show the channel');
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

test('drop: fall for the drop time, glide only inside the fair zone, land with grace from touchdown', async () => {
  const { dropZone } = await import('../../src/shared/river.js');
  const w = createWorld(islands.get(2));
  const ids2 = ['a', 'b', 'c'];
  for (const id of ids2) addRiver(w, id, undefined, { drop: true });
  const zone = dropZone(w);
  const n = w.terrain.size;
  const cellOf = (r) => Math.round((r.z / w.terrain.worldSize + 0.5) * (n - 1)) * n + Math.round((r.x / w.terrain.worldSize + 0.5) * (n - 1));
  for (let k = 0; k < TUNE.dropTicks; k++) {
    step(w, new Map([['a', -1], ['b', 1]]));
    for (const r of w.rivers) {
      assert.equal(r.path.length > 0, r.dropping === 0, 'a channel before landing');
      if (r.dropping) assert.ok(zone.has(cellOf(r)), `${r.id} glided out of the zone`);
    }
  }
  for (const r of w.rivers) {
    assert.equal(r.dropping, 0);
    assert.equal(r.born, TUNE.dropTicks - 1, 'grace should count from touchdown');
  }
  assert.equal(w.events.filter((e) => e.type === 'land').length, 3);
});
