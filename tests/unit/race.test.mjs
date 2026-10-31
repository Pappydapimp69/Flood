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
  const park = () => Object.assign(b, { x: a.x, z: a.z, dx: a.dx, dz: a.dz, speed: a.speed, mass: a.mass, low: a.low, guided: a.guided, stall: a.stall, filling: a.filling });
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
  // The head siphon, netted with any junction flow between the pair (head
  // depth against the other's channel as cut there) to one transfer.
  const want = b0 * TUNE.siphonRate * Math.min(1, lead);
  assert.ok(s[0].amount > 0 && s[0].amount <= want * 1.05, `took ${s[0].amount}, at most ${want}`);
  // Hold the contact: b drains to the floor and is out, credited to a.
  for (let k = 0; k < 400 && !b.out; k++) { park(); step(w, new Map()); }
  assert.equal(b.out?.by, 'a');
  assert.ok(b.volume < TUNE.floor * TUNE.startVolume);
  // Every litre b lost to siphoning arrived at a (lakes and travel add on top).
  // and between the pair, water only ever moved one way in a tick.
  const moved = w.events.filter((e) => e.type === 'siphon');
  const ticks = new Map();
  for (const e of moved) { const k = `${e.tick}`; ticks.set(k, (ticks.get(k) ?? new Set()).add(e.from)); }
  assert.ok([...ticks.values()].every((f) => f.size === 1), 'water flowed both ways in one tick');
  assert.ok(moved.filter((e) => e.to === a.idx).length > moved.length / 2, 'most of the water did not go to the deeper river');
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
// Bot skill, measured cleanly: each river alone on the map from the same
// start, bot-steered or never steered, so other rivers' fights and where the
// drops land can't decide it (in a full race those swamp a 12-river average).
test('bots reach the sea faster than rivers that never steer, from the same start', async () => {
  const { spawnBand } = await import('../../src/shared/river.js');
  let wins = 0, runs = 0, botT = 0, passiveT = 0;
  for (const seed of [11, 222, 3333]) {
    const { world: base } = rollIsland(seed, ids.length);
    const cells = spawnBand(base).cells, N = base.terrain.size, W = base.terrain.worldSize;
    for (let s = 0; s < 4; s++) {
      const c = cells[Math.floor(((s + 0.5) * cells.length) / 4)];
      const at = { x: ((c % N) / (N - 1) - 0.5) * W, z: (Math.floor(c / N) / (N - 1) - 0.5) * W };
      const time = (steered) => {
        const w = createWorld(base.terrain), r = addRiver(w, 'a', at), b = createBot(w, r, 0.9);
        for (let k = 0; k < TICK_HZ * 400 && !r.finished; k++) step(w, new Map([['a', steered ? botSteer(w, b) : 0]]));
        return r.finished ? r.finishTick / TICK_HZ : 400;
      };
      const tb = time(true), tp = time(false);
      runs++; botT += tb; passiveT += tp;
      if (tb < tp) wins++;
    }
  }
  assert.ok(wins >= runs * 0.65 && botT < passiveT, `bots faster in ${wins}/${runs}, mean ${(botT / runs) | 0} s vs ${(passiveT / runs) | 0} s`);
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
