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

test('drop: a drop lands right where it crosses the start line: no jump, steering moves it, the line is fair', async () => {
  const { startLine, pastLine, cellIndex } = await import('../../src/shared/river.js');
  const w = createWorld(rolled(2));
  for (const id of ['a', 'b', 'c']) addRiver(w, id, undefined, { drop: true });
  const line = startLine(w), at = {}, jump = {};
  for (let k = 0; k < TUNE.dropTicks * 3 && w.rivers.some((r) => r.dropping); k++) {
    const before = w.rivers.map((r) => [r.x, r.z]);
    step(w, new Map([['a', { s: k < 40 ? -1 : 0, f: 1 }], ['b', { s: 0, f: -1 }]]));
    for (const e of w.events.splice(0)) if (e.type === 'land') {
      const r = w.rivers[e.river];
      at[r.id] = { x: r.x, z: r.z, born: r.born, tick: e.tick };
      jump[r.id] = Math.hypot(r.x - before[e.river][0], r.z - before[e.river][1]);
    }
  }
  for (const r of w.rivers) {
    assert.equal(r.dropping, 0, `${r.id} never landed`);
    assert.ok(jump[r.id] <= TUNE.glideSpeed * 1.8 / 20 + 1, `${r.id} jumped ${jump[r.id]} m at touchdown`);
    assert.ok(pastLine(w, at[r.id].x, at[r.id].z), `${r.id} landed short of the line`);
    assert.equal(at[r.id].born, at[r.id].tick, 'grace should count from touchdown');
    const reach = w.toBeach[cellIndex(w.terrain, at[r.id].x, at[r.id].z)];
    assert.ok(Math.abs(reach - line.L) <= line.L * 0.01, `${r.id} landed ${(reach - line.L) | 0} m off the line's distance`);
  }
  // Flying straight, every drop comes down in about the same time (they all start a glide's run back);
  // height is for clouds, so floating (b) doesn't land later than steady (c). Steering moves the landing.
  assert.ok(Math.abs(at.b.tick - at.c.tick) <= 20 * 4, `floating ${at.b.tick} vs steady ${at.c.tick}`);
  assert.ok(Math.hypot(at.a.x - at.c.x, at.a.z - at.c.z) > 1000, 'steering barely moved the landing');
});

test('drop: a rain cloud drains equally into every river inside, and shrinks', async () => {
  const { skyClouds } = await import('../../src/shared/river.js');
  const w = createWorld(rolled(2));
  const a = addRiver(w, 'a', undefined, { drop: true }), b = addRiver(w, 'b', undefined, { drop: true });
  const c = skyClouds(w)[0];
  for (const r of [a, b]) Object.assign(r, { x: c.x, z: c.z, alt: c.alt + 5 });
  const va = a.volume, vb = b.volume, water = c.water, r0 = c.radius, alt = c.alt;
  step(w, new Map());
  const ga = a.volume - va, gb = b.volume - vb;
  assert.ok(ga > 0 && Math.abs(ga - gb) < 1, `shares ${ga} and ${gb}`);
  assert.ok(Math.abs(water - c.water - ga - gb) < 1, 'the water did not add up');
  assert.ok(c.radius < r0 && c.alt >= alt, 'did not shrink (or sank)');
});

test('drop: with bots, every drop reaches the line within the course and nobody is dragged', async () => {
  const { createBot, botSteer } = await import('../../src/shared/bot.js');
  const { pastLine } = await import('../../src/shared/river.js');
  const w = createWorld(islands.get(1));
  for (let i = 0; i < 12; i++) addRiver(w, `b${String(i).padStart(2, '0')}`, undefined, { drop: true });
  const bots = w.rivers.map((r) => createBot(w, r));
  let worst = 0;
  for (let k = 0; k < TUNE.dropTicks * 3 && w.rivers.some((r) => r.dropping); k++) {
    const before = w.rivers.map((r) => ({ x: r.x, z: r.z, dropping: r.dropping }));
    step(w, new Map(bots.map((b, i) => [b.river.id, i % 3 ? botSteer(w, b) : { s: 1, f: 1 }])));
    w.rivers.forEach((r, i) => { if (before[i].dropping) worst = Math.max(worst, Math.hypot(r.x - before[i].x, r.z - before[i].z) - Math.hypot(r.kx ?? 0, r.kz ?? 0) / 20); });
  }
  assert.ok(w.rivers.every((r) => !r.dropping), 'someone never landed');
  assert.ok(w.rivers.every((r) => pastLine(w, r.path[0].x, r.path[0].z)), 'a drop landed off the line');
  // (Sliding down a descent-lane wall moves a little diagonally: allow a quarter more than a straight glide step.)
  assert.ok(worst <= (TUNE.glideSpeed * 1.8 / 20) * 1.25 + 1, `a drop moved ${worst.toFixed(0)} m in a tick: dragged`);
});

test('drop: drops that bump are knocked apart and both lose water to the sky, the rammed one more', async () => {
  const { rollIsland } = await import('../../src/shared/river.js');
  const w = rollIsland(5, 2).world;
  const a = addRiver(w, 'a', undefined, { drop: true }), b = addRiver(w, 'b', undefined, { drop: true });
  Object.assign(a, { dx: 1, dz: 0 });
  Object.assign(b, { x: a.x + 500, z: a.z, alt: a.alt, dx: 0, dz: 1 }); // a rams b, which crosses slowly
  const va = a.volume, vb = b.volume, sky = w.sky ?? 0;
  let bumped = null;
  for (let k = 0; k < 40 && !bumped; k++) {
    step(w, new Map([['a', { s: 0, f: 0, g: 1 }], ['b', { s: 0, f: 0, g: -1 }]]));
    bumped = w.events.splice(0).find((e) => e.type === 'bump');
  }
  assert.ok(bumped, 'no bump');
  assert.ok(va - a.volume > 0 && vb - b.volume > va - a.volume, `rammer lost ${va - a.volume}, rammed ${vb - b.volume}`);
  assert.ok(Math.abs((w.sky - sky) - (va - a.volume) - (vb - b.volume)) < 1e-6 * va, 'the spray did not go to the sky');
  assert.ok(Math.hypot(b.kx, b.kz) > 0, 'not knocked');
});
