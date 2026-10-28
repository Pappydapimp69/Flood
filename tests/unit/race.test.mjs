import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIsland } from '../../src/shared/terrain.js';
import { createWorld, rollIsland, addRiver, step, standings, isRacing, spawnPoint, surfaceAt, TUNE, TICK_HZ } from '../../src/shared/river.js';
import { createBot, botSteer } from '../../src/shared/bot.js';

const islands = new Map([1, 2, 42].map((s) => [s, generateIsland(s)]));
// Islands whose summit ring seats a full race, as the game rolls them.
const rolled = (seed) => rollIsland(seed, 12).world.terrain;
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
  const s = w.events.filter((e) => e.type === 'siphon' && e.how === 'head');
  assert.equal(s.length, 1);
  assert.equal(s[0].from, b.idx);
  const lead = (a.depth - b.depth) / b.depth;
  assert.ok(lead > 0.3, `lead ${lead}`);
  const want = b0 * TUNE.siphonRate * Math.min(1, lead);
  assert.ok(Math.abs(s[0].amount - want) < want * 0.2, `took ${s[0].amount}, expected about ${want}`);
  // Hold the contact: b drains to the floor and is out, credited to a.
  for (let k = 0; k < 400 && !b.out; k++) { park(); step(w, new Map()); }
  assert.equal(b.out?.by, 'a');
  assert.ok(b.volume < TUNE.floor * TUNE.startVolume);
  // Every litre b lost to siphoning arrived at a (lakes and travel add on top).
  const moved = w.events.filter((e) => e.type === 'siphon' && e.how === 'head');
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
  const w = createWorld(rolled(42));
  for (const id of ids) addRiver(w, id);
  const ps = w.rivers.map((r) => r.path[0]);
  let close = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < TUNE.spawnGap) close++;
  }
  assert.ok(close <= 2, `${close} spawn pairs closer than ${TUNE.spawnGap} m`);
});

test('standings are complete and ordered: finishers, then racers, then the drained', () => {
  for (const seed of islands.keys()) {
    const w = race(seed);
    const st = standings(w);
    assert.equal(st.length, 12);
    assert.ok(st[0].finished, `seed ${seed}: nobody reached the sea`);
    const kinds = st.map((r) => (r.finished ? 0 : r.out ? 2 : 1));
    assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b), `seed ${seed}: ${kinds}`);
  }
});

// Doing nothing should not win: water flows downhill on its own, but steering
// well (as the bots do) should place clearly better on average.
test('bots place better than rivers that never steer', () => {
  // Races as the game runs them: rerolled islands, everyone dropping in.
  let bot = 0, botN = 0, passive = 0, passiveN = 0;
  for (const seed of [11, 222, 3333, 44444]) {
    const { world: w } = rollIsland(seed, ids.length);
    const bots = new Map();
    for (const id of ids) {
      const r = addRiver(w, id, undefined, { drop: true });
      if (!PASSIVE.has(id)) bots.set(id, createBot(w, r));
    }
    for (let k = 0; k < TICK_HZ * 330 && w.rivers.some(isRacing); k++) step(w, new Map([...bots].map(([id, b]) => [id, botSteer(w, b)])));
    standings(w).forEach((r, i) => {
      if (PASSIVE.has(r.id)) { passive += i; passiveN++; } else { bot += i; botN++; }
    });
  }
  assert.ok(bot / botN < passive / passiveN - 1, `bots avg place ${(bot / botN).toFixed(2)} vs passive ${(passive / passiveN).toFixed(2)}`);
});

test('drop: 30 s of fall, steerable anywhere, touchdown on the start contour with grace from then', async () => {
  const { dropZone, landingCell } = await import('../../src/shared/river.js');
  const w = createWorld(rolled(2));
  for (const id of ['a', 'b', 'c']) addRiver(w, id, undefined, { drop: true });
  const zone = dropZone(w);
  const start = w.rivers.map((r) => ({ x: r.x, z: r.z }));
  for (let k = 0; k < TUNE.dropTicks; k++) {
    step(w, new Map([['a', { s: k < 16 ? -1 : 0, f: 1 }], ['b', { s: 1, f: -1 }]]));
    for (const r of w.rivers) assert.equal(r.path.length > 0, r.dropping === 0, 'a channel before landing');
  }
  assert.equal(TUNE.dropTicks, 600);
  const n = w.terrain.size;
  for (const r of w.rivers) {
    assert.equal(r.dropping, 0);
    assert.equal(r.born, TUNE.dropTicks - 1, 'grace should count from touchdown');
    const k = Math.round((r.z / w.terrain.worldSize + 0.5) * (n - 1)) * n + Math.round((r.x / w.terrain.worldSize + 0.5) * (n - 1));
    assert.ok(zone.has(k), `${r.id} landed off the start contour`);
  }
  // Steering moved the landing: the same drop with no input lands elsewhere.
  const w0 = createWorld(w.terrain);
  for (const id of ['a', 'b', 'c']) addRiver(w0, id, undefined, { drop: true });
  for (let k = 0; k < TUNE.dropTicks; k++) step(w0, new Map());
  assert.ok(Math.hypot(w.rivers[0].x - w0.rivers[0].x, w.rivers[0].z - w0.rivers[0].z) > 500, `steering moved the landing only ${Math.hypot(w.rivers[0].x - w0.rivers[0].x, w.rivers[0].z - w0.rivers[0].z) | 0} m`);
  assert.equal(landingCell(w, w.rivers[2].x, w.rivers[2].z) >= 0, true);
  assert.equal(w.events.filter((e) => e.type === 'land').length, 3);
});

test('drop: every drop stays over the landing ring and touches down where it is', async () => {
  const { landingCell, spawnBand } = await import('../../src/shared/river.js');
  const { createBot, botSteer } = await import('../../src/shared/bot.js');
  const w = createWorld(islands.get(1));
  for (let i = 0; i < 12; i++) addRiver(w, `b${String(i).padStart(2, '0')}`, undefined, { drop: true });
  const bots = w.rivers.map((r) => createBot(w, r));
  const n = w.terrain.size, W = w.terrain.worldSize;
  const ring = new Set(spawnBand(w).ring);
  const offRing = (r) => { const c = landingCell(w, r.x, r.z, ring); return Math.hypot(r.x - ((c % n) / (n - 1) - 0.5) * W, r.z - (Math.floor(c / n) / (n - 1) - 0.5) * W); };
  let worst = 0;
  for (let k = 0; k < TUNE.dropTicks; k++) {
    const before = w.rivers.map((r) => ({ x: r.x, z: r.z, dropping: r.dropping }));
    step(w, new Map(bots.map((b, i) => [b.river.id, i % 3 ? botSteer(w, b) : { s: 1, f: 1 }])));
    w.rivers.forEach((r, i) => {
      if (!before[i].dropping) return;
      if (r.dropping) assert.ok(offRing(r) <= TUNE.zoneSlack + w.terrain.cell, `${r.id} strayed ${offRing(r)} m off the ring`);
      else worst = Math.max(worst, Math.hypot(r.x - before[i].x, r.z - before[i].z));
    });
  }
  assert.ok(w.rivers.every((r) => !r.dropping));
  assert.ok(worst <= TUNE.glideSpeed, `touchdown jumped ${worst.toFixed(0)} m`);
});
